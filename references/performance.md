# Performance

Measured figures verified on pinned forc `0.71.2` release builds
(434-iteration research corpus, 2026-07 snapshot).
Measure the release artifact and final transaction against the target node.
Never remove authorization, asset validation, overflow checks or reentrancy
protection to improve a benchmark.

- [Default to readable optimization](#default-to-readable-optimization)
- [Attribute cost by layer](#attribute-cost-by-layer)
- [Use measured high-value levers](#use-measured-high-value-levers)
- [Avoid measured performance traps](#avoid-measured-performance-traps)
- [Benchmark what ships](#benchmark-what-ships)
- [Optimize storage and collections](#optimize-storage-and-collections)
- [Count transaction-amplified work](#count-transaction-amplified-work)
- [Maintain a regression baseline](#maintain-a-regression-baseline)
- [Escalate only for maximum optimization](#escalate-only-for-maximum-optimization)

## Default to readable optimization

This section is the canonical statement of the skill's optimization defaults;
other modules point here. Prefer the clearest form that removes real work.
Use this order:

1. Delete repeated storage reads/writes, transaction getters, hashes, calls,
   scans, allocations or duplicated blocks: read authoritative state once per
   phase and write once.
2. Reject invalid transaction shapes before bounded work when the accepted set
   remains identical.
3. Cache an immutable value only when no call or mutation can stale it.
4. Use fixed arrays and keyed access for small/bounded work, and construct an
   aggregate once from locals instead of mutating then returning it.
5. Stream one complete canonical commitment instead of a deep hash tree, with
   every field, width, order and domain intact.
6. Apply a measured compact control-flow form in the same context.
7. Keep the readable version unless a remaining hot path justifies a
   compiler-sensitive transform.

Do not default to full unrolling, raw asm, wide commitment rewrites, branchy
strength reduction, or code-layout tricks; keep fixed bounded loops readable
rather than unrolling them speculatively. When a measured hot path does
justify asm or a compiler-sensitive kernel, isolate it behind a typed Sway
interface and retain a readable Sway oracle to differential-test against. Load
[maximum-optimization.md](maximum-optimization.md) only when the user asks for
maximum gas/size or accepts reduced readability.

The measurements in this module come from a 434-iteration research corpus on
pinned `forc 0.71.2` release builds. Treat them as strong fixture/compiler
evidence for ranking opportunities, not as target-node constants; re-measure
on the project pin.

## Attribute cost by layer

| Layer | Measure | Typical lever |
|---|---|---|
| Transaction | Serialized bytes, I/O/witness count, predicate duplication | Remove unnecessary fields while preserving required change/variable/contract outputs |
| VM | Gas, instructions, bytecode, call depth | Release build, bounded loops, fewer copies/hashes/calls |
| Storage | Unique first touches, reads/writes/clears | Cache locally, compute then write once, keyed access |
| Memory | Allocation/capacity growth, aggregate copies | Preallocate, use bounded arrays, avoid repeated copying |
| Concurrency | Contended UTXOs/contracts/state | Partition truly independent resources/state |
| Node/network | Active costs and limits, latency | Query and preflight the target node |

Reducing source lines is not evidence of lower cost.

## Use measured high-value levers

For forc 0.71.2 research fixtures, prioritize:

- **Storage work:** repeated scalar loop reads cost roughly 170-196 gas each;
  a repeated full `Position` read cost about 830 gas; a re-read epoch cost
  1,586 gas; duplicate bridge message reads cost roughly 7,000 gas. Read
  once/write once when semantics allow.
- **Storage writes:** a write inside a 365-round loop cost +122,304 gas
  versus writing once after; unconditionally writing back unchanged
  aggregates cost +4,836 gas. Write only changed state, outside loops.
- **Failure position:** early entrypoint rejection saved about 1,250 gas on
  malformed transaction-shape gates and 3,832-3,960 gas on expired oracle
  lanes by avoiding witness/hash/bounded work. Early rejection is safe only
  when the accepted transaction set, required accounting/authorization, and
  caller-observable failure metadata are unchanged, replay/mutation order is
  preserved, and no constant-work policy forbids variable-time rejection.
- **Transaction getters:** repeated getters survived release optimization —
  a duplicate `input_asset_id` cost +429 gas, recomputing `tx_id()` per
  input +53 gas; caching complete entrypoint counts saved 21-156 gas.
  Remove call sites or use enum dispatch rather than adding speculative
  locals.
- **Hash rounds:** one complete streamed commitment beat multi-hash trees by
  thousands of gas and bytes when every field/domain remained intact. One
  redundant hashed word cost about 123 gas/round; a whole SHA invocation
  roughly 277-292 gas.
- **Structural size:** remove a whole accessor/helper block, merge equivalent
  guards, use `if let` for measured predicate decode shapes, and explicitly
  match `Option<bool>` replay defaults, but retain `unwrap_or` for scalar
  defaults unless release measurement favors a match. Bytecode moves in
  8-byte quanta — target a whole call site or block; sub-word cleanups often
  land at 0 B.
- **Sparse work:** iterate set bits (a Kernighan popcount saved 441 gas over
  a fixed 64-round count) or stop a scan when remaining work is empty
  (-468 gas) instead of always traversing a large fixed domain. Eliminate
  iterations; do not replace cheap forward indexing with extra counters or
  branches (a maintained counter regressed 10 gas).
- **Allocation:** materializing a `Vec` for eight fixed scores cost
  +616 gas; keep small fixed arrays.

The top lever in `#[storage(read, write)]` code is hoisting the slot out of
the loop:

```sway
// Before: a storage read and a storage write on every iteration.
let mut i = 0;
while i < rounds {
    storage.total.write(storage.total.try_read().unwrap_or(0) + reward(i));
    i += 1;
}

// After: read once, accumulate in a local, write the changed value once.
let mut total = storage.total.try_read().unwrap_or(0);
let mut i = 0;
while i < rounds {
    total += reward(i);
    i += 1;
}
storage.total.write(total);
```

Apply this only when no call inside the loop can observe or mutate the slot.

Short-circuit order depends on real intrinsic cost and input selectivity.
Owner-first, asset-first and type-first produced different results in different
fixtures. Benchmark valid, early-invalid and late-invalid transactions.

Package layout matters. A large target improvement can move an unrelated
same-package bench upward. Inspect every benchmark and prefer a measured
same-package size offset when packaging a gas hoist.

## Avoid measured performance traps

Avoid by default:

- manual locals/CSE that do not delete an operation;
- helpers inside hot loops;
- unconditional writes of unchanged aggregates;
- `Vec` materialization for tiny fixed arrays;
- add/branch recurrences replacing cheap constant multiply/modulo;
- redundant preflight passes when the existing atomic transition enforces the
  invariant (a split frozen-state gate cost +773 gas/+120 B; duplicate
  preflights +6-16 gas and +104-176 B each);
- partial unrolling, which often pays nearly full byte cost for a small gas
  gain;
- full live-contract unrolling without an explicit size tradeoff;
- precomputed wide literals merely to avoid a constant hash;
- added hash nesting or dropped commitment fields;
- new generic instantiations and wide tuple encoders, which can add
  substantial monomorphized code;
- optimization claims based only on total gas.

Treat exact-zero deltas as evidence. Determine whether the source was
canonicalized, unreachable for that metric, or hidden by artifact alignment.

## Benchmark what ships

At Sway `v0.71.2`, debug used `Opt0` and release used `Opt1`, with different
panic/backtrace behavior. Run the standard verification ladder first (see
[testing-and-debugging.md](testing-and-debugging.md)), then capture release
measurement output:

```sh
forc build --release --locked --ir initial final --asm final --bytecode
forc build --release --locked --time-phases
forc build --release --locked --metrics-outfile build-metrics.json
forc parse-bytecode out/release/<package>.bin
```

Verify flags on the active compiler. Record bytecode hash/size, ABI, storage,
configurable offsets and contract ID.

Check metric reachability before interpreting any delta: helper-only tests
can move gas while deployable bytes stay unchanged; ABI/storage/entrypoint
edits can move bytes while a detached helper bench reports zero gas; a zero
gas delta does not make an unexecuted path free; a zero byte delta can mean
test-only/dead code or alignment padding. In the research corpus, an
optimization was accepted only with a total-metric improvement, no individual
benchmark regression, no aggregate byte growth (gas tracks) or individual
artifact growth (size tracks), and unchanged ABI/storage artifacts — hold
production changes to the same bar.

## Optimize storage and collections

The first access to a storage slot is relatively costly; reuse does not make
broad scans cheap. Read once, work in locals and write once when semantics
allow. Prefer `StorageMap` keyed access to unbounded `StorageVec` scans or
middle insert/removal. Bound and paginate iterable state.

For fixed small sizes, consider arrays. For dynamic memory with known capacity,
preallocate `Vec`. Measure large by-value aggregates, hashing and copies.
Review release-specific standard-library implementations because storage and
collection operation costs can change.

Do not cache a pre-call storage value for post-call validation unless every
reachable callback is proven unable to mutate it. Do not describe reordered
single-transaction storage accesses as cache warmth or contention relief.

## Count transaction-amplified work

- Each external call adds contract I/O, call-frame and receipt work.
- Never place unbounded external calls in a loop.
- Dynamic address transfers can require variable outputs.
- Predicate code/data is carried in inputs and executes per predicate input.
- Logs, transfers and calls consume receipt capacity.
- Batching can reuse contract I/O/hot slots but add inputs, outputs and
  witnesses.

Benchmark the complete constructed transaction, not an isolated Sway function.

## Maintain a regression baseline

Record for each important operation:

- toolchain, node, chain and gas table;
- release bytecode hash/size;
- serialized transaction size;
- input/output/witness counts and bytes;
- predicate count, code/data size and gas;
- gas used and fee estimate;
- storage touches/read/write/clear counts;
- calls, logs/transfers and receipts;
- worst valid input/loop bound;
- latency and contention scenario where relevant.

Set reviewed absolute and percentage CI thresholds. Rebaseline only with an
explanation of semantic/toolchain changes. At `v0.71.2`, `forc test
--gas-costs` parsed `built-in`, `mainnet`, `testnet` and a file path, but only
`built-in` was implemented; the other sources failed at runtime. Do not plan
deterministic CI around a pinned gas-cost file through this flag on that
release. For network-accurate numbers, query the target node's gas costs and
compare them in a separate live smoke check.

Optimization loop:

1. Prove the invariant and capture the baseline.
2. Identify transaction, storage, VM, memory, call or contention bottleneck.
3. Make one change.
4. Compare release artifact, gas, transaction bytes and outputs.
5. Rerun negative authorization, asset, revert and integration tests.
6. Preflight the worst case at target-node limits.

## Escalate only for maximum optimization

If readable structural changes cannot meet the budget and the user explicitly
prioritizes maximum optimization:

1. inspect final IR/ASM/bytecode;
2. try one controlled source-shape or unroll factor;
3. measure the Sway ceiling before using asm;
4. retain a readable Sway oracle/reference;
5. prove overflow, trap, commitment, storage and call equivalence;
6. document the maintenance/readability cost.

Use [maximum-optimization.md](maximum-optimization.md) for the full unrolling,
assembly, immediate-width, register, and aggressive codegen workflow.
