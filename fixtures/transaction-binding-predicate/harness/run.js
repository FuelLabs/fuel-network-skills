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
const { SIGNER_PRIVATE_KEY, SIGNER_ADDRESS } = require('./keys');

// Fails fast with a usage message before anything slow happens.
const FUEL_CORE_PATH = resolveFuelCorePath();
// Built from the checked-in, doc-identical source with only `SIGNER` replaced.
const { bytecode: BYTECODE, abi: ABI, root: FORC_ROOT } = buildPredicate(SIGNER_ADDRESS);

const FUND_AMOUNT = bn(1_000_000_000);
const PAY_AMOUNT = bn(1_000_000);
const GAS_LIMIT = bn(100_000);

const results = [];
const record = (tier, label, outcome, detail) => {
  results.push({ tier, label, outcome, detail });
  console.log(`\n[${tier}] ${label}\n    -> ${outcome}${detail ? `\n    -> ${detail}` : ''}`);
};

/**
 * Builds a spend of `coins` (all predicate-owned) with:
 *   output 0 = Coin(recipient, PAY_AMOUNT, baseAssetId)
 *   output 1 = Change(predicate, baseAssetId)
 * i.e. output_count == 2.
 *
 * `remainderTo` redirects output 1 away from the predicate root, and
 * `remainderAsCoin` retypes it from Change to Coin (burning whatever the
 * fixed coin amount does not cover). Both exist to attack the predicate's
 * remainder policy while leaving output_count at 2.
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
  predicateGasUsed,
  remainderTo,
  remainderAsCoin = false,
  remainderAmount = PAY_AMOUNT,
}) {
  const request = new ScriptTransactionRequest({ script: '0x', gasLimit: GAS_LIMIT });
  if (expiration !== undefined) {
    request.expiration = expiration;
  }
  request.addCoinOutput(new Address(recipient), payAmount, baseAssetId); // output 0
  const remainderOwner = new Address(remainderTo ?? predicateAddress);
  if (remainderAsCoin) {
    request.addCoinOutput(remainderOwner, remainderAmount, baseAssetId); // output 1 (Coin!)
  } else {
    request.addChangeOutput(remainderOwner, baseAssetId); // output 1
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

  request.witnesses = witnesses.map((w) => hexlify(w));
  return request;
}

/**
 * Runs the request through the three places a predicate failure can surface:
 * estimatePredicates -> dryRun -> sendTransaction. Returns the first failure.
 */
async function attempt(provider, request, { submit = true, estimate = true } = {}) {
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

  if (!submit) {
    return { stage: 'dryRun', predicateGasUsed, ok: true };
  }

  try {
    const response = await provider.sendTransaction(request, { estimateTxDependencies: false });
    const { id, status } = await response.waitForResult();
    return { stage: 'submitted', predicateGasUsed, ok: true, id, status: status?.type ?? status };
  } catch (err) {
    return { stage: 'sendTransaction', predicateGasUsed, ok: false, error: describeError(err) };
  }
}

async function main() {
  // ---------------------------------------------------------------- tier 2
  console.log(`fuel-core binary: ${FUEL_CORE_PATH}`);
  // A non-zero chain id so the `chain_id()` field of the digest is actually
  // exercised (the default local snapshot uses 0, which hides width bugs).
  const snapshotConfig = JSON.parse(JSON.stringify(defaultSnapshotConfigs));
  snapshotConfig.chainConfig.consensus_parameters.V2.chain_id = 9889;
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
    record(
      'tier2',
      'node launched + provider connected',
      'PASS',
      `url=${node.url} chainId=${chainId} baseAssetId=${baseAssetId} nodeVersion=${nodeInfo.nodeVersion}`
    );

    const genesis = Wallet.fromPrivateKey(process.env.GENESIS_SECRET, provider);

    // ---------------------------------------------------------------- tier 3
    const predicate = new Predicate({ bytecode: BYTECODE, abi: ABI, provider });
    const predicateAddress = predicate.address;
    const rootMatches = predicateAddress.toB256() === FORC_ROOT;
    record(
      'tier3',
      'predicate root == fuels-ts predicate address',
      rootMatches ? 'PASS' : 'FAIL',
      `forc=${FORC_ROOT} ts=${predicateAddress.toB256()}`
    );

    // Three separate coins: one for the happy path, one for the replay test,
    // and one spare for the double-claim test.
    for (let i = 0; i < 3; i++) {
      const tx = await genesis.transfer(predicateAddress, FUND_AMOUNT, baseAssetId);
      await tx.waitForResult();
    }
    const funded = await provider.getCoins(predicateAddress, baseAssetId);
    record(
      'tier3',
      'predicate funded from genesis wallet',
      funded.coins.length === 3 ? 'PASS' : 'FAIL',
      `${funded.coins.length} coins, ids=${funded.coins.map((c) => c.id).join(',')}`
    );

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
        remainderAsCoin: true,
      });
      negatives.push([
        '(g) output 1 is a Coin to an attacker, not Change',
        await attempt(provider, request),
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

    negatives.forEach(([label, res]) => {
      record(
        'tier4',
        label,
        res.ok ? 'FAIL (accepted!)' : 'PASS (rejected)',
        res.ok
          ? `stage=${res.stage} id=${res.id}`
          : `stage=${res.stage} predicateGasUsed=${res.predicateGasUsed} error=${res.error}`
      );
    });

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
      record(
        'tier4',
        'CONTRAST: valid order but predicateGasUsed = 1 (starved, not false)',
        res.ok ? 'UNEXPECTED (accepted)' : 'rejected',
        `stage=${res.stage} error=${res.error}`
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
      record(
        'tier5',
        'happy path spend',
        res.ok && after.sub(before).eq(PAY_AMOUNT) ? 'PASS' : 'FAIL',
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
        record('tier6', '(e) double-claim of the same output_index', 'SKIPPED', 'need 2 coins');
      } else {
        const o0 = makeOrder();
        const o1 = makeOrder();
        const s0 = signFor(c0, o0).signature;
        const s1 = signFor(c1, o1).signature;
        // Both signatures are valid; witness 0 holds s0 and witness 1 holds s1.
        o1.witnessIndex = 1;
        const s1b = signFor(c1, o1).signature;
        void s1;
        const request = buildRequest({
          predicateAddress,
          coins: [c0, c1],
          predicateDatas: [encodeOrder(o0), encodeOrder(o1)],
          expiration: EXPIRATION,
          witnesses: [s0, s1b],
          recipient: recipientB256,
          baseAssetId,
        });
        const res = await attempt(provider, request);
        record(
          'tier6',
          '(e) two same-root inputs claiming output_index 0',
          res.ok ? 'FAIL (accepted!)' : 'PASS (rejected)',
          res.ok ? `id=${res.id}` : `stage=${res.stage} error=${res.error}`
        );
      }
    }

    // (f) replay the happy-path (order, signature) against a NEW predicate UTXO
    {
      const { coins } = await provider.getCoins(predicateAddress, baseAssetId);
      const fresh = coins[0];
      const request = buildRequest({
        predicateAddress,
        coins: [fresh],
        predicateDatas: [encodeOrder(happyOrder)],
        expiration: EXPIRATION,
        witnesses: [happySignature],
        recipient: recipientB256,
        baseAssetId,
      });
      const res = await attempt(provider, request);
      record(
        'tier6',
        '(f) replay of happy-path order+signature on a new UTXO',
        res.ok ? 'FAIL (accepted!)' : 'PASS (rejected)',
        res.ok ? `id=${res.id}` : `stage=${res.stage} error=${res.error}`
      );
    }

    console.log('\n================ SUMMARY ================');
    results.forEach((r) => console.log(`${r.outcome.padEnd(16)} [${r.tier}] ${r.label}`));
    console.log(`\nhappy path tx id: ${happyTxId}`);
    console.log(`signer address (SIGNER const): ${SIGNER_ADDRESS}`);
    console.log(`predicate root: ${FORC_ROOT}`);
  } finally {
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FATAL:', err);
    process.exit(1);
  }
);
