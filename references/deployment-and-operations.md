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
3. Diff against the reviewed artifact set with
   `scripts/diff_fuel_artifacts.py`.
4. Construct the exact deployment/call/script transaction.
5. Estimate costs/predicates and dry-run against the target.
6. Review account, network, IDs, assets, fees, contracts and policies.
7. Submit only after explicit approval.
8. Wait for final result, verify deployed state/bytecode and archive receipts.

Persist multi-step automation as explicit unregistered, deployed, registered,
initialized, upgraded and admin-transferred states—not optional IDs. Treat the
on-chain registry, when present, as identity truth; reconcile one canonical
deployment key, persist actual targets and retry registration/initialization
safely after partial success.

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

For bytecode above the node's contract-size limit, the protocol-level path
(verified at `fuel-tx v0.66.4`) is: upload chunks as Blob transactions
(`blob_id = sha256(data)`), then deploy a small loader contract that
`LDC`-loads blob payloads (mode 1) at runtime — `BSIZ`/`BLDD` inspect blobs;
see [abi-and-encoding.md](abi-and-encoding.md) and
[fuelvm-assembly.md](fuelvm-assembly.md). Deploy tooling can automate
chunking; verify the installed `forc deploy`/SDK behavior and record every
blob ID in the deployment unit. For SRC-14 proxy deploys, the `[proxy]`
manifest section declares intent
([toolchain-and-packages.md](toolchain-and-packages.md)).

## Query the node over GraphQL

Verified against the Fuel Core `v0.47.1` schema (`crates/client/assets/
schema.sdl`); regenerate expectations from the target node because fields
change between minors. Endpoints: HTTP `POST /v1/graphql`, subscriptions at
`/v1/graphql-sub`. Key root fields:

- Chain and node facts: `chain` (ChainInfo), `nodeInfo`,
  `consensusParameters(version)`, `health`, `latestGasPrice`,
  `estimateGasPrice(blockHorizon)`.
- Accounts and resources: `balance(owner, assetId)`, `balances(filter, ...)`,
  `coin(utxoId)`, `coins(filter, ...)`,
  `coinsToSpend(owner, queryPerAsset, excludedIds)` (spendable selection),
  `assetDetails(id)`.
- Contracts: `contract(id)`, `contractBalance(contract, asset)`,
  `contractBalances(filter, ...)`; historical-execution nodes also expose
  `contractSlotValues`/`contractBalanceValues(contractId, blockHeight, ...)`.
- Transactions and blocks: `transaction(id)`, `transactions`,
  `transactionsByOwner(owner, ...)`, `block(id|height)`, `blocks`,
  `blockHorizon`-based estimation via `assembleTx`, `estimatePredicates(tx)`,
  `dryRun(txs, utxoValidation, gasPrice, blockHeight)` (query; the mutation
  form is deprecated at `0.47.1`), `dryRunRecordStorageReads`,
  `storageReadReplay(height)`.
- L1 messaging: `message(nonce)`, `messages(owner, ...)`,
  `messageProof(transactionId, nonce, ...)`, `messageStatus(nonce)`,
  `relayedTransactionStatus(id)`.
- Mutations: `submit(tx, estimatePredicates)`; `produceBlocks` and the
  debugger session mutations (`startSession`, `startTx`, `execute`, ...) exist
  only where the node enables them.
- Subscriptions: `statusChange(id, includePreconfirmation)`,
  `submitAndAwait(tx)`, `submitAndAwaitStatus(tx, ...)`.

`assembleTx(tx, blockHorizon, requiredBalances, feeAddressIndex, ...)` returns
a fully funded transaction with change/variable/contract I/O, witness
reservations and estimated predicates; treat its output as a candidate to
review, not an authorization decision. Paginate with `first/after/last/before`
cursors and verify pagination completeness in indexers.

## Operate nodes deliberately

- Pin Fuel Core and chain/state configuration.
- Verify chain ID, genesis/state root, base asset, gas schedule and consensus
  limits.
- Separate local ephemeral, testnet and mainnet credentials/configuration.
- Test release-specific gossip, relayer, GraphQL and shutdown/restart behavior.

Fuel Core minor changes can alter transport, aggregation, gas/receipt, relayer
and operational behavior. A compiler-compatible library version is not an
operator rollout plan.

## Secure administration

Treat pause/unpause, ownership, blacklist/allowlist, fee, oracle, issuer,
relayer and implementation changes as high-impact transactions:

- dry-run and independently verify the final transaction;
- record typed intent, chain, contract and before/after configuration;
- monitor the resulting event/state;
- rehearse reorg/finality-delay and unavailable-signer scenarios;
- monitor balance, supply, stuck-message and authority anomalies;
- maintain rollback, containment and communication runbooks.

Domain-separate deterministic salts by network, deployment kind and logical
instance. Propagate every protocol-affecting configurable through schemas,
builders, generated types, fixtures, readback and events without a silent Sway
default. Share one deployment/upgrade builder; define whether values persist,
reinitialize or need an admin write. Transfer proxy and implementation
ownership separately only after configuration. Replace maintainers in
revoke/grant/transfer order; make retries and duplicate grants safe and leave
a recovery-capable maintainer.

For upgrades, preserve old-message/state liveness, storage layout and
outstanding operations. Immutability removes governance risk but does not
remove incident-response needs.

## Include off-chain services

Production correctness includes:

- ABI/artifact package provenance;
- idempotent indexer/relayer state and inclusive pagination;
- every-event verification rather than first-event shortcuts;
- integer amounts and canonical encodings;
- live chain-ID/consensus-parameter refresh;
- concurrency-safe UTXO reservation/retry;
- message and relayer status fields (`messageStatus`,
  `relayedTransactionStatus`) rather than inferred delivery.

Cover the Fuel-shaped failure modes: expired transaction, UTXO conflict,
partial indexing, restart during submission and contract pause. Ensure retries
cannot duplicate economically meaningful actions.
