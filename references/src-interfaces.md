# SRC interface signatures

Verified against a local `FuelLabs/sway-standards` checkout, commit `01f3d2f`
(2026-07-13), package version `0.8.2`. Interfaces are stable by design, but
re-check the pinned tag before implementation, and check library/compiler
compatibility per [assets-and-standards.md](assets-and-standards.md). Use this
module for exact signatures; use assets-and-standards for design and security
policy.

## Catalog

Code standards (importable packages under `standards/`): SRC-3, SRC-5, SRC-6,
SRC-7, SRC-10, SRC-11, SRC-12, SRC-14, SRC-15, SRC-16, SRC-17, SRC-20.
Documentation-only standards (no package): SRC-2 inline documentation, SRC-8
bridged-asset metadata, SRC-9 metadata keys, SRC-13 soulbound address.

Add a standard as a dependency and import it:

```sh
forc add src20
```

```sway
use src20::SRC20;
```

## SRC-20 native asset

```sway
abi SRC20 {
    #[storage(read)]
    fn total_assets() -> u64;
    #[storage(read)]
    fn total_supply(asset: AssetId) -> Option<u64>;
    #[storage(read)]
    fn name(asset: AssetId) -> Option<String>;
    #[storage(read)]
    fn symbol(asset: AssetId) -> Option<String>;
    #[storage(read)]
    fn decimals(asset: AssetId) -> Option<u8>;
}
```

Return `None` for assets the contract did not issue. `total_assets` counts
distinct sub-assets minted by the contract. An NFT is an SRC-20 asset with
`total_supply == 1` and `decimals == 0`; there is no separate NFT or
enumerability standard.

Events (each with a `new(...)` constructor and `.log()` method):
`SetNameEvent { asset, name: Option<String>, sender }`,
`SetSymbolEvent { asset, symbol: Option<String>, sender }`,
`SetDecimalsEvent { asset, decimals: u8, sender }`,
`TotalSupplyEvent { asset, supply: u64, sender }`. Emit the matching event on
every set/mint/burn so indexers can reconstruct supply.

## SRC-3 mint and burn

```sway
abi SRC3 {
    #[storage(read, write)]
    fn mint(recipient: Identity, sub_id: Option<SubId>, amount: u64);

    #[payable]
    #[storage(read, write)]
    fn burn(sub_id: SubId, amount: u64);
}
```

`burn` is `#[payable]`: the caller forwards the asset to burn with the call.
Validate `msg_asset_id()` matches the derived asset for `sub_id` and
`msg_amount() == amount` before burning, and reconcile stored supply.

## SRC-5 ownership

```sway
pub enum State {
    Uninitialized: (),
    Initialized: Identity,
    Revoked: (),
}

abi SRC5 {
    #[storage(read)]
    fn owner() -> State;
}
```

`State` provides `is_uninitialized()`, `is_initialized()`, `is_revoked()`,
`owner() -> Option<Identity>`, plus `AccessError::NotOwner` for reverts. The
standard exposes only the read side; transfer/renounce mechanics are
implementation-defined and one-step in sway-libs — add two-step transfer
yourself for high-impact ownership.

## SRC-6 vault

```sway
abi SRC6 {
    #[payable]
    #[storage(read, write)]
    fn deposit(receiver: Identity, vault_sub_id: SubId) -> u64;

    #[payable]
    #[storage(read, write)]
    fn withdraw(receiver: Identity, underlying_asset: AssetId, vault_sub_id: SubId) -> u64;

    #[storage(read)]
    fn managed_assets(underlying_asset: AssetId, vault_sub_id: SubId) -> u64;

    #[storage(read)]
    fn max_depositable(receiver: Identity, underlying_asset: AssetId, vault_sub_id: SubId) -> Option<u64>;

    #[storage(read)]
    fn max_withdrawable(underlying_asset: AssetId, vault_sub_id: SubId) -> Option<u64>;
}
```

`deposit` receives the underlying asset and returns minted shares; `withdraw`
receives share tokens and returns the withdrawn amount. Events:
`Deposit { caller, receiver, underlying_asset, vault_sub_id, deposited_amount, minted_shares }`
and `Withdraw { caller, receiver, underlying_asset, vault_sub_id, withdrawn_amount, burned_shares }`.

## SRC-7 / SRC-15 asset metadata

```sway
pub enum Metadata {
    B256: b256,
    Bytes: Bytes,
    Int: u64,
    String: String,
}

abi SRC7 {
    #[storage(read)]
    fn metadata(asset: AssetId, key: String) -> Option<Metadata>;
}
```

SRC-7 is onchain (queryable by other contracts); event:
`SetMetadataEvent { asset, metadata: Option<Metadata>, key, sender }`.
SRC-9 (documentation-only) standardizes the key strings used with SRC-7.

SRC-15 is offchain/stateless: no ABI, only events reusing SRC-7's `Metadata`:
`SRC15MetadataEvent { asset, metadata }` and
`SRC15GlobalMetadataEvent { metadata }`. Use it when only indexers need the
metadata.

## SRC-14 upgradeable proxy

```sway
abi SRC14 {
    #[storage(read, write)]
    fn set_proxy_target(new_target: ContractId);

    #[storage(read)]
    fn proxy_target() -> Option<ContractId>;
}

abi SRC14Extension {
    #[storage(read)]
    fn proxy_owner() -> State; // src5::State
}

pub const SRC14_TARGET_STORAGE: b256 =
    0x7bb458adc1d118713319a5baa00a2d049dd64d2916477d2688d76970c898cd55;
```

Store the target at `SRC14_TARGET_STORAGE` (sha256 of `"storage_SRC14_0"`) and
keep proxy-specific state in a dedicated storage namespace so target-contract
layouts cannot collide with it.

## SRC-12 contract factory

```sway
pub type BytecodeRoot = b256;
pub type ContractConfigurables = Vec<(u64, Vec<u8>)>; // (offset, bytes)

abi SRC12 {
    #[storage(read, write)]
    fn register_contract(child_contract: ContractId, configurables: Option<ContractConfigurables>) -> Result<BytecodeRoot, str>;

    #[storage(read)]
    fn is_valid(child_contract: ContractId) -> bool;

    #[storage(read)]
    fn factory_bytecode_root() -> Option<BytecodeRoot>;
}

abi SRC12_Extension {
    #[storage(read)]
    fn get_contract_id(configurables: Option<ContractConfigurables>) -> Option<ContractId>;
}
```

## SRC-11 security information

```sway
abi SRC11 {
    #[storage(read)]
    fn security_information() -> SecurityInformation;
}
```

`SecurityInformation` fields: `name: String`, `project_url: Option<String>`,
`contact_information: Vec<String>`, `policy: String`,
`preferred_languages: Option<Vec<String>>`, `encryption: Option<String>`,
`source_code: Option<String>`, `source_release: Option<String>`,
`source_revision: Option<String>`, `auditors: Option<Vec<String>>`,
`acknowledgments: Option<String>`, `additional_information: Option<String>`.

## SRC-10 native bridge

```sway
abi SRC10 {
    #[storage(read, write)]
    fn process_message(message_index: u64);

    #[storage(read, write)]
    fn withdraw(to_address: b256);

    #[storage(read, write)]
    fn claim_refund(to_address: b256, token_address: b256, token_id: b256, gateway_contract: b256);
}
```

Message schemas: `DepositMessage { amount: b256, from: b256, to: Identity,
token_address: b256, token_id: b256, decimals: u8, deposit_type }` with
`DepositType::{Address, Contract, ContractWithData}`, and
`MetadataMessage { token_address, token_id, name: String, symbol: String }`.

## SRC-16 typed structured data

EIP-712-analogous signing domains. `SRC16Domain` fields (all optional, hashed
only when present): `name`, `version`, `chain_id: u256`,
`verifying_contract: ContractId`, `salt: b256`. Encoding follows
`\x19\x01 ++ domain_hash ++ struct_hash` with Keccak256.

```sway
abi SRC16 {
    fn domain_separator_hash(encoding: Encoding) -> b256;
    fn data_type_hash(encoding: Encoding) -> b256;
    fn domain_separator(encoding: Encoding) -> Domain;
}
```

## SRC-17 naming verification

```sway
abi SRC17 {
    #[storage(read)]
    fn verify(proof: SRC17Proof, name: String, resolver: Identity, asset: AssetId, metadata: Option<Bytes>) -> Result<(), SRC17VerificationError>;
}
```

`SRC17Proof` is `AltBn128Proof([u8; 288])` or `SparseMerkleProof`; ownership of
a name is represented by an asset.
