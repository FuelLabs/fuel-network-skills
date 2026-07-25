# Deployment and operations

Deployment, transaction submission, funding, key use and administrative
actions require explicit user authority. Planning, artifact verification and
dry-run/read-only checks do not imply submission authority.

## Freeze a deployment unit

Record as one provenance chain:

- Git commit and source tree;
- exact Sway/core Forc and independent plugin versions;
- `Forc.toml`, `Forc.lock`, SDK locks and experimental flags;
- release ABI, bytecode, storage slots and configurables;
- deployment salt, bytecode root and resulting contract ID;
- generated Rust/TypeScript bindings;
- RPC URL, chain ID, node version and consensus parameters;
- deploying account, transaction ID and final receipts/status.

Never deploy an unreviewed debug artifact. Recompute identity after any
bytecode, configurable, storage-slot or salt change. Compare deployed bytecode
and configuration back to the approved record.

## Separate build, preflight and submission

1. Resolve the target named network and query the actual node.
2. Build and test with exact pins and `--release --locked`.
3. Diff against the reviewed artifact set.
4. Construct the exact deployment/call/script transaction.
5. Estimate costs/predicates and dry-run against the target.
6. Review account, network, IDs, assets, fees, contracts and policies.
7. Submit only after explicit approval.
8. Wait for final result, verify deployed state/bytecode and archive receipts.

Network-facing commands are independently released Forc plugins:

```sh
forc node --help
forc deploy --help
forc run --help
forc call --help
forc submit --help
```

Use installed help rather than copying stable documentation flags. Do not
assume a Sway tag supplies the matching client/node plugin.

## Operate nodes deliberately

- Pin Fuel Core and chain/state configuration.
- Verify chain ID, genesis/state root, base asset, gas schedule and consensus
  limits.
- Separate local ephemeral, testnet and mainnet credentials/configuration.
- Test release-specific gossip, relayer, GraphQL and shutdown/restart behavior.
- Back up and restore persistent state according to the node version.
- Monitor peer/sync health, transaction acceptance/finality, RPC errors,
  storage and resource usage.

Fuel Core minor changes can alter transport, aggregation, gas/receipt, relayer
and operational behavior. A compiler-compatible library version is not an
operator rollout plan.

## Secure administration

Treat pause/unpause, ownership, blacklist/allowlist, fee, oracle, issuer,
relayer and implementation changes as high-impact transactions:

- enforce least privilege and separation of duties;
- use two-step/delayed transfer where practical;
- dry-run and independently verify the final transaction;
- record typed intent, chain, contract and before/after configuration;
- monitor the resulting event/state;
- maintain rollback, containment and communication runbooks.

For upgrades, preserve old-message/state liveness, storage layout and
outstanding operations. Immutability removes governance risk but does not
remove incident-response needs.

## Include off-chain services

Production correctness includes:

- ABI/artifact package provenance;
- idempotent indexer/relayer state and inclusive pagination;
- every-event verification rather than first-event shortcuts;
- integer amounts and canonical encodings;
- live chain/config refresh;
- concurrency-safe UTXO reservation/retry;
- secrets management and audit logging;
- monitoring for balance, supply, stuck-message and authority anomalies.

Rehearse failure: RPC divergence, partial indexing, restart during submission,
expired transaction, UTXO conflict, reorg/finality delay, unavailable signer,
bad configuration and contract pause. Ensure retries cannot duplicate
economically meaningful actions.
