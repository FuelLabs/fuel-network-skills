# Transactions and wallets

Ground transaction construction in the target node's chain ID and consensus
parameters. SDK builders reduce bookkeeping but do not replace review of the
final transaction.

- [Model the whole transaction](#model-the-whole-transaction)
- [Select resources safely](#select-resources-safely)
- [Bind authorization](#bind-authorization)
- [Bind predicate consideration and witnesses](#bind-predicate-consideration-and-witnesses)
- [Construct readable efficient transactions](#construct-readable-efficient-transactions)
- [Separate read, simulate, sign and submit](#separate-read-simulate-sign-and-submit)
- [Handle wallets and keys by environment](#handle-wallets-and-keys-by-environment)

## Model the whole transaction

Account for:

- coin, message, contract and predicate inputs;
- coin, contract, change and variable outputs;
- script bytecode/data and predicate bytecode/data;
- witnesses and their indices;
- maturity, expiration, gas and fee policies;
- every called or balance-inspected contract.

Each contract input needs its matching contract output. Dynamic transfers may
need variable outputs. Every input asset needs a deliberate spend and change
policy. Add fees after calculating the base-asset amount consumed by the
application.

Do not hand-maintain dynamic predicate-data pointers or witness indices if a
current SDK builder can resolve them after final input ordering. Inspect the
built transaction after estimation because adding resources can change offsets,
size, predicate work and fees.

## Select resources safely

- Select the minimum practical UTXO set without creating fragile exact-match
  assumptions.
- Avoid concurrent reuse of the same wallet UTXOs; reserve/serialize or retry
  resource selection in services.
- Recompute funding and fee estimates after any transaction-shape change.
- Return change to the intended account and asset.
- Test mixed coin/message inputs, many small coins, dust and insufficient fee
  funds.
- Treat relayer/indexer pagination and UTXO concurrency as correctness and
  security concerns.

## Bind authorization

For wallet signatures, domain-separate human-readable intent by chain,
application/contract, operation, data version, nonce, expiry, assets/amounts,
recipient and permitted calls. Verify what the wallet displays; never ask a
user to blind-sign an opaque hash when typed intent is possible.

For predicates, assume anyone can submit a satisfying transaction. Bind all
relevant inputs and outputs, asset amounts, recipient/change, script/contracts,
predicate-data version/domain, witness index, nonce and supported time policy.
Malformed data and out-of-range indices should return false cleanly rather than
panic where possible. Estimate predicate gas on the final transaction for each
predicate input.

## Bind predicate consideration and witnesses

Decide explicitly whether the intent must bind:

- chain, application/subdomain and transaction type;
- script bytecode, target contracts and methods;
- policy/schema version and authority epoch;
- exact controlled input and rollover/consideration output counts;
- input/output variant discriminants, ordering and uniqueness;
- owner, recipient, asset, amount and beneficiary net gain;
- witness index, payload length and authenticated content/commitment;
- nonce/UTXO rollover, transaction ID and expiry.

Do not count the beneficiary's own matching inputs as payment. Require outputs
minus matching beneficiary inputs to meet consideration when net gain is the
economic invariant. Prevent one qualifying output from satisfying multiple
predicate inputs.

Do not infer signer identity from total witness bytes, witness count or bitmap
population. Bind signers to policy membership and reject bitmap positions
outside the configured signer domain.

Normalize field type widths and discriminants across SDK, script, predicate,
auditor and contract commitment implementations. Use an explicit output
variant discriminant rather than hashing getters that default missing fields
to zero.

## Construct readable efficient transactions

Use an SDK builder and explicit intent model. For performance:

- reject missing/invalid counts, recipients and rollover outputs before
  witness/hash work where the verdict is independent;
- calculate counts/indices after final resource ordering;
- avoid unrelated inputs/outputs/witnesses in the final shape;
- bind exact uniqueness instead of repeatedly scanning ambiguous matches;
- estimate every predicate after all resources and change outputs are present;
- benchmark early-invalid, late-invalid and maximum-valid shapes.

Research entrypoints saved about 1,250 gas by moving independent malformed
input/output/recipient checks before later bounded work. Do not manufacture
that saving by dropping a required binding dimension. Read
[auto-research-findings.md](auto-research-findings.md) for the measured
security-cost table.

## Separate read, simulate, sign and submit

Use a staged flow:

1. Build a transaction request from explicit user intent.
2. Add required contract I/O, outputs and resources.
3. Query costs/consensus data and estimate predicates.
4. Simulate/dry-run the exact final shape.
5. Present network, account, recipient, assets, amounts, fees and calls.
6. Sign only after confirmation.
7. Submit only with authority, then wait for and inspect the final result.

Do not treat a successful simulation as final inclusion. Check transaction
status, receipts, block/confirmation policy and application state. Decode logs
and reverts using the exact ABI that built the call.

## Handle wallets and keys by environment

- In browsers, use supported wallet connectors; never bundle private keys or
  server secrets into client code.
- In server-side tools, load secrets through the approved secret system and
  avoid printing key material or full signed transactions unnecessarily.
- Keep view-only accounts/providers separate from unlocked signers.
- Validate that the wallet-selected chain and provider match the deployment.
- Use isolated, funded test wallets only on local ephemeral nodes.
- Do not fund, import, unlock, sign, broadcast or rotate keys without explicit
  user authority.

Record the final transaction ID, chain, account, asset flows, fee, receipts and
relevant deployment IDs for production operations.
