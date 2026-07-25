# Auto-research findings

Use this module when a Fuel task needs measured Sway/FuelVM optimization
evidence, compiler-sensitive tradeoffs, or research-backed protocol design.
Pair it with the relevant performance, security, architecture, transaction, or
migration module. Load [maximum-optimization.md](maximum-optimization.md) only
when the user explicitly prioritizes maximum gas/size over ordinary
readability.

The evidence covers 434 journaled iterations across 22 tracks using pinned
`forc 0.71.2`, release builds, release tests, and release `.bin` sizes:

- 35 accepted optimizations;
- 92 rejected optimizations;
- 28 confirmed worst-case probes;
- 3 inconclusive probes;
- 219 valid observational experiments;
- 57 operational/compile failures that produced no performance evidence.

Treat these as strong fixture/compiler evidence, not timeless FuelVM
constants. Re-measure on the project pin and target node.

## Contents

- [Use evidence safely](#use-evidence-safely)
- [Prefer these readable defaults](#prefer-these-readable-defaults)
- [Accepted champion outcomes](#accepted-champion-outcomes)
- [Gas findings](#gas-findings)
- [Contract-size findings](#contract-size-findings)
- [Hashing and commitment findings](#hashing-and-commitment-findings)
- [Transaction-binding and authorization findings](#transaction-binding-and-authorization-findings)
- [Program-placement findings](#program-placement-findings)
- [Gas-griefing and call-graph findings](#gas-griefing-and-call-graph-findings)
- [Storage, contention, and migration findings](#storage-contention-and-migration-findings)
- [Compiler/code-generation findings](#compilercode-generation-findings)
- [Additional calibrated patterns](#additional-calibrated-patterns)
- [Useful negative results](#useful-negative-results)
- [Unresolved integration boundaries](#unresolved-integration-boundaries)

## Use evidence safely

Distinguish three evidence classes:

1. Treat an **accepted optimization** as present only in that track's
   independent champion.
2. Treat an **observational result** as evidence about one intervention. The
   harness always discarded it, even when both metrics improved.
3. Treat a **probe** as a calibrated cost or anti-pattern, not a candidate to
   copy.

Check reachability before interpreting a delta:

- helper-only tests can move gas while deployable predicate/script bytes stay
  unchanged;
- ABI, storage, predicate-main, and script-main edits can move bytes while an
  older helper fixture reports zero gas;
- a zero gas result does not make an unexecuted storage/call path free;
- a zero byte result can mean test-only/dead code or alignment padding.

Inspect per-benchmark and per-artifact vectors. Same-package layout changes
moved unrelated benches by one to dozens of gas, while cross-package benches
were generally stable. Never accept a total improvement that conceals a
sibling regression or a weakened invariant.

## Prefer these readable defaults

Apply these by default before considering unrolling or asm:

1. Remove a repeated storage read, transaction getter, hash, scan, call site,
   allocation, or unchanged write.
2. Snapshot an immutable loop bound or stored scalar only when the value cannot
   change across a call or mutation.
3. Reject malformed/expired transaction shapes before witness scans, hashes,
   storage lookups, and bounded kernels when the accepted set is identical.
4. Order short-circuit checks by measured intrinsic cost and expected
   selectivity; do not assume type, owner, or asset is universally first.
5. Use fixed arrays for small fixed bounds and keyed storage for direct access.
6. Build values in locals and write once; do not unconditionally write an
   unchanged aggregate.
7. Stream one complete commitment instead of a multi-round hash tree when
   field coverage, ordering, types, and domains remain identical.
8. Deduplicate a substantial unbenchmarked block across entrypoints; keep hot
   loop bodies inline.
9. Use compact, idiomatic control flow that has measured well in the same
   context, then verify release code:
   - `if let` for large predicate-data success paths;
   - explicit `match` for `Option<bool>` replay defaults;
   - native predicates such as `ContractId::is_zero()`.
10. Preserve obvious names, helpers, bounds, and invariants even if a more
    obscure source shape saves a few gas. Escalate only when the user requests
    maximum optimization or the measured hot path justifies it.

## Accepted champion outcomes

Keep gas and contract-size champions separate; do not add them across
objectives.

| Scenario | Objective | Accepted | Gas delta | Byte delta |
|---|---:|---:|---:|---:|
| Collateralized lending | Contract size | 3 | -488 | -416 B |
| Collateralized lending | Gas | 4 | -8,943 | -360 B |
| Cross-domain bridge | Contract size | 7 | -6,609 | -328 B |
| Cross-domain bridge | Gas | 9 | -11,128 | -248 B |
| Order book | Contract size | 6 | -140 | -296 B |
| Order book | Gas | 6 | -5,787 | -80 B |

Reusable landed mechanisms:

- Lending size:
  - predicate `if let` decode: 0 gas/-32 B;
  - explicit replay bool match: -8 gas/-16 B;
  - explicit `Input::Coin` dispatch: -480 gas/-368 B.
- Lending gas:
  - reuse predicate collateral valuation: -32 gas/0 B;
  - carry two seeded values in a 32-round setup: -124 gas/0 B;
  - bundle debt-index/funding-bound hoists with coin dispatch:
    -4,708 gas/-344 B;
  - bundle position-count hoists with replay decoding:
    -4,079 gas/-16 B.
- Bridge size:
  - reuse relay output amount: -6 gas/-72 B;
  - share predicate failure epilogue: 0 gas/-16 B;
  - compose roots from stored commitments: -6,559 gas/-176 B;
  - reuse validator bound/values: 0 gas/-16 B;
  - explicit consumed/executed replay bool decoding: 0/-16 B and
    -44/-16 B;
  - predicate `if let` decode: 0 gas/-16 B.
- Bridge gas:
  - cache execute message bound: -1,357 gas/0 B;
  - carry seeded amount/nonce: -64 gas/0 B;
  - package verify-bound caching with rejected-count derivation:
    -2,696 gas/0 B;
  - hoist quorum threshold: -28 gas/0 B;
  - asset-first relay filtering for the measured shape: -198 gas/0 B;
  - bundle shared execute bound with committed-root composition:
    -6,742 gas/-160 B;
  - explicit gateway replay decoding: -37 gas/-16 B.
- Order-book size:
  - merge contract-ID guards: -1 gas/-8 B;
  - deduplicate settlement lookup: 0 gas/-120 B;
  - merge settlement validity/replay guards: 0 gas/-8 B;
  - predicate `if let` decode: 0 gas/-40 B;
  - explicit fee-vault replay bool decode: 0 gas/-16 B;
  - use `ContractId::is_zero()`: -139 gas/-104 B.
- Order-book gas:
  - cache analysis order count: -2,714 gas/0 B;
  - cache repeated fixed-array element: -18 gas/0 B;
  - prioritize clearing-price rejection: -12 gas/0 B;
  - package execute count caching with ID checks: -1,428 gas/-24 B;
  - package seed aggregate reuse with zero checks: -1,570 gas/-56 B;
  - carry remaining seed progression with guard merge: -45 gas/0 B.

## Gas findings

### Remove storage work

Use these measurements to rank opportunities, not as target-node constants:

- one duplicate full `Position` read in each of eight iterations:
  +13,289 total gas, about 830 gas/read;
- one duplicate scalar order/message count per eight iterations:
  about +1,560 gas, about 195 gas/read;
- one extra liquidation epoch read per matched deactivation:
  +1,586 target gas;
- duplicate bridge message reads in verify/execute:
  roughly +7,000 gas;
- storage write inside a 365-round accrue loop:
  +122,304 gas;
- unconditional writeback of unchanged orders:
  +4,836 gas.

Read once, compute locally, and write once when:

- the value is immutable over the region;
- no external call can mutate it;
- replay/failure checks still happen before mutation;
- the cached object cannot become stale between assessment and consume.

Expect a local snapshot to cost 8-24 bytes in some contexts. Find a measured
same-package structural shrink when a strict byte/layout gate applies.

### Remove transaction getters

Measured examples:

- duplicate `input_asset_id`: +429 gas;
- recompute `tx_id()` per bridge input: +53 gas;
- cache complete entrypoint/script counts: -21 to -156 gas, sometimes +8 B;
- reuse matching output amount: -6 gas/-72 B;
- pattern-match input eligibility: -375 gas/-240 B;
- explicit `Input::Coin` dispatch: -480 gas/-368 B.

Do not add locals without removing work. Predicate intent-field caching
regressed 19 gas/32 B; cold lane-field caching regressed 48 gas/8 B.

### Reject invalid work early

Place a cheap independent reject before expensive work when semantics match:

- malformed controlled policy inputs: -1,280 gas/+16 B;
- malformed rollover outputs: -1,251 gas/+8 B;
- invalid recipient output before witness/hash work: -1,251 gas/-8 B;
- expired oracle lane before repeated scan: -3,960 gas/0 B;
- quote then expiry: -3,904 gas/0 B;
- quote, liquidity, then expiry: -3,832 gas/0 B.

Avoiding the bounded scan produced most of the oracle win. Retaining one or
two cheap validations adjusted only the residual cost.

Ordering depends on real selectivity:

- owner-first saved 150 gas/8 B in one transaction scan;
- asset-first saved 165 gas in an authorization scan and 198 gas in a bridge
  scan;
- changing that bridge shape to kind-first regressed 198 gas.

Benchmark valid, early-invalid, and late-invalid shapes separately.

### Reduce loop work

- Kernighan sparse popcount: -441 gas/-8 B versus 64 fixed rounds.
- Stop a sparse mutation scan when no bits remain: -468 gas/+16 B.
- Reverse triangular pair traversal: -63 gas in a registry and
  -116 gas per predicate duplicate bench.
- Maintain a reverse index: -15 gas.
- Maintain a forward `i + 1` counter: +10 gas regression.

Eliminate iterations or expensive operations. Do not replace cheap forward
indexing with extra state/branches.

### Treat full unrolling as an explicit tradeoff

Forc 0.71.2 did not generally unroll fixed loops. Full Sway/asm unrolls saved
roughly 69-388 gas for common eight/sixteen-lane kernels but live contracts
often grew 80-848 B. A large matching loop grew 2,096 B and regressed gas.

Partial-unroll results were usually poor:

- four-way trace: -30 target gas/+160 B versus full -143/+376 B;
- factor-four contention: -36 gas/+368 B;
- one differential factor-two case: +112 gas/-608 B.

Use [maximum-optimization.md](maximum-optimization.md) only when this tradeoff
is explicitly desired.

### Keep compiler-friendly arithmetic

Usually retain constant multiply/modulo:

- branchy add/compare/subtract recurrences regressed 135-328 gas and
  40-56 B;
- wrap-counter replacement for `% 8`: +258 gas;
- bitmap shift/OR versus multiply/add: 0/0;
- short affine counter rewrites: small regressions.

Use strength reduction only after it removes substantial repeated work without
adding branches. A 32-round, two-multiply seed rewrite saved 124 gas/0 B.

### Avoid allocation and unchanged writes

- `Vec` materialization for eight policy scores: +616 gas;
- per-round storage writes: +122,304 gas;
- unchanged full-order writebacks: +4,836 gas.

Prefer fixed arrays, known-capacity memory, and conditional state updates.

## Contract-size findings

### Delete structure, not source lines

Reliable reductions:

- one explicit enum dispatch: -368 B;
- one complete streamed hash replacing five hashes: -2,808 B;
- one nested complete hash replacing five hashes: -2,392 B;
- cross-entrypoint settlement block dedup: -120 B;
- one duplicated output accessor call site: -72 B;
- reuse stored bridge commitments: -176 B;
- collapse capability status to one nested hash: -480 B.

Extract a helper for a substantial unbenchmarked duplicated block. Keep hot
loop bodies inline:

- settlement helper: -120 B/0 gas;
- shared lending evaluation inside hot loops: only -8 B but
  +296/+600 gas;
- outlined risk iteration: +56 B/+897 gas.

### Use compact control flow selectively

Measured predicate `if let` savings:

- lending: -32 B;
- order book: -40 B;
- architecture fixture: -24 B;
- bridge: -16 B.

Measured default decoding:

- explicit `Option<bool>` match: -16 to -32 B across several packages;
- explicit `Option<u64>` match: +24 B;
- explicit amount match: +24 B;
- six-bool tuple match: +160 B/+50 gas.

Do not turn the narrow bool/intent results into a universal "match is smaller"
rule.

### Merge guards and native tests

- merge adjacent ID guards: -8 B;
- merge validity/replay guards: -8 B;
- use `ContractId::is_zero()` instead of repeated zero construction:
  -104 B/-139 gas.

Preserve left-to-right evaluation, revert semantics, and side effects.

### Reuse authenticated commitments

Bridge root composition from already stored sender/payload commitments plus
amount saved 6,559 gas/176 B. Additional chaining cost 9,401 gas/240 B.

Reuse only if stored commitments already cover the same:

- fields and type widths;
- order;
- domain;
- mutability/lifetime;
- producer/consumer encoding.

### Expect coarse byte quanta

Most `.bin` deltas were multiples of 8 bytes. Target a whole call site or
block. A small source cleanup can remain at 0 B due to lowering/alignment.

### Avoid size traps

- live loop unrolling: +96 to +2,232 B;
- unrolled median network: +544 B for -252 gas;
- precomputed `b256` literals: +216 B versus hashing constant input;
- extra hash shapes: hundreds of bytes;
- script locals: frequently +8 B;
- simple temporary removal: commonly 0/0;
- inline attributes: neutral in one bridge path and harmful when a hot
  order-loop outline was honored.

## Hashing and commitment findings

### Minimize hash rounds without dropping coverage

Measured costs:

- remove two authorization hashes: -554 gas/-464 B;
- add two adapter hashes: about +583 gas per target/+440 B;
- pair-fold eight observations:
  -2,344 gas predicate, -984 gas receipt contract, -1,072 gas script;
- duplicate assessment digest: about +6,500 gas per eight-position
  assessment/+112 B;
- duplicate pure script key hash: +4,122 gas/0 B;
- one-shot ordered folds: -1,005 to -15,821 gas.

The transaction-binding fixture priced one redundant hash word at about
123 gas/round. The migration fixture priced one SHA invocation at roughly
277-292 gas.

### Prefer one complete streamed encoding

For the same 13 fields:

- one explicit `Hasher`: -6,256 gas/-2,808 B versus five hashes;
- one nested `7+6` tuple: -5,620 gas/-2,392 B;
- explicit `Hasher` advantage: about 636 gas/416 B.

A separate one-SHA four-field test found a capacity-matched `Hasher`
34 gas/bench cheaper than `sha256(tuple)` at 0 B. Tuple and manual streaming
were not canonicalized.

### Respect tuple-width/toolchain limits

Flat 11-, 12-, and 13-field hashes failed due to missing `Hash`
implementations. Eight was the widest directly measured flat tuple. Use nested
tuples or a capacity-matched `Hasher`.

### Keep security semantics

Never optimize a commitment by dropping:

- chain/application/subdomain;
- transaction class or script/contract/method;
- nonce, policy/schema version, authority epoch;
- input/output type, owner, recipient, asset, amount;
- ordering/index when relevant;
- witness payload/content;
- transaction identity when required for replay.

Hashing only snapshot counts saved 2,766 gas but intentionally collapsed
distinct snapshots. Treat it only as a payload-cost calibration.

Direct bool hashing beat converting each bool to `u64`; conversion cost
472 gas over eight values.

## Transaction-binding and authorization findings

### Bind the complete intended transaction class

Review:

- Fuel chain ID;
- application/protocol/subdomain;
- transaction type;
- script bytecode hash when a specific script is authorized;
- target contract/method;
- policy/schema/version and authority epoch;
- transaction ID where instance binding is required;
- nonce or policy-UTXO rollover;
- input/output discriminants;
- exact controlled input/output counts and uniqueness;
- owner, recipient, asset, amount, and net asset flow;
- witness index, length, and content/commitment;
- expiration/validity.

Measured costs:

- complete input type/owner/predicate-data length: +2,987 gas/0 B;
- output discriminant: +373 gas/+624 B;
- four explicit subdomain tags: +2,597 gas/+848 B;
- selected witness length: +208 B;
- chain ID in predicate commitment: +266 gas/+72 B;
- require `Transaction::Script`: +55 gas/+520 B;
- bind script bytecode hash: +7,564 gas/+360 B;
- require rollover input bytecode: +5 gas/+184 B;
- bind rollover `Coin` output: +12 gas/+392 B;
- exact consideration output count: +3 gas/+16 B;
- recipient net gain: +9 gas/+136 B in one fixture; +232 B in another.

Treat these as prices for explicit security, not removable overhead.

### Do not infer signers from volume

- sparse bitmap popcount can be cheap;
- reject bitmap bits beyond configured signer positions (+24 B);
- witness count/index does not bind payload content;
- payload length still does not prove signer identity;
- require signer uniqueness and witness-to-policy membership.

### Synchronize encodings across packages

Normalizing a predicate witness-index width to the auditor's `u64` encoding
saved 54 gas/128 B and removed a root discrepancy.

Keep field order, type width, discriminants, nesting, tags, and defaults
identical across registry, auditor, predicate, script, and contract copies.

### Use explicit output discriminants

Attempted direct `Output` hashing/comparison failed, and default getters can
collapse distinct variants. Match the variant to a numeric discriminant and
hash the discriminant plus relevant fields.

### Bind net consideration and uniqueness

Gross output can count the beneficiary's own inputs. Require matching outputs
minus matching beneficiary inputs to meet consideration. Prevent one output
from satisfying multiple controlled inputs through exact counts/indices.

### Reject unusable cross-chain registration

When execution checked chain but a registry nonce key omitted it, a cross-chain
record could consume a local replay key. Rejecting it at registration cost
32 B.

### Do not mistake a nonzero hash for authentication

Removing a practically-never-false terminal `hash != zero` saved 456 B and
revealed that the predicate did not enforce the purported executor. Compare a
commitment with an authenticated expected value or use it in a replay decision.

## Program-placement findings

### Stateful contract

Use for mutable nonce, epoch, freeze, revocation, usage limits, and shared
policy. Measured:

- repeated policy read: +848 gas/+80 B;
- carry full assessed policy into consume: -786 gas/+112 B;
- compact epoch/nonce revalidation before mutation: +11 gas/+48 B;
- reuse receipt counter snapshot: 0 gas/-32 B.

Removing a separate consumed-replay write under strict sequential
nonce+epoch semantics saved 43 gas/360 B in one fixture. Do not generalize:
prove atomic nonce advance covers concurrent, reentrant, batched, resumable,
and non-sequential states first.

### Stateless predicate

Use only when the complete rule is transaction-local. Account for per-spend
code/data, policy rollover, exact conservation/uniqueness, chain/transaction
class, and script binding. A predicate cannot trust mutable contract state.

### Hybrid

Use only for a concrete revocation/recovery requirement:

- shared vault registry lookup removed 112 B but adds a dynamic read to the
  predicate-only path;
- path-aware rollover helper sharing added 160 B;
- sharing only `nonce + 1` was 0/0.

Compare accepted sets and replay strength, not only helper gas.

## Gas-griefing and call-graph findings

### Use entrypoint fixtures

The original gas-griefing helper track could not measure storage misses,
fanout, late reverts, predicate/script scans, refunds, receipts, or forwarded
gas. Treat its results as compiler history.

The entrypoint successor measured:

- oracle lane-field hoist: -313 gas/-56 B;
- early expired-lane rejection: -3,832 to -3,960 gas/0 B;
- router full unroll: -1,016 gas/+256 B, only a loop tradeoff;
- several caches that regressed both axes.

Bound attacker-controlled loops, reject before bounded work, compare
first-invalid/last-invalid shapes, cap retries/fanout, and test rollback.

### Preserve independent callee validations

Keep checks for echoed nonce, accepted flag, digest, work score, callback
outcome, and post-call state when each detects a distinct malicious mode.
Digest overlap on honest data does not prove redundancy against a malicious
callee.

Apply checks-effects-interactions. Set callback guards before the call. Cache
post-call snapshots only after proving every reachable callback cannot mutate
them; one safe static cache removed 24 B.

Packing permission booleans for hash serialization saved 102 gas/0 B, while
packing transcript flags regressed 136 gas/64 B. Pack serialized payloads, not
bool arrays indiscriminately.

The unit fixture still did not price successful callback depth, forwarded gas,
receipt saturation, or node rollback.

## Storage, contention, and migration findings

### Storage code generation

- cache duplicated epoch read: -32 B;
- cache active version: -56 B;
- explicit local-read counter update: -8 to -16 B;
- delay independent storage reads: often 0/0;
- explicit `Option<bool>` replay match: -32 B;
- explicit u64 default match: +24 B.

### Do not add redundant preflight passes by default

Storage-entrypoint results:

- split frozen-state gate: +773 gas/+120 B;
- adjacent "hot-key" aggregate reuse: +12 gas/+144 B;
- duplicate/frozen/version preflights: +6 to +16 gas and +104 to +176 B.

Enforce an invariant in the existing atomic transition unless early failure
itself is the goal. Independent split-map read scheduling repeatedly measured
0/0. A conditional idempotent epoch write added 104 B without a gas-visible
path.

Do not call sequential unit-test storage gas "contention." True contention
requires concurrent identical/disjoint key transactions and node
conflict/retry metrics.

### Preserve migration state-machine edges

Measured hardening:

- contiguous accepted shard equals committed prefix: +2 gas/+48 B;
- interruption position equals checkpoint: +2 gas/+48 B;
- require adjacent target when rollback uses `active_version - 1`:
  0 gas/+48 B;
- reject all-zero proof when zero is invalid: 0 gas/+80 B;
- reject zero-account receipt: 0 gas/+24 B;
- cap receipt to executable eight-account batch: 0 gas/+40 B.

Keep coordinator/script plan and receipt encoding synchronized across source
and target versions, layout/code hashes, plan root, shard/range, authority
epoch, nonce/domain, and validity window.

Snapshot results varied:

- phase reuse: -2 gas/-32 B;
- predicate transaction shape: -63 gas/0 B;
- script transaction shape: -23 gas/+8 B;
- script transaction ID: +8 gas/-16 B;
- active version: 0 gas/-56 B;
- coordinator decision version: 0 gas/-24 B.

Use an SDK/node harness for process restart, multi-transaction recovery,
rollback after partial persistence, and stale-client deployment behavior.

## Compiler/code-generation findings

Treat these as `forc 0.71.2` facts:

- bool `match` versus `if/else`: -72 B/+226 gas in one kernel;
- router bool match replication: +16 B/+24 gas;
- storage hash `match` to `if/else`: -24 B/-48 gas;
- `&&` to early returns: +32 B/+14 total gas, reject path -2;
- reorder `&&`: reject path -6 gas/0 B;
- six-bool tuple match: +160 B/+50 gas;
- `Option<bool>` matches: repeatedly smaller;
- `Option<u64>` explicit match: larger;
- duplicate pure key hash: +4,122 gas, not CSE'd;
- explicit repeated-introspection local: +56 B;
- small helper manual inline: +64 B for about -2 gas;
- aggregate mutate-then-return: +96 gas/+136 B;
- build struct in loop then consume fields: about 54 gas/item;
- local storage-counter spelling: -8 to -16 B;
- direct bool hashing cheaper than bool-to-u64 conversion;
- same-width hash field reorder: approximately neutral;
- simple temporary removal/inlining: often 0/0.

Useful Sway 0.71.2 pitfalls:

- flat 11/12/13-field hash tuples can lack `Hash`; nest or stream;
- attempted direct `Output` `Hash`/`PartialEq` forms failed; use a
  discriminant;
- expression-position bool `as u64` failed; use an `if` value or asm;
- attempted `mut` match-pattern form failed; shadow into a mutable local;
- smaller integer source types do not imply smaller FuelVM registers;
- `log`/typed `require` can change ABI logged types.

## Additional calibrated patterns

Retain these narrower results for analogous hot paths. Reproduce them before
production use.

### Control flow, loops and scans

| Intervention | Observed result | Lesson |
|---|---:|---|
| XOR/OR snapshot-difference accumulation | -6 gas/0 B | Branchless aggregation can beat early return in one fixed validator |
| Track maximum depth and assert once after loop | -7 gas/0 B | Repeated in-loop asserts are not necessarily free |
| Affine fold offset as induction variable | -6 gas/+8 B | Small gas win can cost code; use only under a gas objective |
| Same affine rewrite in a different call-graph context | +1 gas or -6 gas/+8 B | Transfer is package/function specific |
| Hoist modulus shared by two transcript branches | 0 gas/-8 B | Branch-tail dedup can be a size-only win |
| Remove write-only callback counter update | +3 total gas/-168 B | Dead storage code can be large; sibling gas can move from layout |
| Direct expression-form duplicate surcharge | -25 gas/0 B | Small branch-form improvements can be context-local |
| Phase-directed early returns | -23 gas/+40 B | Faster decision control flow can grow bytecode |
| Bool-to-value liveness penalty | +39 gas/-48 B | Smaller branch encoding can be slower |
| `i != n` instead of `i < n` | +9 to +38 gas in fixed loops; ±8 B in dynamic scans | Ordered `<` was never worse in measured cases |
| Count-down loop | 0 gas/-8 B | A small size shape can be gas-neutral |
| Expression-position branch | 0 gas/-8 B | Compact branch expression can save one word |
| Explicit six-guard early returns | accept +16 gas, reject -2 gas, +32 B | Optimize the path distribution, not one path alone |

### Hash, aggregate and storage micro-results

| Intervention | Observed result | Lesson |
|---|---:|---|
| Inline loop-produced struct fields instead of materializing aggregate | -432 gas/0 B over eight items | Avoid one-use aggregates inside loops |
| Mutate aggregate then return | +96 gas/+136 B | Prefer locals then one construction |
| Cache doubled storage epoch read | 0 gas/-32 B | Storage expression CSE was absent statically |
| Reuse coordinator version decision | 0 gas/-24 B | Thread authoritative snapshots through consume |
| Cache guarded post-call snapshots | 0 gas/-24 B | Safe only with a closed callback mutation surface |
| Fuse duplicate policy approval scans | 0 gas/-88 B | Fuse cold duplicated scans for size |
| Nested capability/status hash eliminated | +18 total gas/-480 B | Direct path was unbenched; interpret primarily as size |
| Nested domain-first script/capability subhash | +558/+560 gas and up to +200 B | Do not add an inner hash only to label a domain |
| Precompute layout hashes as wide literals | -490 total gas/+216 B | Literal materialization can exceed constant hashing in bytes |
| Duplicate one hash reduction in an eight-round fold | +24 gas/0 B | Even one redundant modulo/hash-adjacent reduction survives |
| Re-associate same-width commitment fields | about +8 total gas/0 B | Field order was near-neutral but not guaranteed exact |

### Transaction and predicate entrypoint details

| Intervention | Observed result | Lesson |
|---|---:|---|
| Cache predicate input/output counts | -67 gas/0 B | Complete predicate entrypoint count caching can pay |
| Cache predicate witness count | -50 gas/-24 B | Reuse a count that gates several checks |
| Cache script input/output count | -22/-1 gas, 0 B | Input getter mattered more in that shape |
| Move missing-witness reject early | 0 gas/+8 B | Not every early guard pays; measure |
| Require exact consideration output | +3 gas/+16 B | Exactness can be cheap |
| Bind policy rollover input bytecode | +5 gas/+184 B | Complete binding can be byte-heavy |
| Bind policy rollover Coin output | +12 gas/+392 B | Output-shape completeness has real artifact cost |
| Require `Transaction::Script` | +55 gas/+520 B | Transaction-class restriction is not a free check |
| Bind script bytecode commitment | +7,564 gas/+360 B | Strong explicit script binding is expensive in this encoding |
| Normalize witness-index width | -54 gas/-128 B | Consistent types can improve both correctness and cost |

### Compiler nulls and adverse controls

Keep these as stop signals:

- sinking branch-exclusive construction: 0/0;
- staging one arithmetic term/local: commonly 0/0 or worse;
- small `if/else` versus `match` dispatch: sometimes byte-identical;
- deleting a generic identity wrapper: +12 gas/+16 B;
- manually inlining a small helper: about -2 gas/+64 B;
- repeated transaction introspection bound local in some predicate/script
  loops: 0 B or +8 B;
- storage read scheduling without changed work: repeatedly 0/0;
- callback result mutable-local versus branch result: 0/0;
- validating callee return before static snapshot reads: 0/0 in the current
  gas surface;
- loop-invariant arithmetic association: frequently 0/0.

## Useful negative results

Avoid by default:

- speculative locals and manual CSE;
- source-line cleanup without removed operations;
- large/full or partial unrolling in live contracts;
- helper calls inside hot loops;
- extra preflight scans;
- branchy constant-multiply/modulo recurrences;
- `Vec` for tiny fixed arrays;
- precomputed wide literals merely to avoid constant hashing;
- added hash nesting or domain hashes when one complete encoding suffices;
- storage-read scheduling presented as cache warmth;
- cross-package byte headroom expected to fix same-package layout regressions;
- guard/commitment deletion for benchmark improvement;
- any total win with one sibling benchmark or security invariant regression.

Treat exact zero as evidence. Determine whether it means canonical lowering,
unreachable code, or artifact padding before generalizing.

## Unresolved integration boundaries

Require purpose-built SDK/target-node tests for:

- target-node fees/refunds and consensus gas;
- serialized predicate code/data costs;
- wallet resource selection;
- forwarded gas, successful callback depth, and receipts;
- multi-contract success followed by late failure;
- process restart/multi-transaction migration recovery;
- parallel scheduler, mempool and contract-UTXO contention/conflicts;
- full signer cryptographic verification and uniqueness;
- duplicate input/output matching under all transaction shapes.
