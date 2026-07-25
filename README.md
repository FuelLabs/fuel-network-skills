# Fuel Network Skills

A Codex skill for building, integrating, reviewing, optimizing, migrating, and
operating projects on Fuel. It covers Sway and FuelVM programs, Forc and
Fuelup toolchains, TypeScript and Rust SDKs, wallets and transactions, native
assets, testing, security, deployment, and performance work.

## Install

Place this repository at `$CODEX_HOME/skills/fuel-network-skills` when
`CODEX_HOME` is set, or at the default location:

```text
~/.codex/skills/fuel-network-skills
```

Then invoke it explicitly in a prompt:

```text
Use $fuel-network-skills to inspect this Fuel project before upgrading it.
```

Codex can also select the skill automatically for Fuel, FuelVM, Sway, Forc,
Fuelup, `fuels-ts`, or `fuels-rs` tasks.

## Included resources

- `SKILL.md` routes work to focused Fuel reference modules.
- `references/` contains guidance for architecture, authoring, SDKs, security,
  testing, deployment, migrations, and optimization.
- `scripts/fuel_preflight.py` inspects local Fuel project pins and artifacts
  without network access.
- `scripts/resolve_fuel_versions.py` resolves current Fuel channel and release
  versions from primary sources.
- `scripts/diff_fuel_artifacts.py` compares Fuel ABIs, bytecode, IDs, storage,
  configurables, and generated bindings.
- `evals/evals.json` provides baseline behavior evaluations.

The helper scripts require Python 3.11 or newer.

## Validate

Run the same checks used by CI:

```sh
python3 scripts/validate_repository.py
python3 -m compileall -q scripts
python3 -m unittest discover -s scripts/tests -p "test_*.py" -v
```

## License

Licensed under the [Apache License 2.0](LICENSE).
