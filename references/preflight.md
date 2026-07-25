# Preflight and compatibility gate

Verified research snapshot: 2026-07-23. Resolve live facts again whenever the
request depends on “latest,” a target network, or a deployment.

## Run the gate

1. Run the network-free inspector from the skill directory:

   ```sh
   python3 scripts/fuel_preflight.py --path <project>
   ```

2. Read every discovered `fuel-toolchain.toml`, root and member `Forc.toml`,
   `Forc.lock`, Cargo lockfile, JavaScript lockfile, generated binding, ABI,
   bytecode, storage-slot file, and deployment record relevant to the task.
3. Run installed-version and help commands without changing the project:

   ```sh
   fuelup --version
   fuelup show
   forc --version
   forc plugins
   fuel-core --version
   forc <relevant-command> --help
   ```

4. Identify one requested baseline:

   - `project-pinned`: reproduce the checked-in project;
   - `network-distributed`: match live `mainnet` or `testnet`;
   - `upstream-release`: use an explicit Sway/Forc release plus compatible
     node, plugins and SDKs;
   - `nightly/experimental`: accept instability intentionally;
   - `historical`: reproduce a named incident, audit or deployment.

5. If current versions matter, run:

   ```sh
   python3 scripts/resolve_fuel_versions.py --json
   ```

   Treat any endpoint error as unresolved evidence. Do not silently substitute
   a remembered version or an unversioned documentation page.

6. Record the target RPC URL, chain ID, consensus parameters, deployed contract
   IDs and bytecode, and the account/network selected by a wallet. Query rather
   than copying numeric gas or transaction limits from a dev node.
7. Build a compatibility matrix before mixing components:

   | Layer | Exact selection | Evidence |
   |---|---|---|
   | Sway/core Forc | version/commit | local binary, release tag, project pin |
   | Forc client/node plugins | independent release | plugin list and release |
   | Fuel Core/chain | node version and chain ID | node query/channel manifest |
   | Sway dependencies | resolved commits/versions | `Forc.lock` |
   | Rust SDK | crate versions | `Cargo.lock` |
   | TypeScript SDK | package versions | JS lockfile |
   | Artifacts | hashes/IDs | archived release output/deployment record |

8. Label uncertainty. Matching version numbers are not compatibility evidence.

## Gate by task

- For explanation only, inspect pins if a project is present; avoid mutation.
- For code changes, preserve the active baseline unless the user requested an
  upgrade.
- For dependency changes, review both manifest and lockfile diffs.
- For migrations, establish old-minor/latest-patch and explicit target
  baselines before editing.
- For deployment, require release artifacts, target-node facts, deterministic
  identity inputs, dry-run/preflight results, and explicit submission authority.
- For review, compare source to the release artifacts that would actually ship.

## Stop conditions

Pause rather than guess when:

- the named network is unclear and the choice affects compatibility;
- local pins conflict and no authoritative deployment record resolves them;
- a required primary endpoint fails during a latest-version decision;
- a command would sign, spend, fund, publish, deploy, submit or rotate
  authority without user permission;
- only debug artifacts exist for a production deployment or security review.
