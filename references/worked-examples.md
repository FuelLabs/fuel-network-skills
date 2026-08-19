# Worked examples

Complete programs verified against the Sway `v0.71.2` repository. Sources are
CI-built examples (`examples/` workspace) or e2e-tested programs
(`test/src/e2e_vm_tests/test_programs/should_pass/`) at that tag — cited per
example. Adapt names, not structure.

## Counter contract with storage

Source: `examples/counter/src/main.sw`.

```sway
contract;

abi TestContract {
    #[storage(write)]
    fn initialize_counter(value: u64) -> u64;

    #[storage(read, write)]
    fn increment_counter(amount: u64) -> u64;
}

storage {
    counter: u64 = 0,
}

impl TestContract for Contract {
    #[storage(write)]
    fn initialize_counter(value: u64) -> u64 {
        storage.counter.write(value);
        value
    }

    #[storage(read, write)]
    fn increment_counter(amount: u64) -> u64 {
        let incremented = storage.counter.read() + amount;
        storage.counter.write(incremented);
        incremented
    }
}
```

## Native-asset contract (mint, burn, receive, transfer)

Condensed from `examples/native_asset/src/main.sw` and
`examples/liquidity_pool/src/main.sw` (both CI-built); `#[payable]` usage
follows `native_asset`.

```sway
contract;

use std::{
    asset::{burn, mint_to, transfer},
    call_frames::msg_asset_id,
    constants::DEFAULT_SUB_ID,
    context::msg_amount,
};

abi LiquidityPool {
    #[payable]
    fn deposit(recipient: Identity);
    #[payable]
    fn withdraw(recipient: Identity);
}

const ACCEPTED_ASSET: AssetId =
    AssetId::from(0x9ae5b658754e096e4d681c548daf46354495a437cc61492599e33fc64dcdc30c);

impl LiquidityPool for Contract {
    #[payable]
    fn deposit(recipient: Identity) {
        assert(msg_asset_id() == ACCEPTED_ASSET);
        assert(msg_amount() > 0);
        // Mint LP asset (this contract, default sub-ID), 2:1.
        mint_to(recipient, DEFAULT_SUB_ID, msg_amount() * 2);
    }

    #[payable]
    fn withdraw(recipient: Identity) {
        // The forwarded asset must be this contract's own LP asset.
        assert(msg_asset_id() == AssetId::default());
        assert(msg_amount() > 0);
        transfer(recipient, ACCEPTED_ASSET, msg_amount() / 2);
    }
}
```

Sending to an `Address` requires a free variable output in the transaction;
`AssetId::default()` is this contract's zero-sub-ID asset and is only
meaningful in contract context.

## Configurables

Source: `examples/configurable_constants/src/main.sw`.

```sway
configurable {
    U8: u8 = 8u8,
    BOOL: bool = true,
    ARRAY: [u32; 3] = [253u32, 254u32, 255u32],
    STR_4: str[4] = __to_str_array("fuel"),
    STRUCT: StructWithGeneric<u8> = StructWithGeneric { field_1: 8u8, field_2: 16 },
    ENUM: EnumWithGeneric<bool> = EnumWithGeneric::VariantOne(true),
}
```

Configurables read like constants in code; SDKs patch their bytecode offsets
at deploy/instantiation time, which changes bytecode identity — diff the
configurables artifact on change.

## Script calling a contract

Source: `examples/wallet_contract_caller_script/src/main.sw`.

```sway
script;

use wallet_abi::Wallet;

fn main() {
    let contract_address = 0x9299da6c73e6dc03eeabcce242bb347de3f5f56cd1c70926d76526d7ed199b8b;
    let caller = abi(Wallet, contract_address);
    caller.send_funds {
        gas: 10000,
        coins: 0,
        asset_id: b256::zero(),
    }(200, Address::from(0x9299da6c73e6dc03eeabcce242bb347de3f5f56cd1c70926d76526d7ed199b8b));
}
```

The shared `Wallet` ABI lives in a library package both the wallet contract
and this script depend on. The transaction must include the called
contract's input/output.

## Predicates

Sources: `test_programs/should_pass/language/basic_predicate/` and
`language/main_args/main_args_predicate/`.

```sway
predicate;

fn main() -> bool {
    true
}
```

```sway
predicate;

// Arguments come from the input's predicate data, ABI-decoded.
fn main(expected_a: u64, expected_b: u64) -> bool {
    expected_a + expected_b == 1337
}
```

Those two are the language shape only. Real predicates must bind the full
transaction shape — see the next example.

## Transaction-binding predicate (signed order)

Pattern skeleton, not a CI-built example: composed from the getters in
[stdlib.md](stdlib.md) and the predicate-legal opcode list in
[fuelvm-assembly.md](fuelvm-assembly.md). It binds chain, the input index
the order claims, one designated output (type, recipient, asset, amount),
the exact output count, the witness index, a nonce, and a secp256k1
signature over all of them — and it enforces that no second predicate input
claims the same output. One surface stays unpinned: the `std::crypto` module
paths (`message::Message`, `secp256k1::Secp256k1`, `signature::Signature`)
and `Message::from(b256)` are named but not signed off in
[stdlib.md](stdlib.md), so confirm them at compile time before relying on
this shape. Build the matching transaction per
[transactions-and-wallets.md](transactions-and-wallets.md); audit it against
[security-review.md](security-review.md).

```sway
predicate;

use std::b512::B512;
use std::block::chain_id;
use std::crypto::message::Message;
use std::crypto::secp256k1::Secp256k1;
use std::crypto::signature::Signature;
use std::hash::{Hash, sha256};
use std::inputs::{input_count, input_predicate_data};
use std::outputs::{
    Output, output_amount, output_asset_id, output_asset_to, output_count,
    output_type,
};
use std::tx::tx_witness_data;

// Application/version domain tag: ASCII "order.v1", zero-extended to b256.
const DOMAIN: b256 =
    0x0000000000000000000000000000000000000000000000006f726465722e7631;
// Placeholder pattern, not a real address — substitute the signer's.
const SIGNER: Address =
    Address::from(0xa11ce00000000000000000000000000000000000000000000000000000001234);

// Decoded from this input's predicate data; every field is in the digest.
struct Order {
    input_index: u64,   // the index this order claims for its own input
    output_index: u64,  // the one output that pays the recipient
    witness_index: u64,
    output_count: u16,
    recipient: Address,
    asset: AssetId,
    amount: u64,
    nonce: b256,
}

fn main(order: Order) -> bool {
    // Shape: exact output count, and the input at the claimed index must
    // carry predicate data with this same nonce (the signature below is
    // what binds the rest of the order).
    if output_count() != order.output_count {
        return false;
    }
    if let Some(mine) = input_predicate_data::<Order>(order.input_index) {
        if mine.nonce != order.nonce {
            return false;
        }
    } else {
        return false;
    }

    // Uniqueness: no other predicate input may be paid by the same output.
    let inputs = input_count().as_u64();
    let mut i = 0;
    while i < inputs {
        if i != order.input_index {
            if let Some(other) = input_predicate_data::<Order>(i) {
                if other.output_index == order.output_index {
                    return false;
                }
            }
        }
        i += 1;
    }

    // Consideration: the bound output is a Coin paying exactly this
    // recipient and asset, for at least the promised amount.
    let pays_recipient = match (
        output_type(order.output_index),
        output_asset_to(order.output_index),
        output_asset_id(order.output_index),
        output_amount(order.output_index),
    ) {
        (Some(Output::Coin), Some(to), Some(asset), Some(amount)) => {
            to == order.recipient
                && asset == order.asset
                && amount >= order.amount
        },
        _ => false,
    };
    if !pays_recipient {
        return false;
    }

    // Authorization: one witness signature over the whole committed order.
    let digest = sha256((
        DOMAIN,
        chain_id(),
        (
            order.input_index,
            order.output_index,
            order.witness_index,
            order.output_count,
        ),
        (order.recipient, order.asset, order.amount),
        order.nonce,
    ));
    match tx_witness_data::<B512>(order.witness_index) {
        Some(witness) => {
            let sig = Signature::Secp256k1(Secp256k1::from(witness));
            match sig.address(Message::from(digest)) {
                Ok(signer) => signer == SIGNER,
                Err(_) => false,
            }
        },
        None => false,
    }
}
```

Verification notes:

- Every `Option`/`Result` is consumed with `match`/`if let`; no `unwrap`,
  `assert` or `require` appears. `RVRT` is illegal in predicates, so a panic
  on missing data fails with `ContractInstructionNotAllowed` instead of
  returning `false`.
- Only predicate-legal operations appear: `GTF` getters, `GM` (`chain_id`),
  sha256 and secp256k1 recovery, ALU and jumps. No storage, no `CALL`, no
  `BHEI`/`TIME`, no `LOG`. Expiry is deliberately not checked here — bind it
  through the tx `Expiration` policy when the order needs a deadline.
- `order.input_index` is attacker-supplied data, not the running input's real
  index, and no pinned `std` getter returns that index. A spoofed index is
  self-defeating here: the input it names must carry the same nonce, and the
  uniqueness loop then reaches this input itself, sees its own
  `output_index`, and returns `false`. To check the index directly instead,
  read `GM` 0x03 (verifying-predicate index) from an `asm` block
  ([fuelvm-assembly.md](fuelvm-assembly.md)).
- The nonce only domain-separates orders. A predicate is stateless, so the
  same (order, signature) pair can be attached to another UTXO at the same
  predicate root in a different transaction. For instance-level replay
  protection, bind `tx_id()` or the input's UTXO ID (`GTF` txId `0x201` plus
  outputIndex `0x202`, [fuelvm-assembly.md](fuelvm-assembly.md)) into the
  digest, or fund exactly one UTXO per predicate root.
- The digest keeps outer tuple arity at 5 and nests the rest: `Hash` stops at
  arity 8, so nest or stream through `Hasher` rather than flattening
  ([stdlib.md](stdlib.md)).
- The signer's own inputs are not netted out here. When the recipient can
  supply inputs to the same transaction, bind net gain (outputs minus that
  party's matching inputs), not the gross output amount.
- The predicate owner is `sha256(0x4655454C ++ code_root)`, so any edit —
  including a changed `SIGNER` or `DOMAIN` constant — changes the address
  that must own the coin ([abi-and-encoding.md](abi-and-encoding.md)).

## SRC-14-style proxy via run_external

Source: `examples/upgradeable_proxy/` (CI-built). The original example
carries a `#[namespace(...)]` attribute that is unknown (inert, warning-only)
at `v0.71.2` — use an in-block storage namespace instead, as below:

```sway
contract;

use std::execution::run_external;

abi Proxy {
    #[storage(write)]
    fn set_target_contract(id: ContractId);

    #[storage(read)]
    fn double_input(_value: u64) -> u64;
}

storage {
    my_storage_namespace {
        target_contract: Option<ContractId> = None,
    }
}

impl Proxy for Contract {
    #[storage(write)]
    fn set_target_contract(id: ContractId) {
        storage::my_storage_namespace.target_contract.write(Some(id));
    }

    #[storage(read)]
    fn double_input(_value: u64) -> u64 {
        let target = storage::my_storage_namespace.target_contract.read().unwrap();
        run_external(target) // never returns; target runs in this context
    }
}
```

Add access control on `set_target_contract` and follow
[src-interfaces.md](src-interfaces.md) for the standard slot/interface.

## In-language unit tests

Sources: `docs/book/src/testing/unit-testing.md` at the tag and
`examples/multi_contract_calls/`.

```sway
#[test]
fn test_meaning_of_life() {
    assert_eq(6 * 7, 42);
}

#[test(should_revert)]
fn test_fails() {
    assert_eq(6 * 6, 42);
}

#[test(should_revert = "18446744073709486084")] // FAILED_ASSERT_SIGNAL
fn test_fails_with_code() {
    assert_eq(6 * 6, 42);
}

// Contract methods: call through the injected CONTRACT_ID.
#[test]
fn test_contract_call() {
    let caller = abi(MyContract, CONTRACT_ID);
    assert(caller.test_function {}());
}

// External contracts: declare in [contract-dependencies], then use
// <dep_name>::CONTRACT_ID.
#[test]
fn test_multi_contract_calls() {
    let caller = abi(CallerContract, CONTRACT_ID);
    let callee = abi(CalleeContract, callee::CONTRACT_ID);
    assert(!caller.test_false());
    assert(callee.test_true());
}
```

Matching manifest for the multi-contract test
(`examples/multi_contract_calls/caller/Forc.toml`):

```toml
[project]
entry = "main.sw"
license = "Apache-2.0"
name = "caller"

[contract-dependencies]
callee = { path = "../callee" }
```

`forc test` builds twice (once without tests to fix `CONTRACT_ID`); each test
gets isolated storage; run `forc test --logs --reverts` to decode output. Run
the release profile too before shipping
([testing-and-debugging.md](testing-and-debugging.md)).
