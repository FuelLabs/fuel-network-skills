# ABI format, argument encoding, and transaction format

Verified against Sway `v0.71.2` (`fuel-abi-types 0.15.3`), `fuel-tx`/`fuel-vm`
`v0.66.4`, and `fuel-specs` revision `dd11147`. Where the spec text and the
implementation disagree, the implementation is stated here and the
discrepancy noted — the spec repo lags the compiler at this snapshot.

## ABI JSON format

Top-level keys (camelCase): `programType`
(`contract|script|predicate|library`), `specVersion`, `encodingVersion`,
`concreteTypes`, `metadataTypes`, `functions`, `loggedTypes`,
`messagesTypes`, `configurables`, `errorCodes`, `panickingCalls`.

- The v0.71.2 compiler stamps `specVersion: "1.2"` and (with default
  `new_encoding`) `encodingVersion: "1"`. The spec document still says
  "current is 1.0" and does not document `errorCodes` (v1.1),
  `panickingCalls` (v1.2), concrete-type `aliasOf`, or configurable
  `indirect` — trust artifacts over the spec page.
- `concreteTypes[]`: `{ type, concreteTypeId, metadataTypeId?,
  typeArguments?, aliasOf? }`. `concreteTypeId` = hex
  **sha256 of the ABI type string**.
- `metadataTypes[]`: `{ type, metadataTypeId (int), components?,
  typeParameters? }` — generic declarations (`"struct Name"`,
  `"enum Name"`, `"[_; n]"` with `__array_element`, `"(_, _)"` with
  `__tuple_element`, `"generic T"`). Concrete instantiations link back via
  `metadataTypeId` + `typeArguments`.
- `functions[]`: `{ name, inputs: [{name, concreteTypeId}], output:
  concreteTypeId, attributes? }` (attributes carry `storage`, `payable`,
  `test`, `inline`, doc data).
- `loggedTypes[]`: `{ logId, concreteTypeId }`. **Log ID = decimal string
  of u64 from the first 8 big-endian bytes of sha256(type string)**; the
  same u64 is baked into LOG/LOGD's `$rB`.
- `configurables[]`: `{ name, concreteTypeId, offset, indirect }` — the
  compiler emits offset 0 and forc-pkg patches real byte offsets from the
  data section afterward; dead configurables are dropped.
- `errorCodes`: map u64 → `{ pos {function,pkg,file,line,column}, logId?,
  msg? }` for `panic` call sites.

Type-string hash preimages: primitives literal (`u64`, `b256`, ...);
`str`; `str[N]`; arrays `[{T}; N]`; tuples `({T1}, {T2})` (unit `()`);
`struct path::Name<{T}>` / `enum path::Name<{T}>`; generics `generic T` at
root. Call paths are included (leading program name stripped);
`#[abi_name]` overrides the name segment.

## Argument encoding v1 (the default)

Compact, big-endian, no padding or alignment; independent of in-memory
layout:

| Type | Encoding |
|---|---|
| `u8` | 1 byte |
| `u16` / `u32` / `u64` | 2 / 4 / 8 bytes big-endian |
| `u256`, `b256` | 32 bytes |
| `bool` | 1 byte 0/1 — decoder **reverts on any other value** |
| `()` | zero bytes |
| `[T; N]` | N element encodings concatenated |
| `str[N]` | exactly N raw UTF-8 bytes, no prefix, no padding |
| `str`, `raw_slice` | u64 BE length ++ raw bytes |
| tuple / struct | element/field encodings concatenated (declaration order) |
| enum | u64 BE discriminant (0-based declaration order) ++ variant data, no max-variant padding |
| `Vec<T>` | u64 BE length ++ item encodings |
| `Bytes` / `String` | u64 BE length ++ raw bytes |

Custom `AbiEncode`/`AbiDecode` impls may override struct rules — check
before assuming field-concatenation.

Call convention under encoding v1 — **there is no 4-byte function
selector**:

- Call frame param1 points to the **encoded method name as a `str`**
  (u64 BE length ++ UTF-8 bytes); the generated `__entry` dispatcher
  compares raw bytes against its method table.
- param2 points to the encoded argument tuple `(arg1, arg2, ...)`.
- Non-unit returns are re-encoded and returned via `RETD`; callers decode
  the return payload with the same ABI generation.
- Unknown method name: the `#[fallback]` function runs if present,
  otherwise revert with the mismatched-selector code.
- Script `main` args decode from script data; predicate `main` args from
  that input's predicate data.
- The 4-byte sha256 selector scheme (`fn-selector-encoding.md`) applies
  only to `encodingVersion: "0"` artifacts.

## Hash-derived identifiers

Seed for contract/predicate IDs: `0x4655454C` ("FUEL").

| ID | Formula |
|---|---|
| Contract ID | `sha256(0x4655454C ++ salt ++ code_root ++ state_root)` |
| Code root | binary Merkle root over bytecode in 16 KiB leaves; short final leaf zero-padded to an 8-byte multiple (not to 16 KiB) |
| State root | sparse Merkle root of initial storage slots (empty root when none) |
| Predicate owner | `sha256(0x4655454C ++ code_root(predicate_bytecode))` — no salt, no state root |
| Asset ID | `sha256(contract_id ++ sub_id)`; base asset = all zeroes |
| Blob ID | `sha256(blob_data)`; tx invalid unless it matches the witness hash |
| Transaction ID | `sha256(u64_BE(chain_id) ++ canonical tx after prepare_sign, witnesses removed entirely)` |
| UTXO ID | `(tx_id, output_index u16)` |
| Message ID | `sha256(sender ++ recipient ++ nonce ++ amount ++ data)`; nonce of an outgoing message = `sha256(tx_id ++ u16 receipt index)` |

`prepare_sign` zeroes: Script `receiptsRoot`; InputCoin
`txPointer`/`predicateGasUsed`; InputContract `utxoId`, `balanceRoot`,
`stateRoot`, `txPointer`; InputMessage `predicateGasUsed`; OutputContract
`balanceRoot`/`stateRoot`; OutputChange `amount`; OutputVariable
`to`/`amount`/`assetId`. Signatures recover to `owner == sha256(pubkey)`
over the tx hash.

## Transaction format (fuel-tx v0.66.4)

Types: Script=0, Create=1, Mint=2, Upgrade=3, Upload=4, Blob=5 — all six
exist at this version. Canonical serialization: integers big-endian
right-aligned to 8 bytes; `byte[32]` raw; byte arrays zero-padded to
8-byte alignment; wire layout = type ++ body ++ policies ++ inputs ++
outputs ++ witnesses.

- **Script**: scriptGasLimit, receiptsRoot, script, scriptData.
- **Create**: bytecodeWitnessIndex, salt, storageSlots (keys ascending);
  requires exactly one `ContractCreated` output matching the computed
  contract ID/state root.
- **Mint**: producer-only (txPointer, input/output contract, amount, asset
  ID, gasPrice); never signed.
- **Upgrade**: purpose = ConsensusParameters{witnessIndex, checksum} or
  StateTransition{bytecodeRoot}; needs a privileged-address input.
- **Upload**: root, witnessIndex, subsectionIndex/count, proofSet —
  chunked state-transition bytecode upload with Merkle reconnection.
- **Blob**: id + witnessIndex; `sha256(witness) == id` required. Blobs
  feed `LDC` mode 1 / `BSIZ` / `BLDD` — the loader-contract pattern for
  oversized bytecode.
- Create/Upgrade/Upload/Blob: base-asset inputs only, no Contract inputs,
  restricted outputs.

Inputs — wire types Coin=0, Contract=1, Message=2 (the SDK-visible
signed/predicate/data variants are API refinements):

- Coin: txID, outputIndex, owner, amount, assetId, txPointer,
  witnessIndex, predicateGasUsed, predicate, predicateData. Predicate
  spend: computed predicate root must equal `owner`.
- Contract: txID, outputIndex, balanceRoot, stateRoot, txPointer,
  contractID; must pair with exactly one OutputContract by index.
- Message: sender, recipient, amount, nonce, witnessIndex,
  predicateGasUsed, data, predicate, predicateData. Predicate root must
  equal `recipient`. Messages with data are retryable and cannot pay fees.

Outputs: Coin=0, Contract=1, Change=2 (one per asset; amount computed at
execution), Variable=3 (fully zeroed until runtime `TRO`), 
ContractCreated=4.

Policies — bitmask then set values in ascending bit order: Tip=1,
WitnessLimit=2, Maturity=4, MaxFee=8, **Expiration=16, Owner=32** (both
exist at v0.66.4). MaxFee is mandatory for non-Mint transactions;
maturity/expiration bound the inclusion window
(`maturity <= height <= expiration`); Owner is a u64 index of a
Coin/Message input.

Validity highlights: at least one spendable input (Coin, or Message with
empty data); per-asset Change uniqueness; input existence checks against
UTXO/contract/message sets; `max_gas <= MAX_GAS_PER_TX`;
`predicateGasUsed <= MAX_GAS_PER_PREDICATE` and must match actual
consumption; witness/input/output counts and total size against consensus
limits — query the target node's consensus parameters for the numbers.
