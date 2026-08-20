# Fuel Network Skills

An agent skill for building, integrating, reviewing, optimizing, migrating, and
operating projects on Fuel. It covers Sway and FuelVM programs, Forc and
Fuelup toolchains, TypeScript and Rust SDKs, wallets and transactions, native
assets, testing, security, deployment, and performance work. Pinned,
self-contained references cover the Sway language, storage, standard library,
SRC interfaces, FuelVM assembly, ABI encoding, and worked examples.

## Install

Place this repository in the skills directory of your agent:

```text
~/.codex/skills/fuel-network-skills     # Codex ($CODEX_HOME/skills/... when set)
~/.claude/skills/fuel-network-skills    # Claude Code
```

Then invoke it explicitly in a prompt — `Use $fuel-network-skills ...` in
Codex, `/fuel-network-skills` or "use the fuel-network-skills skill" in Claude
Code:

```text
Use $fuel-network-skills to inspect this Fuel project before upgrading it.
```

Both agents can also select the skill automatically for Fuel, FuelVM, Sway,
Forc, Fuelup, `fuels-ts`, or `fuels-rs` tasks.

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
- `fixtures/transaction-binding-predicate/` holds the compilable source, the
  `forc test` encoding check, and the optional local-node harness behind the
  transaction-binding predicate in `references/worked-examples.md`.
- `evals/evals.json` provides baseline behavior evaluations.

The helper scripts require Python 3.11 or newer.

## Validate

Run the same checks used by CI:

```sh
python3 scripts/validate_repository.py
python3 -m compileall -q scripts
python3 -m unittest discover -s scripts/tests -p "test_*.py" -v
```

`validate_repository.py` also runs the drift check that keeps the documented
transaction-binding predicate byte-identical to its fixture source; the deeper
`forc` and local-node verification is manual, per
[`fixtures/transaction-binding-predicate/README.md`](fixtures/transaction-binding-predicate/README.md).

Maintainers: update the `Last updated` timestamp in `SKILL.md` whenever any
file in this skill changes.

## License

Licensed under the [Apache License 2.0](LICENSE).
