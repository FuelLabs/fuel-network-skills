# Program architecture

Verified against Sway `v0.71.2` and FuelVM specification revision
`dd11147b8d7f`. Query target-node limits instead of copying numeric constants.

- [Choose the smallest state boundary](#choose-the-smallest-state-boundary)
- [Use predicates only for complete transaction-local authorization](#use-predicates-only-for-complete-transaction-local-authorization)
- [Use scripts for atomic orchestration](#use-scripts-for-atomic-orchestration)
- [Use contracts for shared state](#use-contracts-for-shared-state)
- [Apply research-informed state placement](#apply-research-informed-state-placement)
- [Preserve safe concurrency](#preserve-safe-concurrency)
- [Design for readable performance](#design-for-readable-performance)

## Choose the smallest state boundary

| Mechanism | Lifetime | Good fit | Bad fit |
|---|---|---|---|
| Signed coin/message input | UTXO until spent | Ordinary ownership and value transfer | Conditions a signer must not be free to waive |
| Predicate-owned UTXO | Stateless verifier on spend | Multisig, spending policy, OTC intent, transaction-shape escrow | Shared history, mutable allowlists, oracle state, contract calls |
| Script | One transaction | Atomic routing, batching and multi-contract composition | Shared persistent state or a callable service |
| Contract | Deployed code and persistent storage/balances | Pools, lending, registries, governance and stateful authorization | A purely transaction-local condition |
| Library | Compiled into consumers | Shared types, ABIs, math and logic | Independent execution or storage |

Ask in order:

1. Is ordinary signature ownership sufficient? Use a signed UTXO.
2. Can the complete authorization rule be proven from the spending transaction
   and deterministic predicate data? Consider a predicate.
3. Is this one atomic, ephemeral workflow across existing contracts? Use a
   script.
4. Do later transactions need shared history, an oracle-fed value, governance
   or contract-owned native assets? Use a contract.
5. Is it only reusable code or interface definition? Use a library.

## Use predicates only for complete transaction-local authorization

A predicate root owns its UTXO. Anyone may submit a transaction that satisfies
the predicate, so the predicate must bind every economically relevant detail:

- exact input or input class;
- asset IDs and amounts;
- required recipients and change policy;
- output minima/exactness, ordering assumptions and duplicate handling;
- whether payment is a true net gain and whether one output can authorize more
  than one predicate input;
- predicate-data domain/version, signatures, nonces and expiry policy;
- permitted script, contract set and transaction shape.

A predicate cannot read/write contract storage or call a contract, and it
cannot read block height, block hash or time. Executing a disallowed or impure
instruction halts verification returning `false`, which invalidates the
transaction rather than panicking. Loading code from a non-contract blob
target is permitted but grants no access to contract state or calls. A
predicate runs per predicate input, so repeated code/data and work affect size
and gas. Use transaction maturity/expiration policy for supported time
constraints; use a contract when mutable state, block context or an oracle is
required.

## Use scripts for atomic orchestration

A script is the transaction entry point and has no durable state. Use one to
coordinate user intent across contracts in one atomic transaction. Bind
minimum output, maximum input, recipient, route, asset IDs and permitted
contracts. Provision all contract, coin, message, change and variable I/O the
worst valid path needs. A contract cannot call a script.

## Use contracts for shared state

Use a contract when future transactions depend on persistent accounting,
history, governance, contract-held balances or an API callable by other
contracts. Design around:

- asset conservation and decimal/rounding rules;
- explicit initialization, authority, pause, migration and governance;
- checks-effects-interactions and reentrancy at external calls;
- bounded/paginated operations;
- stable storage namespaces and schema;
- failure atomicity and observable receipts;
- upgradeability versus immutability and incident response.

Fuel transactions explicitly list contracts they touch. Provide each required
contract input and corresponding output, including conditional paths.

## Apply research-informed state placement

Treat stateful, stateless and hybrid policies as different cost/trust
placements:

- **Stateful contract:** use authoritative nonce, epoch, freeze, revocation,
  usage limits and recovery. Expect storage/deployment cost and shared-state
  contention.
- **Stateless predicate:** use only a complete transaction-local rule. Expect
  per-spend code/data and UTXO rollover for replay/freshness.
- **Hybrid:** use only when a concrete mutable revocation/recovery requirement
  justifies the extra trust/read boundary.

Measured entrypoint tradeoffs on forc 0.71.2:

- repeating a policy read: +848 gas/+80 B;
- carrying the full assessed policy into consume: -786 gas/+112 B;
- carrying only epoch/nonce and revalidating before mutation:
  +11 gas/+48 B;
- sharing one registry lookup: -112 B, but adds the dynamic read to the
  predicate-only path;
- sharing path-specific rollover helpers: +160 B or 0/0.

Default to a readable private assessment result containing only the fields the
mutation consumes, then revalidate its version/nonce against authoritative
state before writing. Do not pass a large unauthenticated policy claim merely
to avoid a read.

A sequential nonce+epoch may subsume a separate consumed map in a strictly
atomic single-action model, but do not delete replay state until concurrent,
reentrant, batched, resumable and non-sequential cases are proven equivalent.

When comparing stateful, stateless and hybrid placements, hold constant the
owner/recipient/asset/amount, validity window and epoch, replay strength,
chain/application/script/contract domains, accepted transaction set, and
recovery behavior. Account for contract deployment, storage I/O, predicate
code/data shipped per spend, contract inputs/outputs, wallet resource
selection, and failure liveness — never only unit-test gas.

## Preserve safe concurrency

Disjoint UTXOs and write sets can enable parallel validation; transactions that
spend the same UTXO or mutate the same state still conflict. Partition
independent ownership/state when semantically correct, but never split one
invariant simply to claim parallelism. Measure contention on the target node.

Before implementation, enumerate the worst-case inputs, outputs, witnesses,
predicate executions, contract I/O, storage slots, calls and receipts. Revisit
the program-type choice during review.

## Design for readable performance

Make the ordinary architecture efficient without obscuring it:

- reject malformed transaction shape before expensive policy work;
- read authoritative state once per phase and write once;
- keep checks-effects-interactions explicit;
- use one complete canonical commitment rather than a deep hash tree;
- centralize cross-package encodings in shared types/test vectors;
- keep fixed bounded loops readable unless profiling justifies unrolling;
- isolate any asm or compiler-sensitive kernel behind a typed Sway interface
  and retain a readable oracle.

Use [performance.md](performance.md) for the measured evidence behind these
defaults and [maximum-optimization.md](maximum-optimization.md) only for an
explicit maximum-optimization request.
