# Source, version and documentation policy

Verified research snapshot: 2026-07-23. This file explains how to determine
current behavior; it does not freeze its snapshot as permanently current.

- [Rank evidence](#rank-evidence)
- [Keep baselines separate](#keep-baselines-separate)
- [Known misleading public freshness claims](#known-misleading-public-freshness-claims)
- [Preserve reproducibility](#preserve-reproducibility)
- [Primary repositories](#primary-repositories)

## Rank evidence

Use sources in this order:

1. Target node chain ID, consensus parameters and deployed bytecode.
2. Live named Fuelup channel manifest for the target network.
3. GitHub release/tag and its exact source and lockfile.
4. Project-committed toolchain, package locks, SDK locks, artifacts and
   deployment records.
5. Version-pinned official Sway/FuelVM documentation.
6. Unversioned stable documentation for concepts after checking its displayed
   source version.
7. Default branches, issue proposals, nightly specs and old example projects
   only as forward-looking or historical evidence.

Use `scripts/resolve_fuel_versions.py` for live channel/release facts.

Version-pinned Sway documentation is published per tag at
`https://fuellabs.github.io/sway/<tag>/book/` (for example `v0.71.2`); the
unversioned `/sway/latest/book/` route did not resolve at the snapshot, so
name the tag explicitly.

## Keep baselines separate

At the snapshot:

- Live mainnet and testnet both distributed core Forc `0.70.2` and Fuel Core
  `0.47.1`.
- The newest upstream Sway release was `v0.71.2`.
- Client/node/crypto/wallet Forc plugins had independent releases.

These facts illustrate the split; rerun the resolver before repeating them as
current. Name advice as project-pinned, network-distributed, upstream-release,
nightly/experimental or historical.

## Known misleading public freshness claims

These surfaces were rechecked on 2026-07-23 and are dated evidence, not a
standing map; revalidate a row before relying on it.

| ID | Surface | Freshness contradiction | Priority |
|---|---|---|---|
| DOC-001 | `docs.fuel.network/guides/installation/` | Stable guide mapped `latest` to testnet while current Fuelup mapped it to mainnet | Critical |
| DOC-002 | `install.fuel.network/master/basics.html` | Channel/nightly description contradicted its own channel page | High |
| DOC-003 | `install.fuel.network/master/overrides.html` | Reproducible-export example named a dated `latest` channel that did not exist | Critical |
| DOC-004 | `docs.fuel.network/docs/sway/` | “Stable” published Sway `0.69.0`, behind both the network compiler and the upstream release | High |
| DOC-005 | `docs.fuel.network/docs/forc/` | “Stable” published Forc `0.69.0`; obscured plugin cadence | High |
| DOC-006 | `docs.fuel.network/docs/migrations-and-disclosures/` | Promised latest-version help but Sway coverage stopped before current releases | Critical |
| DOC-007 | `github.com/FuelLabs/sway-applications` | “Updated to latest” apps used 2024 nightlies | High |
| DOC-008 | Sway `v0.71.2` cargo-generate Rust test templates (not `forc new` output) | Contract template used fuels `0.76.0`, script/predicate `0.70.0` | Medium |
| DOC-009 | `docs.fuel.network/docs/fuels-ts/` | Generated from fuels `v0.101.3`, Fuel Core `0.43.1`, Forc `0.68.7` — behind both the `v0.103.0` SDK release and the `0.47.1` network node | High |

Do not label old versioned releases, audit PDFs, pinned legacy projects or
archives as stale merely because they are old. The defect is an unqualified
claim such as current, stable or latest that conflicts with newer primary
evidence.

## Preserve reproducibility

Record:

- named channel rather than unexplained `latest`;
- exact component versions and installer version;
- manifest URL/hash and artifact checksums where supply-chain assurance matters;
- Sway manifest, root lockfile, dependencies and experimental flags;
- Rust/TypeScript SDK and runtime versions;
- RPC URL, chain ID, node version and consensus parameters;
- release ABI, bytecode, storage slots, configurables, salt and contract ID.

Fuelup exports component versions but not artifact hashes. At the snapshot,
exports based on undated `latest` could produce a nonexistent dated base
channel. Test restoration from a clean environment before calling an export
reproducible.

## Primary repositories

For syntax/API verification, prefer a local shallow clone of the exact
pinned tag (`git clone --branch <tag> --depth 1 ...`) and read its sources,
CI-built examples and e2e test programs directly; several official web pages
were stale at the snapshot while in-repo sources were authoritative.

Primary repositories:

- `FuelLabs/sway`: compiler, core Forc, standard library and versioned docs.
- `FuelLabs/forc`: independently released network-facing plugins.
- `FuelLabs/fuelup`: installer, channel semantics and live manifests.
- `FuelLabs/fuel-core`: node and chain behavior.
- `FuelLabs/fuel-specs`: protocol specification; only one tag (`v0.5.0`)
  existed at the snapshot, so treat the default branch as unreleased evidence
  and reconcile spec commits with the deployed node.
- `FuelLabs/fuels-ts` and `FuelLabs/fuels-rs`: SDKs and executable examples.
- `FuelLabs/sway-libs`, `FuelLabs/sway-standards` and `FuelLabs/audits`:
  reusable implementations, interface standards and historical findings.
