# Testing and debugging

Verified for Sway/Forc `v0.71.2`, fuels-ts `v0.103.0` and fuels-rs `v0.77.0`
on 2026-07-23. Adjust commands to the project pins.

- [Layer the tests](#layer-the-tests)
- [Run focused Sway tests](#run-focused-sway-tests)
- [Test performance claims by path](#test-performance-claims-by-path)
- [Keep local nodes deterministic](#keep-local-nodes-deterministic)
- [Diagnose from the outside inward](#diagnose-from-the-outside-inward)
- [Verify release behavior](#verify-release-behavior)

## Layer the tests

1. Run Sway unit/VM tests for pure logic, storage, reverts, logs and predicate
   truth tables.
2. Run Rust or TypeScript SDK integration tests for deployment, wallets,
   transaction I/O, multi-contract calls, assets, predicates and receipts.
3. Run end-to-end flows on a pinned local Fuel Core node with representative
   chain configuration.
4. Run read-only or explicitly authorized smoke tests against the target
   network.
5. Compare release artifacts and worst-case transaction metrics.
6. Test published root and declared subpath imports under runtime and type
   resolution.

Do not claim first-class Sway fuzzing/formal verification where the selected
toolchain does not provide it. Property and adversarial tests can live in SDK
harnesses.

## Run focused Sway tests

```sh
forc test --locked
forc test <substring>
forc test --filter-exact <test-name>
forc test --release --locked
forc test --release --locked --logs
forc test --release --locked --reverts --dbgs
```

At `v0.71.2`, tests normally ran in parallel with isolated storage. Use
`--test-threads 1` only to investigate ordering/shared-external-resource
issues, not to conceal them. Verify combinations such as `--raw-logs --pretty`
with installed help.

Cover negative cases:

- missing/incorrect storage and payable annotations;
- unauthorized caller, wrong asset/amount and rounding edges;
- missing contract I/O or variable/change outputs;
- duplicate/reordered/extra predicate inputs and outputs;
- malformed predicate data and witness indices;
- reentrancy and external-call failures;
- initialization, pause, ownership, upgrade and migration states;
- maximum valid collection/loop/transaction shape.

## Test performance claims by path

Before accepting a gas/size claim, map each benchmark to the code it executes.
Do not claim entrypoint, storage, predicate-main, script-main, cross-contract or
rollback gas from a detached helper.

For each optimized path, capture:

- valid, earliest-invalid and latest-invalid inputs at equal total shape;
- minimum, typical and maximum loop/count/witness shapes;
- per-benchmark gas rather than only total gas;
- every package's release `.bin` size/hash;
- ABI, storage slots, configurables, roots/IDs and bindings;
- exact accepted/rejected outcomes and state writes;
- commitment vectors across every producer/consumer.

Same-package code layout moved unrelated benches in auto-research. Treat a
one-gas sibling regression as real under a zero-tolerance policy, or define and
justify a statistical/absolute threshold before running the experiment.

Add SDK/node fixtures when a claim involves:

- transaction serialization or predicate code/data;
- wallet resource selection;
- actual fees/refunds or consensus gas;
- forwarded gas, callback depth, receipts or multi-contract rollback;
- concurrent storage/UTXO conflicts;
- process restart and multi-transaction migration recovery;
- signer cryptographic verification and uniqueness;
- duplicate input/output matching across all transaction shapes.

For asm, unrolling or compiler-sensitive code, test overflow/trap order,
immediate boundaries, shifts/divisors, pointers and the readable Sway oracle.
Read [maximum-optimization.md](maximum-optimization.md) for the full gate.

## Keep local nodes deterministic

Pin Fuel Core and chain/state configuration. In TypeScript, use
`launchTestNode` from `fuels/test-utils`; in Rust, use test provider helpers or
an explicitly pinned node. Capture base asset ID, chain ID, gas schedule and
consensus parameters. Do not let a developer's default Fuelup channel
silently select the CI node/compiler pair.

Reset state between tests unless persistence is under test. Fund only ephemeral
test wallets. Cleanly shut down spawned nodes and avoid fixed-port collisions.

## Diagnose from the outside inward

1. Record exact source, tool, node, SDK, profile and command.
2. Reduce to one failing test/transaction without changing the invariant.
3. Inspect transaction inputs, outputs, witnesses, policies, predicate gas,
   contract IDs and bytecode.
4. Simulate/dry-run and decode receipts with the matching ABI.
5. Add logs/reverts/debug output only as needed.
6. If profile- or compiler-dependent, inspect final IR/ASM/bytecode and produce
   a minimal reproducer.

Preserve ABI JSON for decoded panic/error locations and logs. Use
`forc addr2line`, debugger tooling and bytecode parsing only after checking the
installed command's help.

## Verify release behavior

Debug builds use a different optimization/panic profile from release builds.
Always run release tests for deployable programs:

```sh
forc fmt --check
forc check --locked
forc test --locked
forc build --release --locked
forc test --release --locked
```

Use `scripts/diff_fuel_artifacts.py` to compare ABI, bytecode, storage,
configurables, IDs/roots and bindings across a change. Exit code `1` is a
detected difference, not a tool failure. Review semantic changes and update
deployment/binding records intentionally.
