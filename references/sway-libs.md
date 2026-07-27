# sway-libs implementation libraries

Verified against a local `FuelLabs/sway-libs` checkout, commit `4908619`
(2025-11-20), per-library packages `0.26.1`-`0.27.0` depending on
`sway-standards 0.8.2`. Its CI pins forc `0.70.2` + fuel-core `0.47.1` — the
live network toolchain, one minor behind this skill's `v0.71.2` reference
baseline. Select the library tag whose pinned forc matches the project
toolchain per [assets-and-standards.md](assets-and-standards.md); these are
audited-scope implementations, not standards — the interfaces live in
[src-interfaces.md](src-interfaces.md).

Each library is its own package (`forc add ownership`) imported by package
name (`use ownership::only_owner;`). Two storage conventions coexist:

- **Fixed hardcoded slots** (ownership, pausable, admin, upgradability):
  state lives at constant `b256` keys *outside* the contract's `storage {}`
  block. These bypass the compiler's key derivation and namespace salting —
  treat each as a reviewed custom slot per [storage.md](storage.md), and
  never let a proxy target's own layout collide with them.
- **Caller-owned StorageKeys** (asset): you declare the fields in your
  `storage {}` block and pass `storage.field` handles in.

## ownership

State at fixed slot `0x4c1029697ee358715d3a14a2add817c4b01651440de808371f78165ac90dc581`,
typed as `src5::State`.

```sway
#[storage(read)]        pub fn _owner() -> State
#[storage(read)]        pub fn only_owner()                       // reverts AccessError::NotOwner
#[storage(read, write)] pub fn initialize_ownership(new_owner: Identity)
#[storage(read, write)] pub fn transfer_ownership(new_owner: Identity)
#[storage(read, write)] pub fn renounce_ownership()               // sets State::Revoked
```

Events: `OwnershipSet`, `OwnershipTransferred`, `OwnershipRenounced`.
`initialize_ownership` reverts on re-initialization
(`InitializationError::CannotReinitialized`) — but nothing calls it for you;
an unprotected initializer entry point is still an ownership-takeover path.
Transfer is one-step and immediate; add two-step transfer yourself for
high-impact ownership. `only_owner` unwraps `msg_sender()`, so
mixed-input-owner transactions revert rather than fail closed.

## admin

Admins stored individually at `sha256(("admin", identity.bits()))`; requires
the ownership library (mutations are `only_owner`-gated).

```sway
#[storage(read, write)] pub fn add_admin(new_admin: Identity)
#[storage(read, write)] pub fn revoke_admin(old_admin: Identity)
#[storage(read)]        pub fn is_admin(admin: Identity) -> bool
#[storage(read)]        pub fn only_admin()                       // AdminError::NotAdmin
#[storage(read)]        pub fn only_owner_or_admin()
```

## pausable

Flag at fixed slot `0xd987cda398e9af257cbcf8a8995c5dccb19833cadc727ba56b0fec60ccf8944c`.
Ships a standard `abi Pausable { pause(); unpause(); is_paused() }` plus the
internals:

```sway
#[storage(write)] pub fn _pause() / _unpause()
#[storage(read)]  pub fn _is_paused() -> bool
#[storage(read)]  pub fn require_paused()       // PauseError::NotPaused
#[storage(read)]  pub fn require_not_paused()   // PauseError::Paused
```

The library provides no access control — gate `pause`/`unpause` with
ownership/admin yourself, and specify the pause operation matrix per
[security-review.md](security-review.md).

## reentrancy

No storage: `is_reentrant()` walks saved call frames comparing each caller's
contract ID against `ContractId::this()`, so it detects reentry through any
intermediate contract chain.

```sway
pub fn reentrancy_guard()      // reverts ReentrancyError::NonReentrant
pub fn is_reentrant() -> bool
```

Cross-contract reentrancy via a *different* vulnerable contract is out of
scope — checks-effects-interactions still applies.

## asset (SRC-20/3/7 base implementations)

Caller declares storage and passes handles; functions enforce the standard's
invariants and derive the asset from `ContractId::this()`:

```sway
storage {
    total_assets: u64 = 0,
    total_supply: StorageMap<AssetId, u64> = StorageMap {},
    name: StorageMap<AssetId, StorageString> = StorageMap {},
    symbol: StorageMap<AssetId, StorageString> = StorageMap {},
    decimals: StorageMap<AssetId, u8> = StorageMap {},
    metadata: StorageMetadata = StorageMetadata {},
}

// base.sw — SRC-20 getters/setters
pub fn _total_assets(total_assets_key: StorageKey<u64>) -> u64
pub fn _total_supply(total_supply_key: StorageKey<StorageMap<AssetId, u64>>, asset: AssetId) -> Option<u64>
pub fn _name(...) -> Option<String> / _symbol(...) -> Option<String> / _decimals(...) -> Option<u8>
pub fn _set_name(name_key, asset: AssetId, name: String)     // rejects empty strings
pub fn _set_symbol(...) / _set_decimals(...)

// supply.sw — SRC-3
pub fn _mint(total_assets_key, total_supply_key, recipient: Identity, sub_id: SubId, amount: u64) -> AssetId
pub fn _burn(total_supply_key, sub_id: SubId, amount: u64)   // both reject zero amounts

// metadata.sw — SRC-7, via the StorageMetadata marker type
pub fn _set_metadata(metadata_key: StorageKey<StorageMetadata>, asset: AssetId, key: String, metadata: Metadata)
pub fn _metadata(metadata_key, asset: AssetId, key: String) -> Option<Metadata>
```

The wrappers emit the standard events for you (`TotalSupplyEvent` on
mint/burn, `SetNameEvent`/`SetSymbolEvent`/`SetDecimalsEvent`/
`SetMetadataEvent` on setters) but do not authorize callers — add access
control at your ABI layer, and keep `_burn` behind a `#[payable]` method
that validates the forwarded asset and amount.

## upgradability (SRC-14 internals)

Target at `src14::SRC14_TARGET_STORAGE`; proxy owner at
`PROXY_OWNER_STORAGE = sha256("storage_SRC14_1")` =
`0xbb79927b15d9259ea316f2ecb2297d6cc8851888a98278c0a2e03e1a091ea754`.

```sway
#[storage(read)]        pub fn _proxy_target() -> Option<ContractId>
#[storage(write)]       pub fn _set_proxy_target(new_target: ContractId)
#[storage(read)]        pub fn _proxy_owner() -> State
#[storage(read)]        pub fn only_proxy_owner()
#[storage(write)]       pub fn _set_proxy_owner(new_proxy_owner: State)
```

Pair with `std::execution::run_external` for the loader pattern
([worked-examples.md](worked-examples.md)); proxy ownership here is separate
state from the ownership library's slot.

## bytecode (roots, configurables, SRC-12 support)

```sway
pub type BytecodeRoot = b256;
pub type ContractConfigurables = Vec<(u64, Vec<u8>)>;   // (offset, bytes)

pub fn compute_bytecode_root(ref mut bytecode: Vec<u8>, configurables: Option<ContractConfigurables>) -> BytecodeRoot
pub fn compute_predicate_address(ref mut bytecode: Vec<u8>, configurables: Option<ContractConfigurables>) -> Address
pub fn predicate_address_from_root(bytecode_root: BytecodeRoot) -> Address
pub fn swap_configurables(ref mut bytecode: Vec<u8>, configurables: ContractConfigurables)
pub fn verify_contract_bytecode(contract_id: ContractId, ref mut bytecode: Vec<u8>, configurables: Option<ContractConfigurables>)  // reverts on mismatch
pub fn verify_predicate_address(predicate_id: Address, ref mut bytecode: Vec<u8>, configurables: Option<ContractConfigurables>)
```

`ref mut` is real: configurable swapping mutates the passed bytecode buffer.
Roots/addresses follow the derivations in
[abi-and-encoding.md](abi-and-encoding.md); this is the machinery SRC-12
factories use to validate child contracts.

## merkle

Binary tree (`merkle::binary`):

```sway
pub type ProofSet = Vec<b256>;  pub type MerkleRoot = b256;
pub fn leaf_digest(data: b256) -> b256
pub fn node_digest(left: b256, right: b256) -> b256
pub fn process_proof(key: u64, merkle_leaf: b256, num_leaves: u64, proof: ProofSet) -> MerkleRoot
pub fn verify_proof(key: u64, merkle_leaf: b256, merkle_root: MerkleRoot, num_leaves: u64, proof: ProofSet) -> bool
```

Sparse tree (`merkle::sparse`, used by SRC-17): `MerkleTreeKey = b256`;
`InclusionProof` with `verify(root, key, leaf_data)`/`verify_hash`,
`root(...)`/`root_from_hash(...)`; `ExclusionProof`/`ExclusionLeaf` for
non-membership. Leaf/node digests are domain-separated — do not substitute
plain `sha256` when reproducing roots off-chain.

## queue, signed_int, big_int

- `Queue<T>`: `new`, `enqueue`, `dequeue() -> Option<T>`, `peek()`, `len`,
  `is_empty` — heap-backed FIFO; unbounded growth cautions from
  [performance.md](performance.md) apply.
- `signed_int`: `I8`-`I256` two's-complement-style wrappers over unsigned
  primitives with checked ops and error enums; Sway itself has no signed
  primitives ([sway-language.md](sway-language.md)).
- `big_int`: `BigUint` arbitrary-precision unsigned integer.
