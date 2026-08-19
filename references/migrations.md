# Migrations

Version-specific watch items verified at the 2026-07-23 snapshot; measured
guard costs are forc `0.71.2` fixture evidence. Treat Sway, core Forc,
independent plugins, Fuel Core, fuels-rs, fuels-ts, libraries, standards and
network activation as separate release tracks.

- [Establish from/to matrices](#establish-fromto-matrices)
- [Migrate in controlled stages](#migrate-in-controlled-stages)
- [Protect state-migration checkpoints](#protect-state-migration-checkpoints)
- [Read changelogs by affected boundary](#read-changelogs-by-affected-boundary)
- [Known 070 to 071 watch items](#known-070-to-071-watch-items)
- [Define rollout and rollback](#define-rollout-and-rollback)

## Establish from/to matrices

Run local preflight and live version resolution. Record:

| Layer | From | To | Compatibility evidence |
|---|---|---|---|
| Sway/core Forc | exact version/commit | exact version/commit | releases, compiler tests |
| Forc plugins | each component | each component | plugin releases/help |
| Fuel Core/chain | node and chain ID | node and chain ID | changelog, target node |
| Sway dependencies | lock resolution | lock resolution | source changelogs/tests |
| fuels-rs | lock version | target | SDK changelog/integration |
| fuels-ts | lock version | target | SDK changelog/integration |
| Artifacts | hashes/IDs | expected hashes/IDs | artifact diff/deployment plan |

Follow a compatible network distribution, or prove the complete
compiler/plugin/node/SDK matrix independently before moving.

## Migrate in controlled stages

1. Upgrade to the newest patch of the current Sway minor.
2. While still on that old minor, run:

   ```sh
   forc migrate show
   forc migrate check
   forc migrate run
   ```

3. Review and commit source/manifest/lock migration edits separately.
4. Switch to the exact target compiler and independently selected plugins.
5. Format, check, debug-test, release-build and release-test with `--locked`.
6. Regenerate bindings intentionally.
7. Diff the release artifacts with `scripts/diff_fuel_artifacts.py`.
8. Compare gas and full transaction shape.
9. Test against the target Fuel Core, chain ID and consensus parameters.
10. Rehearse deployment/upgrade, outstanding-state/message handling and
    rollback or containment.

Treat any contract-ID change as a deployment/API event, not a build detail.

Never reuse initialization as an upgrade migration; add an owner-gated
migration for new roles/state and test fresh deployment separately from
upgraded legacy state. Version and migrate persistent values before widening
tuples: zero-filled fields do not migrate legacy data, so quarantine unmigrated
records from decisions that assume new fields or zero totals are authoritative.

## Protect state-migration checkpoints

For an application-level shard/batch migration:

1. Store one authoritative committed-prefix checkpoint.
2. Accept only the next contiguous shard unless the protocol explicitly
   supports out-of-order completion.
3. Bind interruption/resume position to the committed checkpoint.
4. Reject duplicate, empty, out-of-range and over-capacity receipts before
   mutation.
5. Bind source/target version, layout/code roots, plan root, shard/range,
   authority epoch, nonce/domain and validity window.
6. Keep coordinator, script, adapter, predicate and SDK encodings identical.
7. Record the exact source version for rollback. If rollback only subtracts
   one, enforce adjacent target versions.
8. Test rollback before first work, mid-migration and after finalization.

Forc 0.71.2 entrypoint research measured these guards at 0-2 total gas and
24-80 B each in its fixtures. Treat that as evidence that explicit
state-machine hardening can be modest, not as a reason to add every guard
without matching the protocol model.

Do not infer crash safety from a single call. Rehearse:

- interruption immediately before and after checkpoint persistence;
- retry of a committed shard;
- restart between transactions;
- mixed legacy/current reads;
- stale clients and adapters;
- failed finalization and rollback.

Measure every snapshot/reuse candidate independently — results varied from
-63 gas (predicate transaction-shape snapshot) through 0/-56 B (active
version) to +8 gas (script transaction-ID snapshot) in the same fixture
family. Reducing plan/receipt hash rounds is a measured per-SHA-invocation
saving (figure in [performance.md](performance.md)), but do not widen a flat
commitment tuple to get it: nest or stream instead
([stdlib.md](stdlib.md)).

## Read changelogs by affected boundary

Look for:

- Sway syntax, type, ownership, encoding, storage and optimizer changes;
- Forc manifest, lockfile, registry, profile and plugin-split changes;
- FuelVM opcode, transaction validity, gas, receipt and consensus changes;
- Fuel Core GraphQL, relayer, gossip, genesis and operator changes;
- SDK transaction building, chain ID, signing, predicate data, generated types,
  runtime/MSRV and package-format changes;
- library API/layout and standards changes.

Default-branch issues are migration signals, not shipped behavior. Require a
release tag and versioned implementation before applying a proposed feature.

## Known `0.70` to `0.71` watch items

At the 2026-07-23 snapshot:

- Sway `v0.71.0` changed the `srw` opcode offset behavior and removed the
  `const_generic` experiment. Revisit assembly and direct storage intrinsics.
- `v0.71.2` was a small patch, not a network compatibility declaration.
- network-facing Forc commands had moved to independent `FuelLabs/forc`
  releases; a single Sway tag no longer represented every executable.
- Sway `v0.71.2` locked Fuel Core libraries in the `0.48` family while live
  network channels still distributed a `0.47` node.
- `dynamic_storage` remained default-off and its SDK/artifact/migration story
  was incomplete. Do not import default-branch guidance as released behavior.

SDK watch items at that snapshot:

- fuels-rs `v0.77.0`: Rust MSRV raised to 1.93; Fuel Core/VM dependency
  families moved to `0.48`/`0.66`; log-ID exposure and multi-URL provider
  connection.
- fuels-ts `0.101.x`: predicate-data enforcement for predicates with
  arguments plus `Predicate.setData`; `Account.signTransaction` returning a
  transaction request; `addSigners` deprecation.
- fuels-ts `v0.103.0`: devnet chain-ID change following a breaking Fuel Core
  update, with Fuel Core pinned at `0.47.1`.

Re-resolve changelogs before using these as current facts.

## Define rollout and rollback

Classify changes as:

- source-only and artifact-identical;
- ABI-compatible but bytecode/ID changing;
- ABI breaking;
- storage-layout or state-migration changing;
- transaction/signature/chain-ID changing;
- node/operator protocol changing.

Specify client compatibility windows, deployment order, pause/authority needs,
state/message migration, indexer backfill, monitoring and a stop/rollback
boundary. Archive both old and new artifacts so failures can be diagnosed
without regenerating either environment.
