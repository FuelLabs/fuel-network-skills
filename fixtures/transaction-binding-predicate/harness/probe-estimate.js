'use strict';
/**
 * Two focused probes, kept separate from run.js so they can be read on their
 * own:
 *
 *  1. Does fuel-core 0.47.1's `estimatePredicates` GraphQL mutation reject a
 *     predicate that returns false, or does it happily report gas used?
 *     (Raw HTTP, no SDK error handling in the way.) Expected: estimation
 *     ACCEPTS it and meters gas, while the dry run REJECTS it.
 *
 *  2. Are the Sway `Hash` byte widths for u16/u32 load-bearing? Sign a digest
 *     built with u16/u32 padded out to full 8-byte words instead of 2/4
 *     bytes; the predicate must reject it.
 *
 * Same prerequisites as run.js: `npm ci`, `FUEL_CORE_PATH`, and forc on PATH.
 *
 * Exit-code contract: both probes are assertions, not printouts. The run exits
 * 0 only if every expectation held, and 1 otherwise (a crash also exits 1).
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
  concat,
  sha256,
  getRandomB256,
  defaultSnapshotConfigs,
} = require('fuels');
const { launchNode } = require('fuels/test-utils');

const {
  DOMAIN,
  u64be,
  b32,
  encodeOrder,
  orderDigest,
  splitUtxoId,
  signDigest,
  describeError,
  buildPredicate,
  resolveFuelCorePath,
} = require('./lib');
const { SIGNER_PRIVATE_KEY, SIGNER_ADDRESS } = require('./keys');

const FUEL_CORE_PATH = resolveFuelCorePath();
const { bytecode: BYTECODE, abi: ABI } = buildPredicate(SIGNER_ADDRESS);

const PAY_AMOUNT = bn(1_000_000);

// Same exact rejection class run.js asserts: the predicate ran and returned
// false, reported by fuel-core as `PredicateVerificationFailed(Panic { index:
// N, reason: PredicateReturnedNonOne })`. Both halves are required — the
// wrapper alone also covers VM faults such as `OutOfGas`, which would not
// prove anything about the predicate's verdict.
const PREDICATE_FALSE = /PredicateVerificationFailed[\s\S]*PredicateReturnedNonOne/;

const results = [];
let failed = 0;

const check = (label, pass, detail) => {
  results.push({ label, pass, detail });
  if (!pass) {
    failed += 1;
  }
  console.log(`  -> ${pass ? 'PASS' : 'FAIL'}: ${label}${detail ? `\n     ${detail}` : ''}`);
  return pass;
};

/** Same 7-tuple, but u16/u32 written as full 8-byte words (the WRONG layout). */
function wordPaddedDigest({ chainId, utxoTxId, utxoOutputIndex, order }) {
  return sha256(
    concat([
      b32(DOMAIN),
      u64be(chainId),
      b32(utxoTxId),
      u64be(utxoOutputIndex),
      u64be(order.outputIndex),
      u64be(order.witnessIndex),
      u64be(order.outputCount), // 8 bytes instead of 2
      b32(order.recipient),
      b32(order.asset),
      u64be(order.amount),
      b32(order.nonce),
      u64be(order.expiration), // 8 bytes instead of 4
    ])
  );
}

/** Returns the number of failed assertions; 0 means both probes held. */
async function main() {
  const snapshotConfig = JSON.parse(JSON.stringify(defaultSnapshotConfigs));
  snapshotConfig.chainConfig.consensus_parameters.V2.chain_id = 9889;
  const node = await launchNode({
    fuelCorePath: FUEL_CORE_PATH,
    loggingEnabled: false,
    snapshotConfig,
  });

  try {
    const provider = new Provider(node.url);
    const chainId = await provider.getChainId();
    const baseAssetId = await provider.getBaseAssetId();
    const genesis = Wallet.fromPrivateKey(process.env.GENESIS_SECRET, provider);
    const predicate = new Predicate({ bytecode: BYTECODE, abi: ABI, provider });

    await (await genesis.transfer(predicate.address, bn(1_000_000_000), baseAssetId)).waitForResult();
    const { coins } = await provider.getCoins(predicate.address, baseAssetId);
    const coin = coins[0];
    const { txId, outputIndex } = splitUtxoId(coin.id);

    const height = (await provider.getBlockNumber()).add(1000).toNumber();
    const recipient = getRandomB256();
    const order = {
      outputIndex: 0,
      witnessIndex: 0,
      outputCount: 2,
      recipient,
      asset: baseAssetId,
      amount: PAY_AMOUNT,
      nonce: getRandomB256(),
      expiration: height,
    };
    const digestArgs = { chainId, utxoTxId: txId, utxoOutputIndex: outputIndex, order };

    const build = (witnessHex, predicateData) => {
      const request = new ScriptTransactionRequest({ script: '0x', gasLimit: bn(100_000) });
      request.expiration = height;
      request.addCoinOutput(new Address(recipient), PAY_AMOUNT, baseAssetId);
      request.addChangeOutput(new Address(predicate.address), baseAssetId);
      request.inputs.push({
        type: InputType.Coin,
        id: coin.id,
        owner: predicate.address.toB256(),
        amount: coin.amount,
        assetId: coin.assetId,
        txPointer: '0x00000000000000000000000000000000',
        witnessIndex: 0,
        predicate: BYTECODE,
        predicateData: hexlify(predicateData),
        predicateGasUsed: bn(0),
      });
      request.witnesses = [witnessHex];
      return request;
    };

    // ---- probe 1: raw estimatePredicates on a deliberately false predicate.
    // 10 bytes of predicate data cannot be a 126-byte `Order`, so the
    // predicate returns false — yet estimation is expected to meter it anyway.
    const bogus = build(signDigest(SIGNER_PRIVATE_KEY, orderDigest(digestArgs)), new Uint8Array(10));
    const raw = await fetch(node.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query($tx: HexString!) { estimatePredicates(tx: $tx) { inputs { __typename ... on InputCoin { predicateGasUsed } } } }',
        variables: { tx: hexlify(bogus.toTransactionBytes()) },
      }),
    });
    const body = await raw.json();
    console.log('\n=== probe 1: raw estimatePredicates on a false predicate ===');
    console.log('http status:', raw.status);
    console.log(JSON.stringify(body, null, 2));

    const estimatedGas = body?.data?.estimatePredicates?.inputs?.[0]?.predicateGasUsed;
    check(
      'estimatePredicates ACCEPTS a false predicate and meters it (estimation is not acceptance)',
      raw.status === 200 && !body?.errors && estimatedGas !== undefined && bn(estimatedGas).gt(0),
      `http=${raw.status} predicateGasUsed=${estimatedGas} errors=${JSON.stringify(body?.errors)}`
    );

    // And what the same tx does at dryRun, once the estimated gas is applied:
    await provider.estimatePredicates(bogus);
    const { maxFee: bogusFee } = await provider.estimateTxGasAndFee({ transactionRequest: bogus });
    bogus.maxFee = bogusFee;
    let dryRunRejection = null;
    try {
      await provider.dryRun(bogus, { utxoValidation: true, estimateTxDependencies: false });
    } catch (err) {
      dryRunRejection = describeError(err).split('\n').join(' ');
    }
    check(
      'the same false predicate is REJECTED at dry run (PredicateReturnedNonOne)',
      dryRunRejection !== null && PREDICATE_FALSE.test(dryRunRejection),
      dryRunRejection === null ? 'dryRun ACCEPTED it' : `dryRun rejected: ${dryRunRejection}`
    );

    // ---- probe 2: word-padded (wrong-width) digest.
    console.log('\n=== probe 2: digest with u16/u32 padded to 8-byte words ===');
    const correct = orderDigest(digestArgs);
    const padded = wordPaddedDigest(digestArgs);
    console.log('correct-width digest:', correct);
    console.log('word-padded  digest:', padded);
    const req = build(signDigest(SIGNER_PRIVATE_KEY, padded), encodeOrder(order));
    await provider.estimatePredicates(req);
    const { maxFee } = await provider.estimateTxGasAndFee({ transactionRequest: req });
    req.maxFee = maxFee;
    let paddedRejection = null;
    try {
      await provider.dryRun(req, { utxoValidation: true, estimateTxDependencies: false });
    } catch (err) {
      paddedRejection = describeError(err).split('\n').join(' ');
    }
    check(
      'a signature over the word-padded digest is REJECTED (the doc byte widths are load-bearing)',
      correct !== padded && paddedRejection !== null && PREDICATE_FALSE.test(paddedRejection),
      paddedRejection === null
        ? 'ACCEPTED -> the doc byte widths would be WRONG'
        : `rejected: ${paddedRejection}`
    );

    console.log('\n================ SUMMARY ================');
    results.forEach((r) => console.log(`${(r.pass ? 'PASS' : 'FAIL').padEnd(6)} ${r.label}`));
    console.log(
      `\n${results.length - failed}/${results.length} checks passed` +
        (failed ? ` — ${failed} FAILED` : '')
    );
    return failed;
  } finally {
    node.cleanup();
  }
}

main().then(
  (failedCount) => process.exit(failedCount === 0 ? 0 : 1),
  (e) => {
    console.error('FATAL', e);
    process.exit(1);
  }
);
