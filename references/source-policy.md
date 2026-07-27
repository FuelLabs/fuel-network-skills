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

Use `scripts/resolve_fuel_versions.py` for live channel/release facts. Use
`<command> --help` for flags on the installed binary.

Version-pinned Sway documentation is published per tag at
`https://fuellabs.github.io/sway/<tag>/book/` (for example `v0.71.2`); the
unversioned `/sway/latest/book/` route did not resolve at the snapshot, so
name the tag explicitly.

## Keep baselines separate

At the snapshot:

- Fuelup `latest` aliased `mainnet`.
- Live mainnet and testnet both distributed core Forc `0.70.2` and Fuel Core
  `0.47.1`.
- The newest upstream Sway release was `v0.71.2`.
- Client/node/crypto/wallet Forc plugins had independent releases.

These facts illustrate the split; rerun the resolver before repeating them as
current. Never infer SDK, node or plugin compatibility by equal-looking
versions. Name advice as project-pinned, network-distributed,
upstream-release, nightly/experimental or historical.

## Known misleading public freshness claims

The following public-facing surfaces were rechecked on 2026-07-23. Revalidate
before filing an update because maintainers may have fixed them.

| ID | Surface | Freshness contradiction | Priority |
|---|---|---|---|
| DOC-001 | `docs.fuel.network/guides/installation/` | Stable guide mapped `latest` to testnet, while current Fuelup mapped it to mainnet | Critical |
| DOC-002 | `install.fuel.network/master/basics.html` | Current manual described one release channel and nightly as unfinished, contradicting its own channel page | High |
| DOC-003 | `install.fuel.network/master/overrides.html` | Reproducible export example named a dated `latest` channel that did not exist | Critical |
| DOC-004 | `docs.fuel.network/docs/sway/` | “Stable” published Sway `0.69.0`, behind both the network compiler and upstream release | High |
| DOC-005 | `docs.fuel.network/docs/forc/` | “Stable” command reference published Forc `0.69.0` and obscured independent plugin cadence | High |
| DOC-006 | `docs.fuel.network/docs/migrations-and-disclosures/` | Promised latest-version help but Sway coverage stopped before current releases | Critical |
| DOC-007 | `github.com/FuelLabs/sway-applications` | Claimed low-maintenance apps were updated to latest while they used 2024 nightlies | High |
| DOC-008 | Sway `v0.71.2` cargo-generate Rust test templates (`templates/`) | Contract template used fuels `0.76.0`; script/predicate templates used `0.70.0` without explaining skew (these are cargo-generate templates, not `forc new` output) | Medium |
| DOC-009 | `docs.fuel.network/docs/fuels-ts/` | Docs generated from fuels `v0.101.3` with Fuel Core `0.43.1` and Forc `0.68.7`, behind both the `v0.103.0` SDK release and the `0.47.1` network node (rechecked 2026-07-23) | High |

For remediation:

- Correct installation/channel semantics first.
- Make exported toolchains restore in a clean environment or narrow the
  reproducibility claim.
- Generate CLI pages from exact binaries and display the component repository
  and version.
- Show docs source version, current network channel and current upstream
  release as separate badges.
- Put an archive banner and explicit coverage range on stale migrations and
  examples.
- Test every generated program-type template against a published compatibility
  matrix.

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
