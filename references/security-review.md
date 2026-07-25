# Fuel and Sway security review

Freeze the exact commit, toolchain, SDK/node matrix, target chain and release
artifacts before reviewing. Historical reports are scoped evidence, not proof
of a current vulnerability.

- [Review in invariant order](#review-in-invariant-order)
- [Audit predicates as complete locks](#audit-predicates-as-complete-locks)
- [Bind complete transaction intent](#bind-complete-transaction-intent)
- [Treat calls and storage as adversarial](#treat-calls-and-storage-as-adversarial)
- [Control failure-position and gas griefing](#control-failure-position-and-gas-griefing)
- [Validate oracle and time inputs](#validate-oracle-and-time-inputs)
- [Review lifecycle and operations](#review-lifecycle-and-operations)
- [Protect upgrade and migration checkpoints](#protect-upgrade-and-migration-checkpoints)
- [Quarantine compiler-sensitive code](#quarantine-compiler-sensitive-code)
- [Flag Fuel-specific failures](#flag-fuel-specific-failures)
- [Report findings usefully](#report-findings-usefully)

## Review in invariant order

1. Identify trust boundaries, authorities, assets, program types, off-chain
   actors and upgrade paths.
2. Write transaction-level conservation laws for every value path.
3. Prove authorization for ordinary signatures, predicates and contracts.
4. Review external calls and transaction I/O.
5. Review storage, initialization, pause, ownership, proxy and migration paths.
6. Review low-level/compiler-sensitive code and final release artifacts.
7. Review relayers, indexers, wallets and deployment/admin tooling.
8. Test failure, liveness and incident-containment behavior.

For each externally callable value path, enumerate inputs/outputs, asset IDs,
amounts, decimal scale, fees, dust, change, balance deltas, mint/burn supply,
messages/replay identity and revert behavior. Test zero, one, maximum, wrong
asset/decimals, duplicate/reordered outputs, partial fill, self-transfer,
asymmetric rounding and fee edges.

Define invariants independently of entry points and assert them after every
state-changing path, not only the path that introduced the constraint. Use
wide intermediates with checked narrowing, define decimal normalization and
rounding direction explicitly, and property-test repeated state transitions —
not only isolated calls — across minimums, maximums, overflow boundaries and
heterogeneous token decimals.

## Audit predicates as complete locks

A predicate is not a helper; it is the authorization boundary for its UTXO.
Anyone can submit a transaction that returns true.

Review and adversarially permute:

- exact controlled input(s), index assumptions and asset/amount;
- all required outputs, recipient, amount bounds, change and duplicates;
- whether one qualifying output could be reused by multiple predicate inputs;
- beneficiary net asset gain when the beneficiary can also supply inputs;
- extra inputs/outputs that may move unrelated value;
- script bytecode/hash and permitted contract set where relevant;
- predicate-data encoding, version and domain;
- witness indices, signature intent, chain/application scope, nonce and expiry;
- maturity/expiration policy;
- false-on-malformed behavior;
- per-input predicate gas after final transaction ordering.

When batching predicate inputs is allowed, scale consideration across the
controlled inputs or bind each input to distinct consideration. Otherwise
require exactly one controlled predicate input. Do not treat a gross output as
payment if it may simply return the beneficiary's own input or change.

Reject predicate designs that require mutable contract state, an oracle, a
wall clock, block height/hash reads, or contract calls. Route those rules to a
contract, optionally with a script for atomic orchestration.

## Bind complete transaction intent

For every signature, predicate, replay key and cross-package commitment,
decide explicitly whether to bind:

- Fuel chain ID, application/protocol and message subdomain;
- transaction type and permitted script bytecode;
- target contract and method;
- policy/schema version and authority epoch;
- nonce/UTXO rollover and transaction ID where instance binding is required;
- input/output type, exact controlled counts, ordering and uniqueness;
- owner, recipient, asset, amount and beneficiary net gain;
- witness index, payload length and authenticated content/commitment;
- expiration and validity window.

Do not infer authorization from witness volume or bitmap population. Reject
bits outside configured signer positions, require signer uniqueness and bind
each signer/witness to policy membership.

Normalize field order, declared width, discriminants, tags, tuple/stream
encoding and defaults across registry, auditor, predicate, script, contract and
SDK copies. A research fixture found an auditor/predicate witness-index width
discrepancy; normalization removed a possible root mismatch and reduced cost.

Hash output variants through an explicit discriminant. Do not rely on
zero/default getters that collapse variants. Bind recipient net gain rather
than gross output when the beneficiary can also provide matching inputs, and
prevent one output from satisfying multiple controlled inputs.

A hash tested only for `!= b256::zero()` is not authentication. Compare it
with an authenticated expectation or use it in a replay/authorization
decision. Treat the measured gas/byte cost of domain, chain, script, type and
witness fields as the price of the security property, not removable overhead.
Read [auto-research-findings.md](auto-research-findings.md) for measured costs
and encoding pitfalls.

## Treat calls and storage as adversarial

- Validate caller, asset, amount, limits and state before interaction.
- Apply checks-effects-interactions and guard recursive entry when it can break
  an invariant.
- Bound forwarded gas, call count and receipt-producing loops.
- Include every called/inspected contract in transaction I/O, including
  conditional paths.
- Validate returns, receipts and output shape.
- Bound and paginate storage growth; avoid unbounded scans/middle vector edits.
- Namespace proxy/external-code storage and prove schema compatibility.
- Distinguish absent entries from `Some(0)`: test the absent → nonzero → zero →
  reused lifecycle, and never use entry existence as a security condition when
  the stored value can legitimately reach zero.
- Check storage-key derivation for collisions across plain variables, maps,
  custom slots and library/administrative storage; domain-separate keys and
  audit any custom slot on its own.

Native-asset transfer does not execute receiver code, but explicit `CALL`
still creates an untrusted reentrancy/failure boundary.

Keep callee validations independent when they detect different malicious
modes: echoed nonce, acceptance flag, digest, work score, callback outcome and
post-call state. Honest-data digest overlap does not prove a scalar check is
redundant against a malicious callee.

Set reentrancy/callback state before the external call. Cache post-call
snapshots only after proving no reachable callback can mutate them. Validate a
malformed untrusted return before optional post-call work only when the return
alone determines failure and all required state checks remain on the valid
path.

## Control failure-position and gas griefing

Bound all attacker-controlled loops, calls, retries, outputs, witnesses,
receipts and storage growth. Compare:

- first-invalid versus last-invalid lanes at equal total shape;
- missing/expired/malformed values before and after bounded work;
- first versus last duplicate;
- early versus late retry exhaustion;
- immediate revert versus successful calls followed by late revert;
- repeated rejected request IDs and refund/retry behavior.

Place a cheap, independent reject before hashes, witness scans, storage reads
or bounded kernels when the accepted transaction set is identical. Entrypoint
research saved about 1,250 gas on malformed transaction-shape gates and
3,832-3,960 gas on expired oracle lanes by avoiding bounded work.

Do not infer forwarded-gas, fee/refund, receipt-limit, callback-depth or
cross-contract rollback behavior from a detached helper or single-contract
unit test. Require an SDK/target-node fixture.

## Validate oracle and time inputs

Fail closed unless every property of a price update is valid for the specific
feed: feed identity, sign and nonzero value, exponent/decimal scale, freshness,
absence of future timestamps, and a per-feed conservative confidence bound.
One confidence threshold applied across heterogeneous feeds is a finding, as is
validating only the numeric price. Verify the asset and amount used to pay
oracle update fees.

Host and block timestamps drift; a 2025 Fuel NTP incident skewed hosts by about
90 seconds and stalled Pyth-dependent protocols. Time-sensitive logic must
tolerate imperfect clocks and define behavior when a feed rejects updates or
serves stale data. Test stale, missing, negative, future-dated,
wide-confidence-interval and differently scaled values.

## Review lifecycle and operations

Require one-time initialization guards, least privilege, two-step/delayed
high-impact transfers, old-message/state migration tests and rollback or
containment. A permissionless or re-callable initializer is an ownership
takeover path. Check configurables, salt, implementation IDs and authority
changes because they can change bytecode identity or strand old operations.

Specify pause behavior as an explicit operation matrix stating which
operations remain available in each pause state. Preserve repayment,
collateral addition and safe user withdrawals wherever possible; pausing those
while liquidation stays live turns a technical incident into user insolvency.
Test that liquidation and administrative operations cannot exploit a partial
pause, and include a recovery path for stranded assets that is not an
unrestricted drain.

For cross-layer systems, generate or differentially test one canonical schema:
tags, field order/width, hashes, asset IDs, metadata, decimal conversion,
base-asset forwarding, malformed messages and finality.

Relayers/indexers require integer-only accounting, every-event verification,
inclusive pagination, crash-safe idempotency, live configuration, chain-ID
checks and concurrency-safe UTXO selection. Prove liveness/fairness of rate
limits, not only safety.

## Protect upgrade and migration checkpoints

For shard/batch migrations:

- require accepted work to advance a contiguous committed checkpoint;
- bind interruption/resume positions to that checkpoint;
- reject duplicate, out-of-order, empty and over-capacity receipts before
  mutation;
- reject null proofs when zero is not a valid capability;
- make rollback restore an explicitly recorded source version, or require
  adjacent versions if rollback subtracts one;
- synchronize plan/receipt encodings across coordinator, script, adapter and
  clients;
- bind source/target version, layout/code roots, shard/range, authority epoch,
  nonce/domain and validity window;
- test rollback before first work, mid-migration and after finalization.

Do not claim crash safety from one call. Test restart, transaction boundaries,
retry of committed work, mixed legacy/current reads and stale clients with a
pinned SDK/node harness.

## Quarantine compiler-sensitive code

Isolate `asm`, raw pointers, storage-key calculations, hashing, signature
recovery and byte decoding behind typed wrappers with explicit bounds and
pass/fail VM tests. Compare debug and release behavior and inspect final
IR/ASM/bytecode when these paths or the compiler change. Independently
reproduce the deployed bytecode and contract code root from the pinned
toolchain; the exact compiler and standard-library release are part of the
application's trusted computing base.

- Fuzz dynamic ABI arguments around encoder buffer boundaries, especially near
  and above 1024 bytes: a fixed-buffer encoder defect corrupted adjacent
  cross-contract call data (including a method selector) and halted Swaylend
  for about two days in 2024.
- Negative-test raw-selector calls to private, inherited, administrative,
  initializer and upgrade methods. Supertrait methods intended to be private
  have been reachable through contract dispatch
  ([Sway #6333](https://github.com/FuelLabs/sway/issues/6333)); enforce
  authorization inside every sensitive implementation, never via ABI
  visibility, trait inheritance or generated ABI metadata.

Public Fuel audits have historically found classes including:

- compiler semantic/optimization errors;
- incomplete predicate output/witness binding and blind signing;
- one-step ownership transfer;
- decimal normalization and asset conservation failures;
- message encoding/finality and outstanding-message migration failures;
- reserve/share/fee and rounding errors, including fees removed from contract
  assets without reducing internal reserve accounting;
- pagination, idempotency, stale configuration and shared-signer UTXO races
  (service-layer findings scoped to the Fuel Fast Bridge review);
- intended-private ABI/supertrait methods exposed through dispatch;
- storage-key derivation collisions between variables, maps and library
  storage ([Sway #6317](https://github.com/FuelLabs/sway/issues/6317));
- oracle freshness, confidence and decimal validation gaps;
- invariants enforced at one entry point (borrow/mint/deposit) but not on
  partial repayment, fee accrual, liquidation, withdrawal or administrative
  paths;
- bounds enforced during minting but not when fees grow reserves, allowing
  overflow or locked state;
- residual assets or shares in non-atomic multi-transaction workflows exposed
  to front-running;
- cross-layer messages included from reverted transactions — rollback
  semantics do not cross a bridge boundary.

Use these as regression categories. Verify the report's commit, remediation
and deployed artifact before asserting present impact. Key public records:
the [Swaylend encoder outage](https://anatomi.st/blog/2024_11_07_swaylend_shutdown),
the [Fuel timestamp-sync postmortem](https://forum.fuel.network/t/post-mortem-timestamp-sync-issue-with-our-networks/9285),
the [Fuel Attackathon reports](https://reports.immunefi.com/fuel-network-or-attackathon),
the [Hexens fuel-bridge audit](https://resources.cryptocompare.com/asset-management/18361/1737037771623.pdf)
with fix PRs [#166](https://github.com/FuelLabs/fuel-bridge/pull/166) and
[#169](https://github.com/FuelLabs/fuel-bridge/pull/169),
the [Swaylend audit index](https://docs.swaylend.com/smart-contract-audit) and
[Immunefi IOP](https://reports.immunefi.com/swaylend_iop),
the [ThunderNFT IOP](https://reports.immunefi.com/thundernft-or-iop), and the
[Zealynx binned-liquidity AMM audit](https://www.zealynx.io/audits/microchain/binned-liquidity-amm-q3-2025).
As of mid-2026 no public source documents a confirmed fund-loss exploit of a
deployed Sway application contract; treat that as absence of evidence, not
proof of safety.

## Flag Fuel-specific failures

- Missing variable output for a dynamic address transfer.
- Assets sent to a contract with no withdrawal path.
- Missing contract input/output on a conditional call.
- Incorrect `msg_sender`, `msg_asset_id` or `msg_amount` assumption.
- `msg_amount() >= expected` accepted with the excess silently stranded rather
  than rejected or refunded.
- ABI method treated as a trusted local helper.
- Storage write after untrusted interaction or partial reentrancy coverage.
- Unbounded storage, calls, outputs or receipts.
- Predicate that finds one good output but does not bind all moved value.
- Order or position edits that do not refund or collect the amount difference
  against escrowed assets.
- Delisting or removing an asset in a way that freezes user withdrawals.
- Refund state recorded around a fallible call so that failure strands funds.
- Signature missing chain/domain/nonce/call scope.
- Nightly/deprecated opcode, storage intrinsic or encoding copied into release
  code.
- Debug artifact or ABI/bytecode/storage/binding mismatch in deployment.

## Report findings usefully

For each finding include severity, confidence, file/line, version/artifact
scope, violated invariant or affected asset, prerequisites, concrete
exploit/failure transaction, impact, minimal fix and regression test. Separate
confirmed defects from hardening and unresolved compatibility questions. Use
the repository's private disclosure process for plausible undisclosed
vulnerabilities.
