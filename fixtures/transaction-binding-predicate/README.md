# Transaction-binding predicate fixture

Reproduces the verification claims made for the "Transaction-binding predicate
(signed order)" example in
[`references/worked-examples.md`](../../references/worked-examples.md).

| Path             | What it is                                                        |
| ---------------- | ----------------------------------------------------------------- |
| `predicate/`     | The compilable source. `src/main.sw` is byte-identical to the documented `sway` block, `SIGNER` placeholder included. |
| `encoding-test/` | A `forc test` library asserting `Order` encodes to exactly 126 bytes (`ORDER_ENCODED_LEN`). |
| `harness/`       | Optional Node suite that runs the predicate against a local fuel-core node. |

`scripts/validate_repository.py` compares `predicate/src/main.sw` against the
fenced block on every run, so the documented code and the compiled code cannot
drift apart. The `forc` and Node steps below are deeper and manual — they are
**not** run by repository CI, which stays Python-only and network-free.

## (a) Compile the predicate

Pinned toolchain: `forc 0.71.2` (install with
`fuelup toolchain install latest-0.71.2 && fuelup default latest-0.71.2`, then
`export PATH="$HOME/.fuelup/bin:$PATH"`).

```sh
cd predicate
forc build --release
cat out/release/predicate_fixture-bin-root
```

Expected: a clean build with no warnings, and the predicate root

```text
0xe73420b2544c0e825a0241115fbc8095e1a6b08b38803f3b5e65b1d7f712a1c1
```

That root is the placeholder-`SIGNER` build. Substituting a real signer address
changes the bytecode and therefore the root — as it must, since the signer is
baked into the predicate's identity.

## (b) Check the encoding length

```sh
cd encoding-test
forc test
```

Asserts that ABI encoding v1 of `Order` (and of the `(Order,)` 1-tuple the
predicate entry would use) is exactly 126 bytes, which is the constant every
length gate in the predicate depends on.

## (c) Optional: run against a local fuel-core node

Manual, not part of CI. Requires a fuel-core binary, which is not vendored
here.

Prerequisites:

- Node.js 20 or newer (`fuels@0.103.0` declares `^20 || ^22 || ^24`; newer
  majors run but npm prints an `EBADENGINE` warning).
- `forc 0.71.2` on `PATH` (or `FORC_PATH` pointing at it) — the harness builds
  the predicate itself.
- `fuel-core 0.47.1`, located through `FUEL_CORE_PATH`. Fuelup keeps one at
  `~/.fuelup/store/fuel-core-0.47.1/fuel-core`. The harness errors out with
  that hint if the variable is unset.

```sh
cd harness
npm ci
export PATH="$HOME/.fuelup/bin:$PATH"
export FUEL_CORE_PATH="$HOME/.fuelup/store/fuel-core-0.47.1/fuel-core"
node run.js            # full tier 2-6 matrix
node probe-estimate.js # two focused probes
```

`npm ci` installs exactly `fuels@0.103.0` from the checked-in
`package-lock.json`; nothing else is a direct dependency.

Both scripts are assertions, not printouts: **each exits 0 only when every
expected outcome held, and 1 otherwise** (a failed or unexpectedly accepted
case, a case that could not run, or a crash). The per-case log and the closing
`n/n checks passed` summary are for humans; the exit code is the contract, so
either script can be wired into a runner as-is.

The checked-in `predicate/src/main.sw` must stay byte-identical to the
documentation, so it keeps the `SIGNER` placeholder and cannot be run as-is.
Before building, the harness copies `predicate/` into `harness/work/predicate/`
(gitignored) and substitutes that one placeholder line with the address of the
throwaway test key in `harness/keys.js` — a one-line difference, every other
byte unchanged. `predicate/` itself is never written to.

`run.js` launches a node on a non-zero chain id, funds the predicate, and
asserts a pass/fail line per case: root agreement between `forc` and fuels-ts,
the happy-path spend, and the negative matrix (truncated, oversized and garbage
predicate data; missing and off-by-one `Expiration`; a non-`SIGNER` signature;
wrong recipient; wrong output count; a 65-byte witness; a remainder retyped
from `Change` to an attacker `Coin`; a `Change` remainder redirected to an
attacker; no own-asset `Change` at all; the own-asset `Change` displaced by an
attacker's change in another asset; a duplicated consideration output;
cross-UTXO replay).

Every one of those cases is held to the exact rejection class it claims: it
passes only if the node reported `PredicateVerificationFailed` **and**
`PredicateReturnedNonOne` in the same error and did **not** report the SDK's
`ASSET_BURN_DETECTED`, so no case can pass on an unrelated validity, fee,
signature, VM-fault or client-side-policy failure. The CONTRAST case inverts
that: it must report `PredicateVerificationFailed` / `OutOfGas` and must not
report `PredicateReturnedNonOne`, which proves the two are distinguishable.

The three burn-shaped remainder cases are the ones a client-side guard could
mask, so each runs twice — once as a dry run under UTXO validation (which
fuels-ts's asset-burn safeguard never sees) and once through submission with
that safeguard turned off (`enableAssetBurn: true`) — and both runs must show
the predicate class above. The two displacement shapes also need an input in an
asset the predicate does not control, which the run mints straight into the
genesis state config for the attacker key.

`probe-estimate.js` asserts both probes, using the same exact rejection class:
`estimatePredicates` must *accept* and meter a deliberately false predicate
(estimation is not acceptance) while the dry run rejects it with
`PredicateReturnedNonOne`, and a signature over a word-padded digest must be
rejected the same way.

The keys in `harness/keys.js` are fixed throwaway devnet constants for a node
that is created and destroyed by the run. They control nothing anywhere else
and must never be reused outside a local test node.
