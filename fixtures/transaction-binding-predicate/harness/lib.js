'use strict';
/**
 * Shared helpers for exercising the order-binding predicate against a live
 * fuel-core node.
 *
 * Byte layouts implemented here are the ones the Sway side actually uses:
 *
 *  - predicate data  = ABI encoding v1 of `struct Order`
 *                      (no padding: u16 -> 2B, u32 -> 4B, u64 -> 8B, b256/
 *                       Address/AssetId -> 32B). Total 126 bytes.
 *  - signed digest   = sha256 over the sequential `Hash` writes of the outer
 *                      7-tuple. sway-lib-std/src/hash.sw:
 *                        u16 -> low 2 bytes of the 8-byte word (BE)
 *                        u32 -> low 4 bytes of the 8-byte word (BE)
 *                        u64 -> 8 bytes (BE)
 *                        b256/u256 -> 32 bytes
 *                        Address/AssetId -> delegate to their `bits` b256
 *                        tuples -> sequential field writes into ONE hasher,
 *                                  no length prefix, no separator
 *                      Total preimage = 32+8+(32+8)+(8+8+2)+(32+32+8)+32+4
 *                                     = 206 bytes.
 *
 * It also owns the throwaway build the runtime suite needs; see
 * `buildPredicate` at the bottom of this file.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { arrayify, hexlify, concat, sha256, Signer } = require('fuels');

// ASCII "order.v1", zero-extended to b256 (must match DOMAIN in main.sw).
const DOMAIN = '0x0000000000000000000000000000000000000000000000006f726465722e7631';
const ORDER_ENCODED_LEN = 126;

const u16be = (n) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, Number(n), false);
  return b;
};
const u32be = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, Number(n), false);
  return b;
};
const u64be = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n.toString()), false);
  return b;
};
const b32 = (hex) => {
  const bytes = arrayify(hex);
  if (bytes.length !== 32) {
    throw new Error(`expected 32 bytes, got ${bytes.length} for ${hex}`);
  }
  return bytes;
};

/** ABI encoding v1 of `struct Order` -> exactly 126 bytes. */
function encodeOrder(order) {
  const bytes = concat([
    u64be(order.outputIndex),
    u64be(order.witnessIndex),
    u16be(order.outputCount),
    b32(order.recipient),
    b32(order.asset),
    u64be(order.amount),
    b32(order.nonce),
    u32be(order.expiration),
  ]);
  if (bytes.length !== ORDER_ENCODED_LEN) {
    throw new Error(`encodeOrder produced ${bytes.length} bytes, expected ${ORDER_ENCODED_LEN}`);
  }
  return bytes;
}

/** The 206-byte sha256 preimage the Sway `sha256((...))` call builds. */
function digestPreimage({ chainId, utxoTxId, utxoOutputIndex, order }) {
  return concat([
    b32(DOMAIN),
    u64be(chainId),
    b32(utxoTxId),
    u64be(utxoOutputIndex),
    u64be(order.outputIndex),
    u64be(order.witnessIndex),
    u16be(order.outputCount),
    b32(order.recipient),
    b32(order.asset),
    u64be(order.amount),
    b32(order.nonce),
    u32be(order.expiration),
  ]);
}

function orderDigest(args) {
  const preimage = digestPreimage(args);
  if (preimage.length !== 206) {
    throw new Error(`digest preimage is ${preimage.length} bytes, expected 206`);
  }
  return sha256(preimage);
}

/**
 * fuel-core reports a coin's UTXO id as 34 bytes: 32-byte tx id followed by a
 * big-endian u16 output index.
 */
function splitUtxoId(utxoId) {
  const bytes = arrayify(utxoId);
  if (bytes.length !== 34) {
    throw new Error(`unexpected utxo id length ${bytes.length} (${utxoId})`);
  }
  return {
    txId: hexlify(bytes.slice(0, 32)),
    outputIndex: new DataView(bytes.buffer, bytes.byteOffset + 32, 2).getUint16(0, false),
  };
}

/** 64-byte fuel-compact secp256k1 signature over a 32-byte digest. */
function signDigest(privateKey, digest) {
  const signer = new Signer(privateKey);
  const sig = signer.sign(digest);
  const bytes = arrayify(sig);
  if (bytes.length !== 64) {
    throw new Error(`signature is ${bytes.length} bytes, expected 64`);
  }
  return hexlify(bytes);
}

/** Squeeze a GraphQL / FuelError chain down to something readable. */
function describeError(err) {
  const parts = [];
  const push = (s) => {
    if (s && !parts.includes(s)) {
      parts.push(s);
    }
  };
  push(err?.message);
  const meta = err?.metadata ?? err?.cause?.metadata;
  if (meta) {
    push(typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  if (Array.isArray(err?.response?.errors)) {
    err.response.errors.forEach((e) => push(e.message));
  }
  if (err?.cause && err.cause !== err) {
    push(describeError(err.cause));
  }
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Fixture layout, toolchain lookup, and the throwaway predicate build.
//
// `../predicate/src/main.sw` is byte-identical to the fenced block in
// `references/worked-examples.md`, so it still carries the documented `SIGNER`
// placeholder. Patching that file in place would break the drift check in
// `scripts/validate_repository.py`, so the harness copies the project into a
// gitignored work directory, substitutes exactly that one line, and builds the
// copy. Nothing under `../predicate/` is ever written to.

const HARNESS_DIR = __dirname;
const FIXTURE_DIR = path.resolve(HARNESS_DIR, '..');
const PREDICATE_DIR = path.join(FIXTURE_DIR, 'predicate');
const WORK_DIR = path.join(HARNESS_DIR, 'work');
const WORK_PREDICATE_DIR = path.join(WORK_DIR, 'predicate');
const PREDICATE_PACKAGE = 'predicate_fixture';

/** The placeholder `SIGNER` literal carried by the documented source. */
const SIGNER_PLACEHOLDER =
  '0xa11ce00000000000000000000000000000000000000000000000000000001234';

/**
 * fuel-core is not bundled: the caller points `FUEL_CORE_PATH` at a 0.47.1
 * binary (fuelup keeps one at ~/.fuelup/store/fuel-core-0.47.1/fuel-core).
 */
function resolveFuelCorePath() {
  const configured = process.env.FUEL_CORE_PATH;
  if (!configured) {
    throw new Error(
      'FUEL_CORE_PATH is not set. Point it at a fuel-core 0.47.1 binary, e.g.\n' +
        '  export FUEL_CORE_PATH="$HOME/.fuelup/store/fuel-core-0.47.1/fuel-core"'
    );
  }
  if (!fs.existsSync(configured)) {
    throw new Error(`FUEL_CORE_PATH does not exist: ${configured}`);
  }
  return configured;
}

/** Replaces the single `SIGNER` placeholder; refuses to guess otherwise. */
function substituteSigner(source, signerAddress) {
  const occurrences = source.split(SIGNER_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `expected exactly 1 SIGNER placeholder in predicate/src/main.sw, found ${occurrences}`
    );
  }
  if (!/^0x[0-9a-f]{64}$/.test(signerAddress)) {
    throw new Error(`signer address must be a lower-case b256 hex string: ${signerAddress}`);
  }
  return source.replace(SIGNER_PLACEHOLDER, signerAddress);
}

/**
 * Copies `../predicate` into `./work/predicate`, substitutes `SIGNER`, and
 * runs `forc build --release` there. Returns the artifacts the suites need.
 */
function buildPredicate(signerAddress, { quiet = false } = {}) {
  const source = fs.readFileSync(path.join(PREDICATE_DIR, 'src/main.sw'), 'utf8');

  fs.rmSync(WORK_PREDICATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK_PREDICATE_DIR, 'src'), { recursive: true });
  for (const manifest of ['Forc.toml', 'Forc.lock']) {
    fs.copyFileSync(path.join(PREDICATE_DIR, manifest), path.join(WORK_PREDICATE_DIR, manifest));
  }
  fs.writeFileSync(
    path.join(WORK_PREDICATE_DIR, 'src/main.sw'),
    substituteSigner(source, signerAddress)
  );

  const forc = process.env.FORC_PATH || 'forc';
  try {
    execFileSync(forc, ['build', '--release'], {
      cwd: WORK_PREDICATE_DIR,
      stdio: quiet ? 'ignore' : 'inherit',
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(
        `could not run "${forc}". Install the pinned toolchain and put it on PATH:\n` +
          '  fuelup toolchain install latest-0.71.2 && export PATH="$HOME/.fuelup/bin:$PATH"\n' +
          '(or set FORC_PATH to a forc 0.71.2 binary)'
      );
    }
    throw err;
  }

  const release = path.join(WORK_PREDICATE_DIR, 'out/release');
  return {
    dir: WORK_PREDICATE_DIR,
    bytecode: hexlify(fs.readFileSync(path.join(release, `${PREDICATE_PACKAGE}.bin`))),
    abi: JSON.parse(fs.readFileSync(path.join(release, `${PREDICATE_PACKAGE}-abi.json`), 'utf8')),
    root: fs.readFileSync(path.join(release, `${PREDICATE_PACKAGE}-bin-root`), 'utf8').trim(),
  };
}

module.exports = {
  DOMAIN,
  ORDER_ENCODED_LEN,
  SIGNER_PLACEHOLDER,
  FIXTURE_DIR,
  PREDICATE_DIR,
  WORK_DIR,
  WORK_PREDICATE_DIR,
  u16be,
  u32be,
  u64be,
  b32,
  encodeOrder,
  digestPreimage,
  orderDigest,
  splitUtxoId,
  signDigest,
  describeError,
  resolveFuelCorePath,
  substituteSigner,
  buildPredicate,
};
