'use strict';
/**
 * Two focused probes, kept separate from run.js so they can be read on their
 * own:
 *
 *  1. Does fuel-core 0.47.1's `estimatePredicates` GraphQL mutation reject a
 *     predicate that returns false, or does it happily report gas used?
 *     (Raw HTTP, no SDK error handling in the way.)
 *
 *  2. Are the Sway `Hash` byte widths for u16/u32 load-bearing? Sign a digest
 *     built with u16/u32 padded out to full 8-byte words instead of 2/4
 *     bytes; the predicate must reject it.
 *
 * Same prerequisites as run.js: `npm ci`, `FUEL_CORE_PATH`, and forc on PATH.
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

    // And what the same tx does at dryRun, once the estimated gas is applied:
    await provider.estimatePredicates(bogus);
    const { maxFee: bogusFee } = await provider.estimateTxGasAndFee({ transactionRequest: bogus });
    bogus.maxFee = bogusFee;
    try {
      await provider.dryRun(bogus, { utxoValidation: true, estimateTxDependencies: false });
      console.log('dryRun: ACCEPTED (unexpected)');
    } catch (err) {
      console.log('dryRun rejected:', describeError(err).split('\n').join(' '));
    }

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
    try {
      await provider.dryRun(req, { utxoValidation: true, estimateTxDependencies: false });
      console.log('RESULT: ACCEPTED -> the doc byte widths would be WRONG');
    } catch (err) {
      console.log('RESULT: rejected ->', describeError(err).split('\n').join(' '));
    }
  } finally {
    node.cleanup();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('FATAL', e);
    process.exit(1);
  }
);
