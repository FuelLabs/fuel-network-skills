# Sway authoring

Verified for Sway `v0.71.2`. Inspect the project's compiler pin and versioned
reference before applying syntax to another release. This module covers how
to write good Sway; for definitions load the companion references:
[sway-language.md](sway-language.md) (syntax, types, traits, attributes),
[storage.md](storage.md), [stdlib.md](stdlib.md), and
[fuelvm-assembly.md](fuelvm-assembly.md).

- [Design stable ABIs](#design-stable-abis)
- [Make effects visible](#make-effects-visible)
- [Respect ownership and data movement](#respect-ownership-and-data-movement)
- [Write readable optimized Sway](#write-readable-optimized-sway)
- [Isolate low-level code](#isolate-low-level-code)
- [Control experimental features](#control-experimental-features)
- [Verify authoring changes](#verify-authoring-changes)

## Design stable ABIs

Keep public ABIs small and stable. Put shared ABI definitions and data types in
a library rather than duplicating definitions between contracts and clients.
Treat ABI changes as cross-language API migrations; adding a `log` or a typed
`require` changes the ABI's logged types. Represent meaningful
absence/transitions with `Option` or enums rather than value-plus-boolean,
fabricated empty records or zero sentinels; branch with `match`/`if let` rather
than probe then `unwrap`. Give each safety policy one canonical getter and
remove contradictory legacy semantics. Emit one public event per semantic
transition; keep internal execution enums private unless versioning the ABI.

## Make effects visible

Annotate contract methods with the effects they need:

```sway
abi Counter {
    #[storage(read)]
    fn value() -> u64;

    #[storage(read, write)]
    fn increment();
}
```

Add `#[payable]` only when a method intentionally receives forwarded assets.
Before crediting state, validate `msg_sender()`, `msg_asset_id()` and
`msg_amount()` against the method's economic invariant. Do not confuse a
contract call with an ordinary local method.

For external calls, declare the ABI, construct it from a `ContractId`, bound
forwarded gas, and specify assets deliberately. Ensure the transaction includes
every called contract input/output:

```sway
let callee = abi(TargetAbi, target_contract_id);
callee.method { gas: gas_budget, asset_id: asset, coins: amount }(argument);
```

Use checks-effects-interactions where possible and add a reentrancy guard when
recursive entry would violate state or asset invariants.

## Respect ownership and data movement

Use `&T` and `&mut T` for borrowing and `*reference` for dereferencing under
the active reference feature. Avoid cloning/copying large aggregates merely to
satisfy the borrow checker; make ownership boundaries intentional and verify
the generated release artifact.

Bound loops and collection growth. Prefer fixed-size arrays for small,
compile-time bounds and preallocate `Vec` capacity when known. Use
`StorageMap` for keyed access; avoid middle insert/remove operations on
`StorageVec` in unbounded state.

Return structured errors or revert conditions that clients and tests can
decode.

## Write readable optimized Sway

Default to idiomatic, auditable code that removes real work; do not introduce
locals, helper boundaries, branchy strength reduction, unrolling or `asm`
merely because the source looks lower-level. Forc 0.71.2 frequently
canonicalized simple source changes and sometimes made manual forms worse.
Read [performance.md](performance.md) for the readable-first defaults and the
measured evidence behind them.

## Isolate low-level code

Treat `asm`, raw pointers, manual storage-key computation, byte decoding,
hashing and transmute-like operations as audit boundaries:

- wrap them in small typed functions;
- keep a readable Sway oracle to diff the low-level form against;
- document preconditions, layout and valid ranges;
- test edge lengths, alignment, overflow and malformed bytes;
- inspect final IR/ASM/bytecode after compiler changes.

Historical Sway findings have involved compiler transforms around assembly.
Do not extrapolate an old report into a current exploit; reproduce it on the
exact pinned compiler.

### Author raw FuelVM assembly

[fuelvm-assembly.md](fuelvm-assembly.md) is the home for the register and
memory models, opcode set, GTF table, predicate restrictions and Sway
`asm`-block syntax; [maximum-optimization.md](maximum-optimization.md) holds
the measured assembly results and is loaded only for an explicit
maximum-optimization request. Those measurements only credited asm with
removing fixed-loop or branch scaffolding: straight-line leaf expressions and
asm placed inside the original Sway loop were gas-neutral or regressed, so
route a request for an asm rewrite of either shape back to Sway. For behavior
on a different pinned release, check these paths in the exact `FuelLabs/sway`
checkout:

- `test/src/e2e_vm_tests/test_programs/should_pass/language/asm_expr_basic/`
- `test/src/ir_generation/tests/`
- `sway-lib-std/src/`

Keep storage, external calls and transaction decoding in Sway unless their
exact low-level semantics and bounds are independently covered, and do not
transfer EVM assembly assumptions to FuelVM: words are 64-bit, so narrower
source integer types shrink neither registers nor artifacts and can add
conversions. At forc 0.71.2, direct `Output` hash and comparison forms did not
compile — use explicit output discriminants.

## Control experimental features

Read `[project].experimental` from `Forc.toml` and compare it with the pinned
release. At `v0.71.2`, `new_encoding`, `references` and `new_hashing` were
default-on; `str_array_no_padding` and `dynamic_storage` were default-off.
Do not enable a feature merely because default-branch documentation describes
it. Treat dynamic storage as experimental unless the selected release and
deployment policy explicitly support it.

## Verify authoring changes

Run the standard verification ladder from
[testing-and-debugging.md](testing-and-debugging.md), add SDK integration tests
for wallets, deployment, transaction I/O, multi-contract paths and receipt
decoding, and diff the release artifacts with `scripts/diff_fuel_artifacts.py`.
