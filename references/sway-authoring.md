# Sway authoring

Verified for Sway `v0.71.2`. Inspect the project's compiler pin and versioned
reference before applying syntax to another release.

- [Structure programs explicitly](#structure-programs-explicitly)
- [Make effects visible](#make-effects-visible)
- [Respect ownership and data movement](#respect-ownership-and-data-movement)
- [Write readable optimized Sway](#write-readable-optimized-sway)
- [Isolate low-level code](#isolate-low-level-code)
- [Control experimental features](#control-experimental-features)
- [Verify authoring changes](#verify-authoring-changes)

## Structure programs explicitly

Start each package with exactly one program declaration:

```sway
contract;
// or: script; predicate; library;
```

Contracts expose ABI implementations. Scripts and predicates enter at
`fn main`; predicate `main` returns `bool`. Libraries expose reusable modules,
types, ABIs and functions.

Keep public ABIs small and stable. Put shared ABI definitions and data types in
a library rather than duplicating definitions between contracts and clients.
Treat ABI changes as cross-language API migrations.

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
decode. Test every authorization, asset-shape, boundary and malformed-input
failure, not only happy paths.

## Write readable optimized Sway

Default to idiomatic, auditable code that removes real work:

- load immutable storage once per phase and write once;
- avoid repeated transaction getters and fixed-array indexing;
- reject malformed/expired shapes before expensive bounded work;
- keep fixed small arrays instead of heap collections;
- stream one complete commitment instead of a deep hash tree;
- construct an aggregate once from locals rather than mutate then return;
- keep hot loop bodies inline;
- deduplicate a substantial cold block across entrypoints.

Use measured compact forms only in the matching context:

- try `if let` for a large predicate-data success path;
- try explicit `match` for `Option<bool>` replay defaults;
- use enum dispatch and native predicates such as `is_zero()` when clearer;
- retain `unwrap_or` for scalar defaults unless release measurement favors a
  match.

Do not introduce locals, helper boundaries, branchy strength reduction,
partial/full unrolling or asm merely because the source looks lower-level.
Forc 0.71.2 frequently canonicalized simple source changes and sometimes made
manual forms worse. Read [auto-research-findings.md](auto-research-findings.md)
for exact evidence.

## Isolate low-level code

Treat `asm`, raw pointers, manual storage-key computation, byte decoding,
hashing and transmute-like operations as audit boundaries:

- wrap them in small typed functions;
- document preconditions, layout and valid ranges;
- test edge lengths, alignment, overflow and malformed bytes;
- inspect final IR/ASM/bytecode after compiler changes.

Historical Sway findings have involved compiler transforms around assembly.
Do not extrapolate an old report into a current exploit; reproduce it on the
exact pinned compiler.

### Author raw FuelVM assembly

Check pinned examples from the exact `FuelLabs/sway` release used by the
project. In an available release checkout, inspect:

- `test/src/e2e_vm_tests/test_programs/should_pass/language/asm_expr_basic/`
- `test/src/ir_generation/tests/`
- `sway-lib-std/src/`

Pass values through named input registers, initialize writable registers before
reading them, and return an explicitly typed register:

```sway
let value = asm(left: a, right: b, result) {
    add result left right;
    result: u64
};
```

FuelVM words are 64-bit. Confirm opcode-specific immediate widths, memory
offset units, reserved registers, pointer provenance, jump targets, arithmetic
flags, and overflow behavior from pinned source. Keep storage, external calls,
and transaction decoding in Sway unless their exact low-level semantics and
bounds are independently covered. Inspect and measure release bytecode; do not
transfer EVM assembly assumptions to FuelVM.

Assembly research found wins only when removing fixed-loop or branch
scaffolding; straight-line leaves and asm inside the original loop were 0/0 or
regressed. Keep a readable Sway oracle and load
[maximum-optimization.md](maximum-optimization.md) only for an explicit
maximum-optimization request.

For forc 0.71.2 specifically, wide flat 11/12/13-field hash tuples lacked the
needed `Hash` implementation in measured attempts, direct `Output`
hash/comparison forms failed, and expression-position bool-to-u64 `as` failed.
Use nested tuples/`Hasher`, explicit output discriminants and a typed
`if`-expression respectively; re-check on another compiler.

## Control experimental features

Read `[project].experimental` from `Forc.toml` and compare it with the pinned
release. At `v0.71.2`, `new_encoding`, `references` and `new_hashing` were
default-on; `str_array_no_padding` and `dynamic_storage` were default-off.
Do not enable a feature merely because default-branch documentation describes
it. Treat dynamic storage as experimental unless the selected release and
deployment policy explicitly support it.

## Verify authoring changes

```sh
forc fmt --check
forc check --locked
forc test --locked
forc build --release --locked
forc test --release --locked
```

Add SDK integration tests for wallets, deployment, transaction I/O,
multi-contract paths and receipt decoding. Diff release ABI, bytecode, storage
slots, configurables, roots/IDs and generated bindings. If only `forc-fmt` is
available as an executable, run its own help; do not assume every plugin
supports the same `forc <subcommand>` dispatch.
