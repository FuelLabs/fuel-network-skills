# Maximum optimization

Measured figures verified on pinned forc `0.71.2` release builds; VM
immediate/trap semantics verified at `fuel-vm` `v0.66.4`.
Load this module only when the user explicitly asks for maximum gas reduction,
minimum bytecode, raw FuelVM assembly, compiler/codegen exploration, or accepts
lower readability for a measured hot path. For ordinary implementation, use
[performance.md](performance.md) and keep the default readable patterns.

## Contents

- [Escalate deliberately](#escalate-deliberately)
- [Apply aggressive Sway transforms](#apply-aggressive-sway-transforms)
- [Use assembly only for the right kernels](#use-assembly-only-for-the-right-kernels)
- [Preserve assembly semantics](#preserve-assembly-semantics)
- [Exploit compiler-sensitive size forms carefully](#exploit-compiler-sensitive-size-forms-carefully)
- [Optimize commitment encoding without weakening it](#optimize-commitment-encoding-without-weakening-it)
- [Consult calibrated micro-results](#consult-calibrated-micro-results)
- [Run the maximum-optimization gate](#run-the-maximum-optimization-gate)

## Escalate deliberately

Use this ladder:

1. Remove storage/getter/hash/call/write/allocation work.
2. Reorder independent rejection checks using measured path selectivity.
3. Apply structural size reductions and same-package packaging.
4. Inspect final IR/ASM/bytecode.
5. Try controlled unrolling or compiler-sensitive source forms.
6. Use raw asm only after the Sway ceiling is measured.

Stop at the earliest tier that meets the budget. Prefer a slightly slower
clear implementation over an obscure one unless the user requested maximum
optimization or the hot-path evidence justifies maintenance cost.

Never trade away:

- authorization or commitment coverage;
- asset conservation;
- replay/reentrancy protection;
- checked overflow/trap behavior;
- ABI/storage compatibility;
- failure atomicity;
- negative tests.

## Apply aggressive Sway transforms

### Full unrolling

Consider full unrolling when:

- the bound is fixed and small;
- the body is arithmetic/branch work rather than storage/hash dominated;
- the target is directly gas-benched;
- bytecode growth is acceptable.

Measured endpoints on forc 0.71.2:

| Kernel | Target gas | Deployable bytes |
|---|---:|---:|
| 8-lane register fold | -84 | +120 B |
| Reward curve | -110 | +104 B |
| 16-lane trace | -143 | +376 B |
| Packed-lane extraction | -76 | +96 B |
| Branch-heavy selection | -178 | 0 B because test-only |
| Predicate flag accumulation | -145 | 0 B because test-only |

Do not infer a deployable 0-byte cost from a test-only predicate/script helper.

Treat partial unrolling skeptically. Four-way trace unrolling saved only
30 target gas for 160 B, and factor-four contention saved 36 gas for 368 B.
Use a midpoint only for a concrete production size/gas decision.

### Loop fusion and result carrying

Try a fused pass when it removes a second full storage scan and does not add a
hot helper call. Return/carry a compact mask or count only if:

- the public ABI remains unchanged;
- digest/result values remain exact;
- replay checks occur before writes;
- the carried result is authenticated or recomputed before mutation.

Fusing through a helper inside each iteration often regresses call overhead.
Prefer one private loop body or a compact internal result.

### Same-package packaging

Strict gas tracks can reject a large target win after a one-gas sibling
layout regression. If a gas change grows or rearranges one package:

- find a measured structural shrink in that same package;
- keep both subchanges one coherent optimization design;
- attribute each subchange from prior isolated evidence;
- reject the bundle if any sibling still regresses.

Cross-package byte savings can satisfy an aggregate gate but do not repair the
touched package's code layout.

### Controlled codegen probes

Try one source shape at a time:

- `if let` predicate data;
- explicit `Option<bool>` match;
- enum `match` dispatch;
- native zero predicates;
- explicit local storage counter read;
- short-circuit condition order;
- locals-then-aggregate construction.

Do not stack several unmeasured codegen tricks. Revalidate after every forc
upgrade.

## Use assembly only for the right kernels

Assembly wins came from removing fixed-loop and branch scaffolding, not from
rewriting straight-line arithmetic:

- three-op transition leaf: 0/0;
- post-hash reward combination: 0/0;
- asm only for the in-loop accumulator: 0/0;
- per-lane asm inside the original Sway loop: +16 gas;
- full branch-heavy asm unroll: -178 gas;
- factored version of the same branch kernel: -173 gas, slightly worse.

Prefer asm for:

- fixed-trip branch-heavy kernels;
- fixed array folds;
- packed-lane extraction;
- one-value arithmetic reductions with a protected Sway oracle.

Avoid asm for:

- runtime-trip input/output scans;
- storage/hash dominated loops;
- simple straight-line leaf expressions;
- multi-value object construction;
- speculative register-count tuning.

Register pressure showed no penalty up to 20 virtual registers in the measured
block. Instruction count explained the result better than operand-list length.
Direct pointer `lw` loading reproduced the same -84 gas/+120 B as explicit
operands; operand extraction was not a hidden win.

## Preserve assembly semantics

Bind Sway inputs explicitly:

```sway
let value = asm(left_reg: left, right_reg: right, result) {
    add result left_reg right_reg;
    result: u64
};
```

A bare name in the operand list declares a new uninitialized register and
fails when read.

Follow these rules:

- initialize every writable register before reading it;
- return one explicitly typed register;
- do not expect labels, jumps or runtime-loop control inside the bounded asm
  expression form used by these experiments;
- do not write `$zero`, `$one`, `$flag`, `$sp`, `$hp`, `$pc`, or other
  reserved registers;
- keep runtime loops and external/storage/transaction operations in Sway;
- preserve exact evaluation order and intermediate overflow traps;
- leave divisor/shift bounds in Sway where practical;
- prove no undeclared memory/storage/transaction effects;
- compare the asm result with an independent Sway oracle over boundary inputs.

For the measured release:

- `MULI`, `ADDI`, `ANDI`, `XORI`, and `DIVI` used 12-bit immediates;
- `MOVI` accepted a wider 18-bit immediate;
- larger constants required a scratch register;
- checked `ADD`, `MUL`, and `SUB` trapped on overflow by default;
- changing flags to wrapping semantics changed behavior;
- `SLL`/`SRL` with a shift at or above 64 yielded zero in the measured
  semantics rather than reproducing an external `shift < 64` assertion;
- `MOD` retained its zero-divisor trap;
- shift and modulo guards therefore remained part of the reference contract.

Resolve these details from the pinned FuelVM/Sway source before applying them
to another version.

## Exploit compiler-sensitive size forms carefully

Measured forc 0.71.2 forms:

- predicate `if let` success paths: -16 to -40 B;
- explicit `Option<bool>` match: -16 to -32 B;
- explicit `Input::Coin` match: -368 B/-480 gas in one lending path;
- `ContractId::is_zero()`: -104 B/-139 gas in one order path;
- explicit storage-counter local: -8 to -16 B;
- locals-then-construct versus mutate-return: -136 B/-96 gas;
- storage hash `match` to `if/else`: -24 B/-48 gas.

Opposite/context-sensitive results:

- bool `match`: -72 B but +226 gas in one kernel;
- six-bool tuple match: +160 B/+50 gas;
- explicit `Option<u64>` match: +24 B;
- manual helper inline: +64 B for about -2 gas;
- script locals: often +8 B;
- precomputed `b256` literal: +216 B;
- `i & 7` instead of `% 8`: -8 B but a gas regression on the relevant path;
- `&&` chain to early returns: +32 B/+14 total gas (reject path -2);
- sharing a predicate failure epilogue: -16 B, but reshaping another into a
  different form: +96 B;
- checked-add reassociation: usually 0/0, one association -7 gas/+24 B.

Use release artifact diffs, not source aesthetics.

## Optimize commitment encoding without weakening it

For a wide commitment, compare:

1. current hash tree;
2. one nested tuple with all fields;
3. one capacity-matched `Hasher` stream with the same field order/types.

One explicit 13-field stream beat a five-hash tree by 6,256 gas/2,808 B and
beat the one-hash nested tuple by about 636 gas/416 B. A four-field one-hash
stream beat tuple hashing by 34 gas/bench.

Before changing encoding:

- list every committed field/domain;
- freeze field order and declared width;
- confirm ordering/index sensitivity;
- update every producer/consumer copy;
- verify known vectors across contract, predicate, script, SDK, and relayer;
- reject any change that only passes because the oracle checks nonzero.

Flat wide tuples may not implement `Hash`; 11/12/13-field attempts failed on
0.71.2. Use nesting or streaming.

Do not introduce extra nested hashes merely to label subdomains. Four explicit
subdomain tags in an existing five-hash tree cost 2,597 gas/848 B. Prefer
domain-first fields inside one complete stream when the protocol encoding can
be versioned coherently.

Reuse already-stored authenticated commitments instead of reserializing
fields: bridge root composition from stored sender/payload commitments plus
amount saved 6,559 gas/176 B, while chaining the same fields through
additional hash rounds cost 9,401 gas/240 B. Reuse only when the stored
commitments already cover the same fields, widths, order, domain,
mutability/lifetime, and producer/consumer encoding.

Pack to shrink the serialized hash payload, not as a general bool-array
habit: packing eight permission booleans before hashing saved 102 gas/0 B,
but the same idea on transcript flags regressed 136 gas/64 B. Hash bools
directly — converting each to `u64` first cost 472 gas over eight values.

## Consult calibrated micro-results

Narrow forc 0.71.2 fixture results for analogous hot paths; reproduce before
production use:

| Intervention | Result | Lesson |
|---|---:|---|
| XOR/OR snapshot-difference accumulation | -6 gas/0 B | Branchless aggregation can beat early return |
| Track max depth, assert once after loop | -7 gas/0 B | In-loop asserts are not free |
| Affine fold offset as induction variable | -6 gas/+8 B (elsewhere +1 gas) | Transfer is package/function specific |
| Hoist modulus shared by two branches | 0 gas/-8 B | Branch-tail dedup can be size-only |
| Phase-directed early returns | -23 gas/+40 B | Faster control flow can grow bytecode |
| Bool-to-value liveness rewrite | +39 gas/-48 B | Smaller branch encoding can be slower |
| `i != n` instead of `i < n` | +9 to +38 gas | Ordered `<` was never worse |
| Count-down loop | 0 gas/-8 B | Size shape, gas-neutral |
| Inline loop-produced struct fields | -432 gas/0 B per 8 items | Avoid one-use aggregates in loops |
| Fuse duplicate cold policy scans | 0 gas/-88 B | Fuse cold duplicated scans for size |
| Remove write-only counter update | +3 gas/-168 B | Dead storage code can be large; sibling gas moves from layout |

Expect these nulls and stop signals: sinking branch-exclusive construction,
staging one arithmetic term, storage-read scheduling without removed work,
and loop-invariant association are commonly 0/0; small `if/else` versus
`match` dispatch can be byte-identical; deleting a generic identity wrapper
measured +12 gas/+16 B; binding repeated transaction introspection to a
local added 0-8 B.

## Run the maximum-optimization gate

For every candidate:

1. Pin toolchain, std, node, gas table, profile, and source commit.
2. Capture per-benchmark gas, per-artifact bytes/hash, ABI, storage slots,
   configurables, roots/IDs, and final transaction shape.
3. Write equivalence obligations:
   - accepted/rejected inputs;
   - overflow/trap order;
   - storage/call effects;
   - replay and reentrancy;
   - commitment vectors;
   - ABI/storage identity.
4. Change one mechanism.
5. Run debug and release correctness tests plus release gas.
6. Diff all artifacts and every sibling benchmark.
7. Inspect final IR/ASM/bytecode for compiler-sensitive work.
8. Add boundary/property tests for unrolling, asm, pointer, immediate, and
   overflow assumptions.
9. Run SDK/node integration tests for calls, predicates, fees, receipts,
   concurrency, and persistence claims.
10. Document the readability/maintenance cost and a clear reason to keep the
    advanced form.

Prefer retaining a readable Sway reference implementation or protected oracle
next to any asm or heavily transformed kernel.
