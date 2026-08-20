# Sway standard library

This is the compiler's built-in standard library (`sway-lib-std`), implicitly
available in every program; for the external optional sway-libs packages —
ownership, pausable, proxy, asset base — see [sway-libs.md](sway-libs.md).

Verified against `sway-lib-std/src` at Sway `v0.71.2` (commit `aa2e3b1`).
Signatures below are the new-encoding variants, which are in effect on
`v0.71.x`. Re-verify against the project's pinned tag before use; several
items changed names or return types across recent minors.

## Use the prelude boundary

Auto-imported (no `use` needed): `Address`, `SubId`, `AssetId`, `ContractId`,
`Identity`, `StorageKey`, `StorageMap`, `Vec`, `Option`, `Result`, `From`,
`Clone`, `assert`/`assert_eq`/`assert_ne`, `require`, `revert`,
`revert_with_log`, `log`, `msg_sender`, math traits, primitives/ops/codec.

Not in the prelude — import explicitly: `Bytes`, `String`, `B512`, `U128`,
`msg_amount`, `msg_asset_id`, `transfer`/`mint`/`burn`, `Hash`/`sha256`,
`StorageVec`, block/tx/input/output getters, crypto types.

There is no reentrancy module in std at this tag; the guard lives in the
external sway-libs repository.

## Authenticate callers (std::auth)

```sway
pub fn msg_sender() -> Result<Identity, AuthError>
pub fn caller_address() -> Result<Address, AuthError>
pub fn caller_addresses() -> Vec<Address>   // all input owners, NOT deduplicated
pub fn caller_is_external() -> bool
pub fn caller_contract_id() -> ContractId   // only valid for internal calls
pub fn predicate_address() -> Option<Address>
```

`msg_sender()` returns `Result`, not a bare `Identity`. For an external
caller it derives the address from transaction input owners and fails with
`AuthError::InputsNotAllOwnedBySameAddress` when coin/message inputs have
mixed owners. Handle the `Err` deliberately; `.unwrap()` makes mixed-input
transactions revert.

## Read call context (std::context, std::call_frames, std::registers)

```sway
pub fn msg_amount() -> u64                                  // context
pub fn this_balance(asset_id: AssetId) -> u64               // context
pub fn balance_of(target: ContractId, asset_id: AssetId) -> u64
pub fn msg_asset_id() -> AssetId                            // call_frames, NOT context
pub fn first_param() -> u64 / second_param() -> u64         // call_frames
pub fn called_method() -> str / called_args<T>() -> T       // call_frames
```

The current contract's ID is `ContractId::this()`. The old
`std::call_frames::contract_id()` does not exist at this tag even though some
doc comments still mention it. Gas getters are
`std::registers::global_gas()` and `std::registers::context_gas()`.

## Move native assets (std::asset)

```sway
pub fn mint(sub_id: SubId, amount: u64)                     // minted to contract
pub fn mint_to(to: Identity, sub_id: SubId, amount: u64)    // mint + transfer
pub fn burn(sub_id: SubId, amount: u64)                     // reverts if balance short
pub fn transfer(to: Identity, asset_id: AssetId, amount: u64)
```

Only these four are public; the address/contract-specific transfer helpers
are private at this tag. `transfer` reverts on zero amount, insufficient
balance, or a missing free variable output when sending to an `Address`.

## Construct core types

- `AssetId::new(contract_id, sub_id)` = sha256 of the 64-byte pair;
  `AssetId::default()` = current contract with zero sub-ID (only meaningful
  in contract context); `AssetId::base()` reads the chain's base asset at
  runtime (`GM` instruction). The old `BASE_ASSET_ID` constant is gone;
  `constants.sw` holds only `DEFAULT_SUB_ID` plus deprecated
  `ZERO_B256`/`ZERO_U256` — prefer `b256::zero()`.
- `Identity` = `Address(Address) | ContractId(ContractId)` with
  `as_address()`, `as_contract_id()`, `is_address()`, `is_contract_id()`,
  `bits()`.
- `SubId` is `pub type SubId = b256`.
- `Address`/`ContractId`/`AssetId` share `from(b256)`, `bits()`, `zero()`,
  `is_zero()`, `Hash`, `TryFrom<Bytes>`.
- `B512 { bits: [b256; 2] }`, `EvmAddress` in `std::vm::evm`.
- `AssetId` also carries chain-gated helpers (`AssetId::fuel()`,
  `AssetId::usdc()`, ...) returning `Result<Self, AssetIdError>` keyed on
  `chain_id()` — 0 testnet, 9889 mainnet.

## Read chain state (std::block, std::time)

```sway
pub fn height() -> u32                       // u32, not u64
pub fn timestamp() -> u64                    // TAI64, not UNIX
pub fn timestamp_of_block(block_height: u32) -> u64
pub fn block_header_hash(block_height: u32) -> Result<b256, BlockHashError>
pub fn chain_id() -> u64
```

Timestamps are TAI64 (`unix = tai64 - (10 + (1 << 62))`). `std::time`
provides `Time::now()`, `Time::block(height)`, `Time::unix()`,
`Time::from_tai64()/as_tai64()` and a `Duration` type — use it instead of
hand-converting.

## Inspect the transaction (std::tx, std::inputs, std::outputs)

Nearly every getter is `Option`-returning; counts are `u16`. Key signatures:

```sway
pub fn tx_type() -> Transaction              // Script|Create|Mint|Upgrade|Upload|Blob
pub fn tx_id() -> b256
pub fn script_gas_limit() -> u64             // no tx_gas_limit at this tag
pub fn tx_tip() / tx_witness_limit() / tx_max_fee() -> Option<u64>
pub fn tx_maturity() / tx_expiration() -> Option<u32>
pub fn tx_script_data<T>() -> Option<T>      // unchecked type assumption
pub fn tx_script_bytecode_hash() -> Option<b256>
pub fn tx_witnesses_count() -> u64
pub fn tx_witness_data<T>(index: u64) -> Option<T>
pub fn tx_witness_data_length(index: u64) -> Option<u64>

pub fn input_count() -> u16
pub fn input_type(index: u64) -> Option<Input>       // Input::{Coin,Contract,Message}
pub fn input_amount(index: u64) -> Option<u64>
pub fn input_coin_owner(index: u64) -> Option<Address>
pub fn input_asset_id(index: u64) -> Option<AssetId>
pub fn input_predicate_data<T>(index: u64) -> Option<T> where T: AbiDecode
pub fn input_predicate_data_length(index: u64) -> Option<u64>
pub fn input_message_sender/recipient(index: u64) -> Option<Address>
pub fn input_message_data(index: u64, offset: u64) -> Option<Bytes>
pub fn input_address(index: u64) -> Option<Address>  // coin owner or message sender

pub fn output_count() -> u16
pub fn output_type(index: u64) -> Option<Output>     // Coin|Contract|Change|Variable|ContractCreated
pub fn output_amount(index: u64) -> Option<u64>
pub fn output_asset_id(index: u64) -> Option<AssetId>
pub fn output_asset_to(index: u64) -> Option<Address>
```

Treat `None` as a distinct, testable case (wrong index, wrong variant, or
unset policy), not an error to unwrap through. The `<T>` getters do not
validate size: `input_predicate_data<T>` decodes any `Coin` or `Message`
input's data as `T` with no length check, and `tx_witness_data<T>` never
checks the actual payload length either — for a reference type it copies
the length `GTF` reports, and for a value type it reads a `T` straight out
of the witness pointer. Gate them with the matching `*_length` getter —
exactly the encoded size of `T` — before typed access to attacker-supplied
data.

## Hash and verify (std::hash, std::crypto)

```sway
pub fn sha256<T>(s: T) -> b256 where T: Hash
pub fn keccak256<T>(s: T) -> b256 where T: Hash
let mut h = Hasher::new();        // or Hasher::with_capacity(n)
value.hash(h); h.write_str(s); h.sha256() / h.keccak256()
```

`Hash` is implemented for integers, `b256`, `u256`, `bool`, `Bytes`, `str`,
`str[N]`, arrays, tuples to arity 8, `Vec<T>`, `Option<T>`, `Result<T, E>`.
Wide flat tuples beyond that lack `Hash` — nest or stream via `Hasher`.

`std::ecr` (`ec_recover`, `ec_recover_address`, `ed_verify`) is fully
deprecated at this tag. Use `std::crypto`:

```sway
pub enum Signature { Secp256k1: Secp256k1, Secp256r1: Secp256r1, Ed25519: Ed25519 }
impl From<b256> for Message                          // std::crypto::message
impl From<Bytes> for Message
impl From<B512> for Secp256k1                        // also (b256, b256), [u8; 64]
pub fn recover(self, message: Message) -> Result<PublicKey, SignatureError>
pub fn address(self, message: Message) -> Result<Address, SignatureError>
pub fn verify(self, public_key: PublicKey, message: Message) -> Result<(), SignatureError>
pub fn evm_address(self, message: Message) -> Result<EvmAddress, SignatureError>

let sig = Signature::Secp256k1(Secp256k1::from(b512));
sig.address(Message::from(digest))            // -> Result<Address, _>
```

Those methods are on `Signature` and on `Secp256k1`/`Secp256r1`, alongside
`verify_address` and `verify_evm_address`; `Ed25519` has `verify` only, and
recovery through the enum is not applicable to it. Module paths are
`std::crypto::{message::Message, secp256k1::Secp256k1,
signature::Signature}`. Also available: `PublicKey` and alt-bn128 curve ops
(`alt_bn128_add/mul/pairing_check`).

## Fail loudly (std::revert, std::assert, std::error_signals)

```sway
pub fn revert(code: u64) -> !
pub fn require<T>(condition: bool, value: T) where T: AbiEncode  // logs value, then reverts
pub fn revert_with_log<T>(value: T) where T: AbiEncode
pub fn assert(condition: bool)
pub fn assert_eq<T>(v1: T, v2: T) where T: PartialEq + AbiEncode
pub fn assert_ne<T>(v1: T, v2: T) where T: PartialEq + AbiEncode
```

Reserved revert codes (complete list at this tag):

| Constant | Code |
|---|---|
| `FAILED_REQUIRE_SIGNAL` | `0xffff_ffff_ffff_0000` |
| `FAILED_TRANSFER_TO_ADDRESS_SIGNAL` | `...0001` |
| `FAILED_ASSERT_EQ_SIGNAL` | `...0003` |
| `FAILED_ASSERT_SIGNAL` | `...0004` |
| `FAILED_ASSERT_NE_SIGNAL` | `...0005` |
| `REVERT_WITH_LOG_SIGNAL` | `...0006` |
| `REVERT_WITH_RAW_SLICE_LEN_ZST` | `...0007` |
| `REVERT_WITH_TRIVIAL_BOOL_UNWRAP` | `...0008` |
| `REVERT_WITH_TRIVIAL_ENUM_UNWRAP` | `...0009` |

(`...0002` is unassigned at this tag.) Decode these in SDK tests instead of
matching bare numbers.

## Log for indexers (std::logging)

`log<T>(value)` where `T: AbiEncode`. Under new encoding values are
ABI-encoded and emitted as `LogData` receipts carrying a log ID that the ABI
JSON maps back to the type; decode with the same ABI generation that built
the call.

## Collections and strings

- `Vec<T>`: `new`, `with_capacity(n)`, `push`, `pop() -> Option<T>`,
  `get(i) -> Option<T>`, `set`, `insert`, `remove(i) -> T`, `swap`, `len`,
  `is_empty`, `clear`, `resize`, `last()`, `iter()`.
- `Bytes`: same shape plus `split_at`, `append`, `splice`, `ptr()`,
  `are_all_zero()`; `From<b256>`, `TryFrom<Bytes> for b256`.
- `String` is ASCII-oriented: `from_ascii_str(s: str)`, `as_bytes()`,
  `as_str()`, `len()`; not a general UTF-8 type.
- `Option<T>`: `is_some`, `is_none`, `unwrap`, `unwrap_or`, `ok_or`,
  `expect`. No `map`/`and_then` at this tag. `Result<T,E>`: `is_ok`,
  `is_err`, `unwrap`, `unwrap_or`, `expect`.
- `U128` (`std::u128`) with `as_u64() -> Result<u64, U128Error>`; native
  `u256` exists as a primitive.
- Math traits: `Root::sqrt`, `Power::pow(u32)` (the `**` operator),
  `Logarithm::log(base)`, `BinaryLogarithm::log2`. `Exponent` is declared
  but has no implementations at this tag.

## Cross-domain and low-level calls

```sway
pub fn send_message(recipient: b256, msg_data: Bytes, coins: u64)       // std::message
pub fn send_typed_message<T>(recipient: b256, msg_data: T, coins: u64)
pub fn call_with_function_selector(target: ContractId, function_selector: Bytes,
    call_data: Bytes, call_params: CallParams)                          // std::low_level_call
pub struct CallParams { pub coins: u64, pub asset_id: AssetId, pub gas: u64 }
pub fn run_external(load_target: ContractId) -> !                       // std::execution
```

The new-encoding `call_with_function_selector` has no
`single_value_type_arg` parameter. `run_external` implements the SRC-14
loader/proxy pattern: it `LDC`-loads the target bytecode and jumps into it,
retaining the current contract's storage/context, and never returns.

## Encode and decode (std::codec)

`AbiEncode`/`AbiDecode` traits with `encode<T>(item) -> raw_slice` and
`abi_decode<T>(data: raw_slice) -> T`. `BufferReader::from_script_data()` /
`from_predicate_data_by_index(i)` expose raw entry-point data. Prefer typed
`tx_script_data<T>()` / `input_predicate_data<T>(i)` wrappers; drop to
`BufferReader` only for custom layouts, and treat those as audit boundaries
per [sway-authoring.md](sway-authoring.md).
