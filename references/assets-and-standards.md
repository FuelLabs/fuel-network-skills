# Native assets and standards

Verified against Sway `v0.71.2`, `sway-libs` release material and the public
Sway standards repositories as of 2026-07-23. Re-resolve implementations and
tags before adoption.

## Model assets natively

Fuel assets are first-class UTXO values rather than contract-local token
balances. An `AssetId` is derived from the issuing `ContractId` and a `SubId`.
Write the derivation and sub-asset namespace into the protocol specification;
do not assume a contract has only one asset.

For every asset-moving method, state:

- accepted asset IDs and exact/minimum/maximum amounts;
- decimal scale, rounding direction and dust behavior;
- source of truth for balance/accounting;
- recipient and change destination;
- mint, burn and supply caps;
- fee accounting and failure atomicity.

Validate `msg_asset_id()` and `msg_amount()` at payable entry points before
updating storage. Keep contract accounting reconciled with native contract
balances.

## Construct the full transaction

Provision the output shape the operation requires:

- coin outputs for fixed address transfers;
- change outputs for unused input value;
- variable outputs when dynamic transfers can create output coins;
- contract inputs and matching outputs for every contract read/call/balance
  interaction.

Do not rely on output order unless the invariant explicitly binds it. Test
extra, missing, duplicate and reordered outputs; wrong asset; zero amount;
mixed assets; maximum amount; and fee/dust edges.

Treat messages crossing domains as a schema and conservation problem. Test
field order and widths, hash construction, decimal conversion, base-asset
forwarding, fee-on-transfer behavior, finality and outstanding-message
migrations in every participating implementation.

## Separate interfaces from implementations

Use SRC standards to define interoperability; do not assume a standard
interface supplies a secure implementation. Keep the two catalogs distinct:

- `sway-standards` defines interfaces: SRC-20 native asset, SRC-3 mint/burn,
  SRC-5 ownership, SRC-7 onchain and SRC-15 offchain metadata, SRC-6 vault,
  SRC-14 upgradeable proxy, and others. An NFT is an SRC-20 asset with
  one-unit supply and zero decimals, not a separate NFT standard, and the
  reviewed catalog has no enumerability standard.
- `sway-libs` provides implementation libraries, not standards: asset,
  ownership, admin, pausable, reentrancy, upgradability and related utilities.
  Review the exact pinned implementation, configuration and audit scope.
  Verified API signatures and their fixed storage slots are in
  [sway-libs.md](sway-libs.md).

In the reviewed SRC catalog and sway-libs implementation, ownership transfer
is one-step and SRC-5 exposes only `owner()`. Prefer a two-step
initiate/accept design for high-impact ownership changes and expect to
implement it yourself.

Verify library/toolchain compatibility before adoption: the newest sway-libs
release can trail the newest compiler by several breaking Forc minors, and no
supported Sway `v0.71.x` compatibility matrix was established at the
snapshot. Select the library tag whose pinned Forc matches the project
toolchain, compile under that exact toolchain, and review upstream packaging
changes (per-library packages) before upgrading.

For proxies or external code, namespace storage, document the implementation
resolution rule, protect upgrade authority, validate code identity, and design
a rollback/migration path. An interface match does not prove layout
compatibility.

## Secure mint, burn and transfer paths

- Authorize mint/burn independently from general administration.
- Bind mint amount, sub-ID and recipient.
- Prevent supply arithmetic overflow and cap bypass across sub-assets.
- Verify burn consumes the intended native asset and reconciles stored supply.
- Avoid transferring to a contract that has no callable withdrawal path.
- Emit enough structured events/receipts to reconstruct supply and authority
  changes.
- Test pause/ownership transitions during pending operations.

Historical Fuel audits repeatedly found decimal conversion, asset accounting,
message-layout and ownership-transfer mistakes. Use those as test classes, not
as claims that the current pinned implementation remains vulnerable.
