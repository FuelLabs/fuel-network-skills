---
name: fuel-network-skills
description: Use for any task involving Fuel, FuelVM, Sway, Forc, Fuelup, fuels-ts, fuels-rs, Fuel wallets, nodes, or Fuel project artifacts. Selective modules cover toolchains, contracts, scripts, predicates and libraries, native assets and SRC standards, transactions and wallets, TypeScript and Rust clients, testing, security review, deployment and operations, migrations, evidence-backed readable-first gas/contract-size optimization, and opt-in maximum optimization or raw FuelVM assembly. Includes pinned self-contained references (no web needed) for Sway language syntax, storage, the std library, SRC interface signatures, FuelVM assembly/ISA, ABI JSON and encoding, transaction formats, and complete worked examples.
---

# Fuel Network Skills

Last updated: **2026-07-25T14:34:12-04:00** (`America/New_York`).
Update this timestamp whenever any file in this skill changes.

## Verification baseline

Reference modules were verified against these pinned sources (each module
header repeats its own stamp). To test whether the skill is outdated, run
`python3 scripts/resolve_fuel_versions.py` and compare against this table;
differences mean re-verification, not automatic invalidity.

| Component | Verified baseline |
|---|---|
| Sway / core Forc / sway-lib-std | `v0.71.2` (commit `aa2e3b1`) |
| Fuelup (installer/channel mechanics) | commit `8d05e80` (2026-04-07) |
| fuel-vm / fuel-tx / fuel-asm | `v0.66.4` (from Sway v0.71.2's lockfile) |
| fuel-specs | revision `dd11147` |
| Fuel Core GraphQL schema | `v0.47.1` |
| Live network channels (mainnet/testnet) | forc `0.70.2` + fuel-core `0.47.1`, snapshot 2026-07-23 |
| fuels-ts | `v0.103.0` |
| fuels-rs | `v0.77.0` |
| sway-standards | commit `01f3d2f`, packages `0.8.2` (2026-07-13) |
| sway-libs | commit `4908619` (2025-11-20), packages `0.26.1`-`0.27.0`, CI pins forc `0.70.2` |
| Optimization evidence corpus | 434 iterations on pinned forc `0.71.2` release builds |

Route Fuel work to the smallest relevant module set and ground version-sensitive
advice in the project and target network.

## Apply this workflow

1. Classify the request by program type, client language, lifecycle phase, and
   whether it is explanatory, diagnostic, review-only, or mutating.
2. Load one primary module from the catalog. Load another only when the work
   crosses a real boundary, such as Sway ABI authoring plus TypeScript bindings.
   Do not narrate module selection unless the user asks.
3. Inspect project-local pins before proposing commands or code. For a
   version-sensitive build, review, migration, deployment, or integration, read
   [preflight.md](references/preflight.md) and run the local preflight helper.
4. If the user asks for current/latest behavior, a network target, or an
   upgrade, read [source-policy.md](references/source-policy.md) and resolve
   live primary versions. Keep the network channel and newest upstream release
   as distinct baselines.
5. Default to readable optimization: remove real storage/getter/hash/call/write
   work, reject invalid shapes early and use measured compact idioms without
   obscuring invariants. Load maximum-optimization guidance only when the user
   explicitly prioritizes maximum gas/size or accepts lower readability.
6. Make the smallest in-scope change. Preserve lockfiles and generated
   artifacts unless regeneration is intentional.
7. Verify at the relevant layers and report the exact toolchain, network,
   artifacts, and tests used. Never deploy, submit, publish, fund, or sign
   without explicit authority.

## Load modules selectively

| Module | Load for |
|---|---|
| [Toolchain and packages](references/toolchain-and-packages.md) | Fuelup, Forc, installation, projects, workspaces, manifests, dependencies, lockfiles, registry, plugins, source builds |
| [Program architecture](references/program-architecture.md) | Choosing signed UTXOs, predicates, scripts, contracts, libraries, state and concurrency boundaries |
| [Sway authoring](references/sway-authoring.md) | Writing or refactoring Sway well: ABIs, effects, ownership, low-level isolation, verification |
| [Sway language](references/sway-language.md) | Language definition: program types, types, control flow, generics, traits, ABIs, modules, attributes, panic/errors, operators, conversions, intrinsics |
| [Storage](references/storage.md) | `storage` blocks, StorageKey/Map/Vec/String/Bytes APIs, namespaces, `in` keys, key derivation, purity, deploy-time slots |
| [Std library](references/stdlib.md) | std signatures: auth, context, assets, block/time, tx/inputs/outputs, hash/crypto, revert codes, collections, codec, low-level calls |
| [Worked examples](references/worked-examples.md) | Complete verified programs: counter, native-asset pool, configurables, script, predicates, proxy, unit tests |
| [SRC interfaces](references/src-interfaces.md) | Exact SRC-3/5/6/7/10/11/12/14/15/16/17/20 ABI signatures, events and constants |
| [sway-libs](references/sway-libs.md) | Ownership, admin, pausable, reentrancy, asset base, SRC-14 proxy internals, bytecode roots, merkle, queue, signed/big ints — implementation APIs and their fixed storage slots |
| [FuelVM assembly](references/fuelvm-assembly.md) | Registers, memory model, full opcode set, GTF selectors, predicate-legal ops, call frames, panic codes, Sway `asm` block syntax |
| [ABI and encoding](references/abi-and-encoding.md) | ABI JSON format, encoding v1 rules and call convention, hash-derived IDs, transaction/input/output/policy formats |
| [Assets and standards](references/assets-and-standards.md) | Native assets, asset IDs, mint/burn/transfer, SRC interfaces, ownership and upgrade standards |
| [Transactions and wallets](references/transactions-and-wallets.md) | Inputs, outputs, witnesses, fees, policies, resource selection, signing, messages, predicate data |
| [TypeScript frontend](references/frontend-typescript.md) | fuels-ts, browser wallets, React/Next.js, generated types, provider/account integration |
| [Rust SDK](references/rust-sdk.md) | fuels-rs, `abigen!`, providers, wallets, local nodes, bindings and Rust services |
| [Testing and debugging](references/testing-and-debugging.md) | Sway tests, SDK integration tests, receipts, logs, reverts, local nodes, debugging |
| [Security review](references/security-review.md) | Threat modeling, audit/review, authorization, asset conservation, predicates, reentrancy, upgrades, findings |
| [Deployment and operations](references/deployment-and-operations.md) | Node selection, deploy/call/run/submit, salts and IDs, records, monitoring, relayers and indexers |
| [Performance](references/performance.md) | Readable-first gas, transaction-size, storage, bytecode, predicate, call, receipt, memory and contention optimization, with measured 434-iteration evidence |
| [Maximum optimization](references/maximum-optimization.md) | Explicit maximum gas/size work, full unrolling, raw FuelVM asm, aggressive commitment encoding and compiler-sensitive codegen; do not load by default |
| [Migrations](references/migrations.md) | Sway/Forc/SDK/node upgrades, changelogs, artifact compatibility and rollout |

Common cross-module pairs:

- Writing new Sway from scratch: Sway language + Worked examples; add
  Storage for stateful contracts and Std library for API signatures.
- Token/NFT implementation: SRC interfaces + sway-libs + Assets and
  standards.
- Access control, pause, proxy or factory mechanics: sway-libs + Security
  review.
- Raw asm or bytecode inspection: FuelVM assembly + Sway authoring.
- Predicate data or commitment encoding: ABI and encoding + Transactions
  and wallets.
- Contract plus frontend: Sway authoring + TypeScript frontend.
- Predicate wallet flow: Program architecture + Transactions and wallets;
  add Security review for any authorization decision.
- Deployment failure: Deployment and operations + Testing and debugging.
- Compiler upgrade: Migrations + Toolchain and packages.
- Gas regression: Performance + Testing and debugging.
- Maximum gas/size request: Performance + Maximum optimization + Testing and
  debugging; add Security review for any commitment, predicate, storage or call
  change.
- Asset protocol review: Assets and standards + Security review.

## Enforce these Fuel-specific rules

- Prefer local `fuel-toolchain.toml`, `Forc.toml`, `Forc.lock`, Cargo lockfile,
  JavaScript lockfile, ABI, bytecode, deployment record, and node facts over a
  generic example.
- Treat Fuelup `latest` as a network alias whose live meaning must be resolved,
  not as proof of the newest compiler.
- When a dated module snapshot conflicts with the target node or live primary
  resolution, the target node and live primary evidence win. Keep
  network-distributed and newest-upstream baselines distinct.
- Do not create a fictional compatibility set by making Sway, Forc plugins,
  Fuel Core, fuels-rs, and fuels-ts version numbers match.
- Resolve installed CLI flags with `<command> --help`; network-facing Forc
  plugins can release independently from core Forc.
- Use version-pinned official source and release documentation for syntax and
  behavior. Use unversioned “stable” pages for concepts only after checking
  their displayed source version.
- Query the target node for chain ID, consensus parameters, gas costs, size
  limits, and deployed bytecode. Do not guess numeric limits.
- Remember that anyone may submit a transaction satisfying a predicate.
  Submission identity is not predicate authorization.
- Treat authorization, transaction binding, asset conservation, replay,
  reentrancy, overflow/trap behavior and migration recovery as optimization
  constraints, never as removable overhead.
- Prefer auditable Sway over raw asm, full unrolling and obscure codegen forms
  unless measured budgets and explicit user intent justify the maintenance
  cost. Retain a readable oracle/reference for advanced kernels.
- Keep review and diagnostic requests read-only. Treat dependency updates,
  formatting, binding generation, transaction signing, publishing, deployment,
  and submission as mutations.

## Use the helpers

Run helpers with Python 3.11 or newer from this skill's base directory (the
`scripts/` paths below are relative to it, not to the user's project):

```sh
python3 scripts/fuel_preflight.py --path <project>
python3 scripts/resolve_fuel_versions.py
python3 scripts/diff_fuel_artifacts.py <old-artifacts> <new-artifacts>
```

- `fuel_preflight.py` is network-free and reports local pins, program types,
  installed tools, SDK versions, lockfiles, artifacts, and warnings.
- `resolve_fuel_versions.py` reads live primary Fuelup manifests and GitHub
  releases. It fails visibly on missing endpoints unless `--allow-partial` is
  explicitly chosen. It makes several unauthenticated GitHub API requests per
  run; set `GITHUB_TOKEN` for repeated or CI use to avoid the 60-requests/hour
  unauthenticated limit.
- `diff_fuel_artifacts.py` compares ABI JSON, bytecode, storage/configurable
  files, roots/IDs, and generated Rust/TypeScript bindings. Exit status `1`
  means differences; `2` means an operational error.

Use `--json` for automation. Do not interpret a partial resolution as a
compatibility guarantee.

## Report useful evidence

For implementation, summarize changed files, program/SDK boundaries, and
verification. For review, emit findings ordered by severity with file/line,
affected invariant or asset, exploit/failure path, version scope, and minimal
remediation. For migration or deployment planning, include the from/to matrix,
artifact differences, network assumptions, rollback boundary, and unresolved
compatibility questions.
