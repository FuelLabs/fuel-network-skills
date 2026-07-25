# Rust SDK with fuels-rs

Verified against `FuelLabs/fuels-rs` `v0.77.0` on 2026-07-23. Use the project's
`Cargo.lock` and current release documentation as the operative API.

## Pin the SDK and node strategy

Add the top-level `fuels` crate at an exact tested requirement and commit
`Cargo.lock`. Keep feature selection intentional:

```toml
[dependencies]
fuels = "0.77.0"
```

At the verified release, `fuel-core-lib` enabled an embedded short-lived node;
`rocksdb` added persistent storage support. These features enlarge the
dependency/build surface. Prefer an external pinned `fuel-core` binary when
that better matches production or supply-chain constraints.

## Generate bindings together

Use `abigen!` with release ABI paths:

```rust
use fuels::prelude::*;

abigen!(
    Contract(name = "Counter", abi = "out/release/counter-abi.json"),
    Script(name = "Router", abi = "out/release/router-abi.json"),
    Predicate(name = "Policy", abi = "out/release/policy-abi.json"),
);
```

Generate related programs in one macro call when possible so matching shared
types are lifted once and name collisions are visible. Treat changed generated
types as an ABI migration. Keep source paths stable in CI and diff the ABIs
before accepting Rust compilation as sufficient compatibility evidence.

## Separate provider and signer

- Connect a provider to an explicit RPC URL and verify chain ID/node facts.
- Use view-only accounts for queries.
- Attach an unlocked wallet only to code that must sign. At `v0.77.0` the
  wallet model is `Wallet<Unlocked<PrivateKeySigner>>`/`Wallet<Locked>`
  behind the `Signer` trait; the older `WalletUnlocked` type no longer exists.
- Load production secrets through the approved secret system and never log
  them.
- Use `launch_provider_and_get_wallet()` or the lower-level test-provider
  helpers only for isolated tests.

Keep resource selection concurrency-safe in long-running services. Concurrent
requests can race on the same UTXOs even when each request is locally valid.

## Construct calls completely

For payable calls, use `CallParameters` with deliberate amount, asset and gas.
When a Sway method calls other contracts:

- prefer `with_contracts(&[...])` when generated instances are available and
  external logs/reverts must decode;
- use `with_contract_ids(&[...])` only when instances or decoding are not
  needed;
- add variable-output policy and transaction dependencies for all valid paths.

Use dependency estimation deliberately. At `v0.77.0`,
`determine_missing_contracts()` discovers missing external contracts only and
does not register ABIs for external log decoding; variable outputs are a
separate policy set with
`.with_variable_output_policy(VariableOutputPolicy::EstimateMinimum)`. Inspect
the final I/O rather than assuming automatic discovery proves authorization or
economic correctness. Estimate transaction cost, simulate/dry-run, inspect,
then submit only with authority.

Scripts can use custom inputs/outputs and `with_contract_ids`. Predicates need
their code/data, owned resources and per-input gas estimated after final
ordering; the transaction builder runs node-side predicate estimation
automatically when predicates are present, but verify gas on the final input
ordering. Use current builders rather than manually calculating dynamic data
offsets or witness indices.

## Handle results and errors

Await final call/transaction results. Decode return values, logs, require
reverts and receipts with the same ABI generation used to construct the call.
Distinguish transport errors, simulation reverts, rejected transactions and
final on-chain failure. Preserve transaction ID, block/confirmation evidence,
gas and receipts for operational paths.

Test:

- generated type round trips and ABI changes;
- local-node deploy/call/script/predicate flows;
- explicit external-contract I/O;
- payable and wrong-asset paths;
- resource/fee insufficiency and UTXO races;
- malformed predicate data and witness indices;
- target-network read-only smoke behavior.

Run `cargo test --locked` and the repository's formatter/linter policy. Do not
update the Cargo lockfile merely to make an SDK/compiler compatibility problem
disappear.
