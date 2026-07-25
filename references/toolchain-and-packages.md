# Toolchain and packages

Verified against Sway `v0.71.2` and the live channel research snapshot on
2026-07-23. Run the version resolver before choosing a current baseline.

- [Select and inspect tooling](#select-and-inspect-tooling)
- [Create packages and workspaces](#create-packages-and-workspaces)
- [Maintain manifests](#maintain-manifests)
- [Change dependencies deliberately](#change-dependencies-deliberately)
- [Build and inspect](#build-and-inspect)
- [Build from source](#build-from-source)

## Select and inspect tooling

Install Fuelup only with user authorization and according to local
supply-chain policy. The canonical installer is `https://install.fuel.network/`.
Prefer named channels:

```sh
fuelup toolchain install mainnet
fuelup default mainnet
fuelup show
forc --version
fuel-core --version
forc plugins
```

Use `testnet` when that is the target. Treat `latest` as an alias whose live
meaning must be resolved. Treat `nightly` as experimental.

Core Forc, `fmt`, `lsp`, `doc`, `debug`, `migrate`, `tx` and `publish` ship
with the Sway repository/toolchain. Network-facing `call`, `deploy`, `run`,
`submit`, `node`, `crypto` and `wallet` families can come from independently
released plugins in `FuelLabs/forc`. Check the active plugin list and each
command's `--help`.

## Create packages and workspaces

Use the installed CLI to generate current scaffolding:

```sh
forc new my_contract --contract
forc new my_script --script
forc new my_predicate --predicate
forc new my_library --library
forc new my_workspace --workspace
forc init --path . --contract
```

A workspace root normally has:

```toml
[workspace]
members = ["contracts/core", "scripts/periphery", "libraries/interfaces"]
```

Run package operations from the workspace root so members share the root
`Forc.lock`, unless deliberately targeting one package.

## Maintain manifests

Use `[dependencies]` for source/library dependencies. Use
`[contract-dependencies]` when the build needs another contract's deterministic
`CONTRACT_ID`; it does not import that contract's source namespace.

```toml
[project]
authors = ["team"]
entry = "main.sw"
license = "Apache-2.0"
name = "example"
forc-version = "<minimum-tested-forc-version>"

[dependencies]
interfaces = { path = "../interfaces" }
audited_lib = { git = "https://github.com/org/repo", rev = "<commit>" }

[contract-dependencies]
target = { path = "../target", salt = "<32-byte-salt>" }
```

Treat `forc-version` as a minimum, not a full environment lock. Keep
`implicit-std = true` unless there is a reviewed no-std requirement. Pin Git
dependencies by immutable revision or controlled release tag. Record contract
dependency salts because they affect IDs.

## Change dependencies deliberately

```sh
forc add package@<version> --dry-run
forc add package@<version>
forc add package --git https://github.com/org/repo --rev <commit>
forc add local_name --path ../local_name
forc add target --contract-dep --path ../target --salt <32-byte-salt>
forc remove package
forc update --check
forc update -d package
```

Review both `Forc.toml` and `Forc.lock`. Do not run `forc update` in a
reproducible build job. Use `--locked` so resolution drift fails rather than
rewriting the lock.

`--locked` is not a no-network promise. In Sway `v0.71.2`, even a cached locked
registry dependency could still trigger a remote registry-index read under
`--offline`. Test hermetic builds in a network-denied environment; use a
reviewed local/path vendoring strategy when true air-gapping is required.

## Build and inspect

```sh
forc fmt --check
forc check --locked
forc test --locked
forc build --release --locked
forc test --release --locked
```

Use `forc fmt` without `--check` only when formatting mutation is intended.
Archive the release ABI, bytecode, storage slots, configurables and roots/IDs
that feed bindings or deployment. Never deploy a debug artifact.

For deeper inspection, verify flags on the installed version:

```sh
forc build --release --locked --ir initial final --asm final --bytecode
forc build --release --locked --metrics-outfile build-metrics.json
forc parse-bytecode out/release/<package>.bin
forc contract-id --release
forc predicate-root --release
forc doc
```

## Build from source

Build a named release with its lockfile and tested Rust version:

```sh
git clone --branch <sway-tag> --depth 1 https://github.com/FuelLabs/sway.git
cd sway
cargo build --release --locked -p forc
```

Sway `v0.71.2` CI pinned Rust `1.93.0` through its workflow environment (the
release commits no `rust-toolchain` file or `rust-version` field), and its
locked Fuel Core dependencies required that compiler. Do not “fix” a release
build by updating its lockfile.
Use the tag's CI/toolchain evidence, then run the release's own tests.

Publish packages or install/update tooling only with explicit authorization.
Before `forc publish`, inspect the exact package contents, license, namespace,
version, secrets and local paths.
