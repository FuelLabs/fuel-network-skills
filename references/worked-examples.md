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

Real predicates must bind the full transaction shape per
[transactions-and-wallets.md](transactions-and-wallets.md); use
`std::inputs`/`std::outputs` getters and return `false` on malformed data
rather than reverting where possible.

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

Add access control on `set_proxy_target`-equivalents and follow
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
