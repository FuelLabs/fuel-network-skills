'use strict';
/**
 * End-to-end execution of the order-binding predicate against a real
 * fuel-core 0.47.1 node.
 *
 *   npm ci
 *   export FUEL_CORE_PATH="$HOME/.fuelup/store/fuel-core-0.47.1/fuel-core"
 *   node run.js
 *
 * Everything but the two binaries is self-contained: it builds a
 * signer-substituted copy of ../predicate into ./work/predicate, launches the
 * node, funds the predicate, runs the negative cases, runs the happy path,
 * runs the bonus cases, and kills the node.
 *
 * Exit-code contract: every expected outcome below is an assertion. The run
 * exits 0 only when all of them held; any failed, unexpectedly accepted or
 * unrunnable case makes it exit 1 (a crash also exits 1). The per-case log and
 * the closing summary stay human-readable, but they are not the contract.
 */
const {
  Provider,
  Wallet,
  Predicate,
  ScriptTransactionRequest,
  InputType,
  Address,
  bn,
  hexlify,
  arrayify,
  concat,
  getRandomB256,
  defaultSnapshotConfigs,
} = require('fuels');
const { launchNode } = require('fuels/test-utils');

const {
  encodeOrder,
  orderDigest,
  digestPreimage,
  splitUtxoId,
  signDigest,
  describeError,
  buildPredicate,
  resolveFuelCorePath,
  ORDER_ENCODED_LEN,
} = require('./lib');
const {
  SIGNER_PRIVATE_KEY,
  SIGNER_ADDRESS,
  ATTACKER_PRIVATE_KEY,
  ATTACKER_ADDRESS,
} = require('./keys');

// Fails fast with a usage message before anything slow happens.
const FUEL_CORE_PATH = resolveFuelCorePath();
// Built from the checked-in, doc-identical source with only `SIGNER` replaced.
const { bytecode: BYTECODE, abi: ABI, root: FORC_ROOT } = buildPredicate(SIGNER_ADDRESS);

const FUND_AMOUNT = bn(1_000_000_000);
const PAY_AMOUNT = bn(1_000_000);
const GAS_LIMIT = bn(100_000);

// A second, non-base asset minted straight into the genesis state config and
// owned by the attacker. The remainder-removal cases need an input in some
// asset the predicate does not control.
const OTHER_ASSET_ID = `0x${'a5'.repeat(32)}`;
const OTHER_ASSET_AMOUNT = '1000000000';
// One per remainder-removal case, so the two cases stay independent even if a
// regression lets the first one through and spends its input.
const ATTACKER_UTXO_TX_IDS = [`0x${'a7'.repeat(32)}`, `0x${'a8'.repeat(32)}`];
// Same width as a real signature, so adding it does not change the fee.
const WITNESS_PLACEHOLDER = hexlify(new Uint8Array(64));

// The one rejection class every negative case below claims: the predicate ran
// to completion and returned false. fuel-core reports it as
// `PredicateVerificationFailed(Panic { index: N, reason: PredicateReturnedNonOne })`
// — pretty-printed across several lines on the dry-run path, on one line on the
// submission path, hence `[\s\S]*`. Both halves are required: the wrapper alone
// also covers VM faults such as `OutOfGas`, which is a different claim (see the
// CONTRAST case), and the reason alone would accept text from another layer.
const PREDICATE_FALSE = /PredicateVerificationFailed[\s\S]*PredicateReturnedNonOne/;
// The contrast class: same wrapper, but the predicate never got to return.
const PREDICATE_OUT_OF_GAS = /PredicateVerificationFailed[\s\S]*OutOfGas/;
// The fuels-ts client-side asset-burn safeguard — a policy refusal, not a node
// verdict. It surfaces as FuelError code `asset-burn-detected` with the message
// "Asset burn detected."; nothing the node reports contains either form.
const SDK_ASSET_BURN = /ASSET_BURN_DETECTED|asset-burn-detected|Asset burn detected/i;
// Applied to every case documented as a clean predicate `false`, so no case can
// pass on an unrelated validity, fee, signature, VM-fault or SDK-policy failure.
const PREDICATE_FALSE_ONLY = { mustMatch: PREDICATE_FALSE, mustNotMatch: SDK_ASSET_BURN };

const results = [];
let failed = 0;

/** The only way a result is recorded: as a boolean assertion. */
const check = (tier, label, pass, detail) => {
  results.push({ tier, label, pass, detail });
  if (!pass) {
    failed += 1;
  }
  console.log(
    `\n[${tier}] ${label}\n    -> ${pass ? 'PASS' : 'FAIL'}${detail ? `\n    -> ${detail}` : ''}`
  );
  return pass;
};

/**
 * A negative case passes only when the attempt was rejected AND the reported
 * error is the exact class the case claims (`mustMatch`) and not a class it
 * disclaims (`mustNotMatch`, e.g. an SDK policy refusal). Every negative case
 * in this file supplies both, so "rejected somehow" is never a pass.
 */
const expectRejected = (tier, label, res, { mustMatch, mustNotMatch } = {}) => {
  const error = res.error ?? '';
  const reasons = [];
  if (res.ok) {
    reasons.push(`ACCEPTED at stage=${res.stage}${res.id ? ` id=${res.id}` : ''}`);
  } else {
    if (mustMatch && !mustMatch.test(error)) {
      reasons.push(`rejected, but the error does not match ${mustMatch}`);
    }
    if (mustNotMatch && mustNotMatch.test(error)) {
      reasons.push(`rejected by the wrong layer: the error matches ${mustNotMatch}`);
    }
  }
  const detail = res.ok
    ? `stage=${res.stage} id=${res.id}`
    : `stage=${res.stage} predicateGasUsed=${res.predicateGasUsed} error=${error}`;
  return check(
    tier,
    label,
    reasons.length === 0,
    reasons.length === 0 ? detail : `${reasons.join('; ')} | ${detail}`
  );
};

/**
 * Builds a spend of `coins` (all predicate-owned) with:
 *   output 0 = Coin(recipient, PAY_AMOUNT, baseAssetId)
 *   output 1 = Change(predicate, baseAssetId)
 * i.e. output_count == 2.
 *
 * `remainderTo` redirects output 1 away from the predicate root,
 * `remainderAssetId` moves it to a different asset entirely (so the predicate
 * coin's own asset gets no change output at all), and `remainderAsCoin`
 * retypes it from Change to Coin (burning whatever the fixed coin amount does
 * not cover). All three exist to attack the predicate's remainder policy while
 * leaving output_count at 2. `extraCoinInputs` adds ordinary signed inputs —
 * the attacker's own funding — which must be signed after the fee is fixed.
 */
function buildRequest({
  predicateAddress,
  coins,
  predicateDatas,
  expiration,
  witnesses,
  recipient,
  baseAssetId,
  payAmount = PAY_AMOUNT,
  extraOutputs = [],
  extraCoinInputs = [],
  predicateGasUsed,
  remainderTo,
  remainderAssetId,
  remainderAsCoin = false,
  remainderAmount = PAY_AMOUNT,
}) {
  const request = new ScriptTransactionRequest({ script: '0x', gasLimit: GAS_LIMIT });
  if (expiration !== undefined) {
    request.expiration = expiration;
  }
  request.addCoinOutput(new Address(recipient), payAmount, baseAssetId); // output 0
  const remainderOwner = new Address(remainderTo ?? predicateAddress);
  const remainderAsset = remainderAssetId ?? baseAssetId;
  if (remainderAsCoin) {
    request.addCoinOutput(remainderOwner, remainderAmount, remainderAsset); // output 1 (Coin!)
  } else {
    request.addChangeOutput(remainderOwner, remainderAsset); // output 1
  }
  extraOutputs.forEach(({ to, amount }) =>
    request.addCoinOutput(new Address(to), amount, baseAssetId)
  );

  coins.forEach((coin, i) => {
    request.inputs.push({
      type: InputType.Coin,
      id: coin.id,
      owner: new Address(predicateAddress).toB256(),
      amount: coin.amount,
      assetId: coin.assetId,
      txPointer: '0x00000000000000000000000000000000',
      witnessIndex: 0,
      predicate: BYTECODE,
      predicateData: hexlify(predicateDatas[i]),
      predicateGasUsed: bn(predicateGasUsed ?? 0),
    });
  });

  extraCoinInputs.forEach(({ coin, owner, witnessIndex }) => {
    request.inputs.push({
      type: InputType.Coin,
      id: coin.id,
      owner: new Address(owner).toB256(),
      amount: coin.amount,
      assetId: coin.assetId,
      txPointer: '0x00000000000000000000000000000000',
      witnessIndex,
      predicate: '0x',
      predicateData: '0x',
      predicateGasUsed: bn(0),
    });
  });

  request.witnesses = witnesses.map((w) => hexlify(w));
  return request;
}

/**
 * Runs the request through the three places a predicate failure can surface:
 * estimatePredicates -> dryRun -> sendTransaction. Returns the first failure.
 *
 * `signers` are accounts owning ordinary coin inputs; they sign after `maxFee`
 * is set, because policies are part of the transaction id and witnesses are
 * not. `enableAssetBurn` turns off the fuels-ts submission-side asset-burn
 * safeguard so that a rejection can only be the node's.
 */
async function attempt(
  provider,
  request,
  { submit = true, estimate = true, dryRun = true, enableAssetBurn = false, signers = [] } = {}
) {
  let predicateGasUsed = 'not-estimated';
  if (estimate) {
    try {
      await provider.estimatePredicates(request);
      predicateGasUsed = request.inputs.map((i) => bn(i.predicateGasUsed).toString()).join(',');
    } catch (err) {
      return { stage: 'estimatePredicates', ok: false, error: describeError(err) };
    }
  }

  try {
    const { maxFee } = await provider.estimateTxGasAndFee({ transactionRequest: request });
    request.maxFee = maxFee;
  } catch (err) {
    return { stage: 'estimateTxGasAndFee', predicateGasUsed, ok: false, error: describeError(err) };
  }

  try {
    for (const account of signers) {
      request.updateWitnessByOwner(account.address, await account.signTransaction(request));
    }
  } catch (err) {
    return { stage: 'signExtraInputs', predicateGasUsed, ok: false, error: describeError(err) };
  }

  if (dryRun) {
    try {
      const { dryRunStatus } = await provider.dryRun(request, {
        utxoValidation: true,
        estimateTxDependencies: false,
      });
      if (dryRunStatus?.type !== 'DryRunSuccessStatus') {
        return { stage: 'dryRun', predicateGasUsed, ok: false, error: JSON.stringify(dryRunStatus) };
      }
    } catch (err) {
      return { stage: 'dryRun', predicateGasUsed, ok: false, error: describeError(err) };
    }
  }

  if (!submit) {
    return { stage: dryRun ? 'dryRun' : 'estimate', predicateGasUsed, ok: true };
  }

  try {
    const response = await provider.sendTransaction(request, {
      estimateTxDependencies: false,
      enableAssetBurn,
    });
    const { id, status } = await response.waitForResult();
    return { stage: 'submitted', predicateGasUsed, ok: true, id, status: status?.type ?? status };
  } catch (err) {
    return { stage: 'sendTransaction', predicateGasUsed, ok: false, error: describeError(err) };
  }
}

/** Returns the number of failed assertions; 0 means the suite passed. */
async function main() {
  // ---------------------------------------------------------------- tier 2
  console.log(`fuel-core binary: ${FUEL_CORE_PATH}`);
  // A non-zero chain id so the `chain_id()` field of the digest is actually
  // exercised (the default local snapshot uses 0, which hides width bugs).
  const snapshotConfig = JSON.parse(JSON.stringify(defaultSnapshotConfigs));
  snapshotConfig.chainConfig.consensus_parameters.V2.chain_id = 9889;
  // Genesis funding for the attacker, in an asset the predicate never holds.
  ATTACKER_UTXO_TX_IDS.forEach((txId) =>
    snapshotConfig.stateConfig.coins.push({
      tx_id: txId,
      output_index: 0,
      tx_pointer_block_height: 0,
      tx_pointer_tx_idx: 0,
      owner: ATTACKER_ADDRESS,
      amount: OTHER_ASSET_AMOUNT,
      asset_id: OTHER_ASSET_ID,
    })
  );
  const node = await launchNode({
    fuelCorePath: FUEL_CORE_PATH,
    loggingEnabled: false,
    snapshotConfig,
  });
  const cleanup = () => node.cleanup();
  process.on('exit', cleanup);

  try {
    const provider = new Provider(node.url);
    const chainId = await provider.getChainId();
    const baseAssetId = await provider.getBaseAssetId();
    const nodeInfo = await provider.fetchNode();
    check(
      'tier2',
      'node launched + provider connected',
      Boolean(node.url) && baseAssetId !== OTHER_ASSET_ID,
      `url=${node.url} chainId=${chainId} baseAssetId=${baseAssetId} nodeVersion=${nodeInfo.nodeVersion}`
    );

    const genesis = Wallet.fromPrivateKey(process.env.GENESIS_SECRET, provider);
    const attacker = Wallet.fromPrivateKey(ATTACKER_PRIVATE_KEY, provider);

    // ---------------------------------------------------------------- tier 3
    const predicate = new Predicate({ bytecode: BYTECODE, abi: ABI, provider });
    const predicateAddress = predicate.address;
    check(
      'tier3',
      'predicate root == fuels-ts predicate address',
      predicateAddress.toB256() === FORC_ROOT,
      `forc=${FORC_ROOT} ts=${predicateAddress.toB256()}`
    );

    // Three separate coins: one for the happy path, one for the replay test,
    // and one spare for the double-claim test.
    for (let i = 0; i < 3; i++) {
      const tx = await genesis.transfer(predicateAddress, FUND_AMOUNT, baseAssetId);
      await tx.waitForResult();
    }
    const funded = await provider.getCoins(predicateAddress, baseAssetId);
    check(
      'tier3',
      'predicate funded from genesis wallet',
      funded.coins.length === 3,
      `${funded.coins.length} coins, ids=${funded.coins.map((c) => c.id).join(',')}`
    );

    const attackerCoins = (await provider.getCoins(attacker.address, OTHER_ASSET_ID)).coins;
    check(
      'tier3',
      'attacker funded from genesis state config in a non-base asset',
      attackerCoins.length === ATTACKER_UTXO_TX_IDS.length,
      `${attackerCoins.length} coins of ${OTHER_ASSET_ID}, ids=${attackerCoins
        .map((c) => c.id)
        .join(',')}`
    );
    if (attackerCoins.length < ATTACKER_UTXO_TX_IDS.length) {
      throw new Error('attacker is underfunded in the non-base asset: cases (i)/(j) cannot run');
    }

    const recipient = Wallet.generate({ provider });
    const recipientB256 = recipient.address.toB256();

    const currentBlock = await provider.getBlockNumber();
    const EXPIRATION = currentBlock.add(1000).toNumber();

    const takeCoin = async (skip = 0) => {
      const { coins } = await provider.getCoins(predicateAddress, baseAssetId);
      const coin = coins[skip];
      if (!coin) {
        throw new Error('no predicate coin available');
      }
      return coin;
    };

    const makeOrder = (overrides = {}) => ({
      outputIndex: 0,
      witnessIndex: 0,
      outputCount: 2,
      recipient: recipientB256,
      asset: baseAssetId,
      amount: PAY_AMOUNT,
      nonce: getRandomB256(),
      expiration: EXPIRATION,
      ...overrides,
    });

    const signFor = (coin, order) => {
      const { txId, outputIndex } = splitUtxoId(coin.id);
      const digest = orderDigest({
        chainId,
        utxoTxId: txId,
        utxoOutputIndex: outputIndex,
        order,
      });
      return { digest, signature: signDigest(SIGNER_PRIVATE_KEY, digest) };
    };

    // ---------------------------------------------------------------- tier 4
    const negatives = [];

    // (a) truncated predicate data
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const data = encodeOrder(order).slice(0, 100);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [data],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push(['(a) truncated predicate data (100 bytes)', await attempt(provider, request)]);
    }

    // (b) oversized predicate data
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const data = concat([encodeOrder(order), new Uint8Array(8)]);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [data],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push(['(b) oversized predicate data (134 bytes)', await attempt(provider, request)]);
    }

    // (c) exactly 126 bytes of garbage
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const data = arrayify(getRandomB256());
      const garbage = new Uint8Array(ORDER_ENCODED_LEN);
      for (let i = 0; i < garbage.length; i++) {
        garbage[i] = data[i % 32] ^ (i + 1);
      }
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [garbage],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push(['(c) 126 bytes of garbage', await attempt(provider, request)]);
    }

    // (d1) valid order + signature, but NO Expiration policy on the tx
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: undefined,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push([
        '(d1) valid order, tx Expiration policy absent',
        await attempt(provider, request),
      ]);
    }

    // (d2) valid order + signature, but a DIFFERENT Expiration policy
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION + 1,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push([
        '(d2) valid order, tx Expiration policy differs by 1',
        await attempt(provider, request),
      ]);
    }

    // (d3) control: valid order but signature from the WRONG key
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { digest } = signFor(coin, order);
      const wrong = signDigest(
        '0x2222222222222222222222222222222222222222222222222222222222222222',
        digest
      );
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [wrong],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push(['(d3) signature from a non-SIGNER key', await attempt(provider, request)]);
    }

    // (n1) valid order + signature, but output 0 pays somebody else
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: getRandomB256(), // != order.recipient
        baseAssetId,
      });
      negatives.push([
        '(n1) output 0 pays a different recipient',
        await attempt(provider, request),
      ]);
    }

    // (n2) valid order + signature, but a third output breaks output_count
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
        extraOutputs: [{ to: getRandomB256(), amount: bn(1) }],
      });
      negatives.push([
        '(n2) 3 outputs, signed output_count == 2',
        await attempt(provider, request),
      ]);
    }

    // (n3) valid order + signature, but the witness is 65 bytes, not 64
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [concat([arrayify(signature), new Uint8Array(1)])],
        recipient: recipientB256,
        baseAssetId,
      });
      negatives.push(['(n3) 65-byte witness', await attempt(provider, request)]);
    }

    // (g) output 1 retyped from Change to a Coin paying an attacker. Still
    // exactly 2 outputs, so only the remainder policy can reject this.
    //
    // Burn-shaped: the fixed Coin leaves the rest of the predicate input with
    // no Change output in its asset, which is exactly what the fuels-ts
    // asset-burn safeguard refuses client-side. So, like (i)/(j) below, this
    // shape is run twice — once as a dry run the safeguard never sees, once
    // through submission with the safeguard disabled — and neither run may
    // report ASSET_BURN_DETECTED. A predicate regression therefore cannot be
    // masked by the SDK.
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const build = () =>
        buildRequest({
          predicateAddress,
          coins: [coin],
          predicateDatas: [encodeOrder(order)],
          expiration: EXPIRATION,
          witnesses: [signature],
          recipient: recipientB256,
          baseAssetId,
          remainderTo: getRandomB256(), // attacker
          remainderAsCoin: true,
        });
      negatives.push([
        '(g) output 1 is a Coin to an attacker, not Change [dry run]',
        await attempt(provider, build(), { submit: false }),
      ]);
      negatives.push([
        '(g) output 1 is a Coin to an attacker, not Change [submitted with enableAssetBurn: true]',
        await attempt(provider, build(), { dryRun: false, enableAssetBurn: true }),
      ]);
    }

    // (h) output 1 is still Change, but redirected to an attacker address.
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
        remainderTo: getRandomB256(), // attacker
      });
      negatives.push([
        '(h) output 1 is Change to an attacker address',
        await attempt(provider, request),
      ]);
    }

    // Every case above is documented as a clean predicate `false`, so every one
    // of them is held to that exact class — and to nothing else.
    negatives.forEach(([label, res]) =>
      expectRejected('tier4', label, res, PREDICATE_FALSE_ONLY)
    );

    // (i) and (j): the remainder is REMOVED rather than redirected. Output 1
    // is still a Change output and output_count is still the signed 2, but it
    // carries a different asset — funded by an attacker input in that asset —
    // so the predicate coin's own asset has no change output at all and its
    // remainder is burned. (i) sends that stray change back to the honest
    // predicate root, isolating "no own-asset change"; (j) is the full
    // displacement attack, with the attacker keeping it.
    //
    // Each shape is run twice: once as a dry run (which the fuels-ts
    // asset-burn safeguard never sees) and once through the submission path
    // with `enableAssetBurn: true`, which disables that safeguard. Both must
    // fail with `PredicateReturnedNonOne`, never with the SDK's
    // ASSET_BURN_DETECTED, so the rejection is provably the predicate's.
    const remainderRemovalCases = [
      ['(i) no Change in the coin\'s own asset (remainder burned)', undefined],
      ['(j) own-asset Change displaced by the attacker\'s other-asset Change', ATTACKER_ADDRESS],
    ];
    for (const [caseIndex, [label, remainderTo]] of remainderRemovalCases.entries()) {
      const attackerCoin = attackerCoins[caseIndex];
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const build = () =>
        buildRequest({
          predicateAddress,
          coins: [coin],
          predicateDatas: [encodeOrder(order)],
          expiration: EXPIRATION,
          witnesses: [signature, WITNESS_PLACEHOLDER],
          recipient: recipientB256,
          baseAssetId,
          remainderTo,
          remainderAssetId: OTHER_ASSET_ID,
          extraCoinInputs: [
            { coin: attackerCoin, owner: ATTACKER_ADDRESS, witnessIndex: 1 },
          ],
        });

      expectRejected(
        'tier4',
        `${label} [dry run]`,
        await attempt(provider, build(), { submit: false, signers: [attacker] }),
        PREDICATE_FALSE_ONLY
      );
      expectRejected(
        'tier4',
        `${label} [submitted with enableAssetBurn: true]`,
        await attempt(provider, build(), {
          dryRun: false,
          enableAssetBurn: true,
          signers: [attacker],
        }),
        PREDICATE_FALSE_ONLY
      );
    }

    // Contrast case: a genuinely valid order, but the input declares a
    // predicateGasUsed of 1. This proves the error text above really is the
    // "predicate returned false" signal and not a catch-all for any predicate
    // problem.
    {
      const coin = await takeCoin();
      const order = makeOrder();
      const { signature } = signFor(coin, order);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
        predicateGasUsed: 1,
      });
      const res = await attempt(provider, request, { estimate: false });
      expectRejected(
        'tier4',
        'CONTRAST: valid order but predicateGasUsed = 1 (starved, not false)',
        res,
        { mustMatch: PREDICATE_OUT_OF_GAS, mustNotMatch: /PredicateReturnedNonOne/ }
      );
    }

    // ---------------------------------------------------------------- tier 5
    let happyTxId;
    let happyOrder;
    let happySignature;
    {
      const coin = await takeCoin();
      const order = makeOrder();
      happyOrder = order;
      const { digest, signature } = signFor(coin, order);
      happySignature = signature;
      const { txId, outputIndex } = splitUtxoId(coin.id);
      console.log(
        `\nhappy path inputs:\n  utxo txId=${txId} outputIndex=${outputIndex}` +
          `\n  preimage(206B)=${hexlify(
            digestPreimage({ chainId, utxoTxId: txId, utxoOutputIndex: outputIndex, order })
          )}` +
          `\n  digest=${digest}\n  signature=${signature}` +
          `\n  predicateData(126B)=${hexlify(encodeOrder(order))}`
      );

      const before = await recipient.getBalance(baseAssetId);
      const request = buildRequest({
        predicateAddress,
        coins: [coin],
        predicateDatas: [encodeOrder(order)],
        expiration: EXPIRATION,
        witnesses: [signature],
        recipient: recipientB256,
        baseAssetId,
      });
      const res = await attempt(provider, request);
      const after = await recipient.getBalance(baseAssetId);
      happyTxId = res.id;
      check(
        'tier5',
        'happy path spend (output 1 is the own-asset Change back to the root)',
        res.ok && after.sub(before).eq(PAY_AMOUNT),
        res.ok
          ? `txId=${res.id} status=${res.status} recipientBalance ${before.toString()} -> ${after.toString()}`
          : `stage=${res.stage} error=${res.error}`
      );
    }

    // ---------------------------------------------------------------- tier 6
    // (e) two same-root inputs both claiming output_index 0
    {
      const { coins } = await provider.getCoins(predicateAddress, baseAssetId);
      const [c0, c1] = coins;
      if (!c1) {
        // Essential case: not being able to run it is a failure, not a skip.
        check(
          'tier6',
          '(e) two same-root inputs claiming output_index 0',
          false,
          `COULD NOT RUN: needs 2 predicate coins, found ${coins.length}`
        );
      } else {
        const o0 = makeOrder();
        const o1 = makeOrder();
        const s0 = signFor(c0, o0).signature;
        // Both signatures are valid; witness 0 holds s0 and witness 1 holds s1.
        o1.witnessIndex = 1;
        const s1 = signFor(c1, o1).signature;
        const request = buildRequest({
          predicateAddress,
          coins: [c0, c1],
          predicateDatas: [encodeOrder(o0), encodeOrder(o1)],
          expiration: EXPIRATION,
          witnesses: [s0, s1],
          recipient: recipientB256,
          baseAssetId,
        });
        expectRejected(
          'tier6',
          '(e) two same-root inputs claiming output_index 0',
          await attempt(provider, request),
          PREDICATE_FALSE_ONLY
        );
      }
    }

    // (f) replay the happy-path (order, signature) against a NEW predicate UTXO
    {
      const { coins } = await provider.getCoins(predicateAddress, baseAssetId);
      const fresh = coins[0];
      if (!fresh) {
        check(
          'tier6',
          '(f) replay of happy-path order+signature on a new UTXO',
          false,
          'COULD NOT RUN: no predicate coin left'
        );
      } else {
        const request = buildRequest({
          predicateAddress,
          coins: [fresh],
          predicateDatas: [encodeOrder(happyOrder)],
          expiration: EXPIRATION,
          witnesses: [happySignature],
          recipient: recipientB256,
          baseAssetId,
        });
        expectRejected(
          'tier6',
          '(f) replay of happy-path order+signature on a new UTXO',
          await attempt(provider, request),
          PREDICATE_FALSE_ONLY
        );
      }
    }

    console.log('\n================ SUMMARY ================');
    results.forEach((r) => console.log(`${(r.pass ? 'PASS' : 'FAIL').padEnd(6)} [${r.tier}] ${r.label}`));
    console.log(`\nhappy path tx id: ${happyTxId}`);
    console.log(`signer address (SIGNER const): ${SIGNER_ADDRESS}`);
    console.log(`predicate root: ${FORC_ROOT}`);
    console.log(
      `\n${results.length - failed}/${results.length} checks passed` +
        (failed ? ` — ${failed} FAILED` : '')
    );
    return failed;
  } finally {
    cleanup();
  }
}

main().then(
  (failedCount) => process.exit(failedCount === 0 ? 0 : 1),
  (err) => {
    console.error('FATAL:', err);
    process.exit(1);
  }
);
