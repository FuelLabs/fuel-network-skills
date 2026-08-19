# Worked examples

Complete programs verified against the Sway `v0.71.2` repository. Every example
below except the transaction-binding predicate is taken from a CI-built example
(`examples/` workspace) or an e2e-tested program
(`test/src/e2e_vm_tests/test_programs/should_pass/`) at that tag — cited per
example. The transaction-binding predicate is composed here rather than sourced
upstream, and is instead backed by the fixture checked in at
[`fixtures/transaction-binding-predicate/`](../fixtures/transaction-binding-predicate/):
its source compiles under the pinned toolchain, a `forc test` project pins the
`Order` encoding length, and an optional local-node harness replays the
runtime matrix. Adapt names, not structure.

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

Composed from the getters in [stdlib.md](stdlib.md) and the
predicate-legal opcode list in [fuelvm-assembly.md](fuelvm-assembly.md).
It binds chain, the UTXO this predicate is spending, one designated output
(type, recipient, asset, amount), the exact output count, the witness
index, a nonce, an expiration matched against the transaction's
`Expiration` policy, and a secp256k1 signature over all of them — and it
enforces that no second input at the same predicate root is paid by the
same output. It binds the remainder too: every output other than the
designated one must be a `Change` output, and the `Change` output
carrying this coin's own asset must return to the predicate root, so the
signature authorizes paying the consideration rather than draining the
coin. The block below is byte-identical to a source file that compiles
clean under the pinned toolchain (`forc build --release` with
`forc 0.71.2`, no warnings). It was also executed against a local
fuel-core 0.47.1 through fuels-ts `v0.103.0`, with only the `SIGNER`
placeholder substituted for a test key's address and every other byte
unchanged: a fully signed spend was accepted and paid the recipient.
Truncated, oversized and garbage predicate data, a missing or off-by-one
`Expiration` policy, a non-`SIGNER` signature, a wrong-recipient output,
a wrong output count, a 65-byte witness, a remainder output retyped from
`Change` to a `Coin` paying an attacker, a `Change` remainder redirected
to an attacker address, a duplicated consideration output (two same-root
inputs claiming one output) and cross-UTXO replay of a previously valid
(order, signature) pair were each rejected as a clean predicate `false`
(`PredicateReturnedNonOne`), not a VM fault. The `std::crypto` module
paths (`message::Message`, `secp256k1::Secp256k1`,
`signature::Signature`) and the constructors used here are pinned in
[stdlib.md](stdlib.md), verified against the tag. Build the matching
transaction per [transactions-and-wallets.md](transactions-and-wallets.md);
audit it against [security-review.md](security-review.md). Every claim in this
paragraph is reproducible from
[`fixtures/transaction-binding-predicate/`](../fixtures/transaction-binding-predicate/),
which holds that source file, the encoding-length test and the local-node
harness.

```sway
predicate;

use std::b512::B512;
use std::block::chain_id;
use std::crypto::message::Message;
use std::crypto::secp256k1::Secp256k1;
use std::crypto::signature::Signature;
use std::hash::{Hash, sha256};
use std::inputs::{
    Input, input_asset_id, input_coin_owner, input_count,
    input_predicate_data, input_predicate_data_length, input_type,
};
use std::outputs::{
    Output, output_amount, output_asset_id, output_asset_to, output_count,
    output_type,
};
use std::tx::{tx_expiration, tx_witness_data, tx_witness_data_length};

// Application/version domain tag: ASCII "order.v1", zero-extended to b256.
const DOMAIN: b256 =
    0x0000000000000000000000000000000000000000000000006f726465722e7631;
// Placeholder pattern, not a real address — substitute the signer's.
const SIGNER: Address =
    Address::from(0xa11ce00000000000000000000000000000000000000000000000000000001234);

// Decoded from this input's predicate data; every field is in the digest.
struct Order {
    output_index: u64,  // the one output that pays the recipient
    witness_index: u64,
    output_count: u16,
    recipient: Address,
    asset: AssetId,
    amount: u64,
    nonce: b256,
    expiration: u32,    // must equal the tx `Expiration` policy
}

// Encoding-v1 byte length of `Order`: 8 + 8 + 2 + 32 + 32 + 8 + 32 + 4.
// Re-derive this from abi-and-encoding.md if any field is added,
// removed, reordered or retyped — the length gates below depend on it.
const ORDER_ENCODED_LEN: u64 = 126;

// No parameters: a typed `main` argument would be ABI-decoded by the
// compiler-generated predicate entry before the first line below runs.
fn main() -> bool {
    // Ground truth, not attacker data: GM 0x03 is the index of the input
    // currently being verified (fuelvm-assembly.md). This is the same read
    // `std::auth::predicate_address()` performs at this tag.
    let my_index = asm(r1) {
        gm r1 i3;
        r1: u64
    };

    // Gate this input before anything is decoded from it: it must be a
    // Coin, and its predicate data must be exactly one encoded `Order`.
    match input_type(my_index) {
        Some(Input::Coin) => {},
        _ => return false,
    }
    if input_predicate_data_length(my_index) != Some(ORDER_ENCODED_LEN) {
        return false;
    }
    if let Some(order) = input_predicate_data::<Order>(my_index) {
        // Bind the actual coin this predicate is spending, by UTXO ID:
        // GTF txId 0x201 and outputIndex 0x202 (fuelvm-assembly.md). No std
        // getter returns these at this tag, so read them with `__gtf`.
        let utxo_txid = __gtf::<b256>(my_index, 0x201);
        let utxo_oidx = __gtf::<u64>(my_index, 0x202);

        // Shape: the signed order fixes the exact output count.
        if output_count() != order.output_count {
            return false;
        }

        // Deadline: the transaction must carry exactly the signed
        // `Expiration` policy, which the digest below also commits to. A
        // policy chosen only by the builder is unsigned, so a relayer could
        // drop or extend it; requiring the signed value here cannot be.
        if tx_expiration() != Some(order.expiration) {
            return false;
        }

        // Uniqueness: no other input at this same predicate root may be paid
        // by the same output. Only inputs that share this input's owner (the
        // predicate root) and carry an exactly `Order`-sized predicate data
        // are decoded — an ordinary signed fee coin is never ABI-decoded.
        let my_owner = input_coin_owner(my_index);
        let inputs = input_count().as_u64();
        let mut i = 0;
        while i < inputs {
            if i != my_index {
                if input_coin_owner(i) == my_owner
                    && input_predicate_data_length(i) == Some(ORDER_ENCODED_LEN)
                {
                    if let Some(other) = input_predicate_data::<Order>(i) {
                        if other.output_index == order.output_index {
                            return false;
                        }
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

        // Remainder: the signature authorizes paying the consideration, not
        // draining the coin. Every other output must therefore be a `Change`
        // output, and the change carrying this coin's own asset must roll
        // back to this predicate root — the VM allows at most one `Change`
        // per asset and credits it the whole per-asset remainder, so this
        // pins the leftover. A fee payer's change in a *different* asset is
        // that payer's own and may go anywhere.
        let my_asset = input_asset_id(my_index);
        let outputs = output_count().as_u64();
        let mut j = 0;
        while j < outputs {
            if j != order.output_index {
                match output_type(j) {
                    Some(Output::Change) => {
                        if output_asset_id(j) == my_asset
                            && output_asset_to(j) != my_owner
                        {
                            return false;
                        }
                    },
                    _ => return false,
                }
            }
            j += 1;
        }

        // Authorization: one witness signature over the whole committed
        // order, including the UTXO this predicate is spending. Length-gate
        // the witness to exactly 64 bytes — for a reference type such as
        // `B512`, `tx_witness_data` copies the GTF-reported length and
        // reinterprets it, with no check against the requested type.
        let digest = sha256((
            DOMAIN,
            chain_id(),
            (utxo_txid, utxo_oidx),
            (order.output_index, order.witness_index, order.output_count),
            (order.recipient, order.asset, order.amount),
            order.nonce,
            order.expiration,
        ));
        if tx_witness_data_length(order.witness_index) != Some(64) {
            return false;
        }
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
    } else {
        false
    }
}
```

Verification notes:

- Every `Option`/`Result` is consumed with `match`/`if let`; no `unwrap`,
  `assert` or `require` appears. `RVRT` is illegal in predicates, so a panic
  on missing data fails with `ContractInstructionNotAllowed` instead of
  returning `false`.
- Only predicate-legal operations appear: `GTF` getters (via `std` and via
  the `__gtf` intrinsic), `GM` (`chain_id`, and `GM 0x03` in the one `asm`
  block), sha256 and secp256k1 recovery, ALU and jumps. No storage, no
  `CALL`, no `BHEI`/`TIME`, no `LOG`.
- `main` deliberately takes no parameters. A typed `main` parameter is not
  free input: the compiler-generated predicate entry calls
  `decode_predicate_data::<(Order,)>()` and passes the result in, so the
  decode happens before the first statement of `main` and no gate written
  there can precede it. Truncated or malformed predicate data would reach
  the unchecked decoder first. With zero parameters the entry decodes
  nothing, so every `input_predicate_data::<Order>` call in the body sits
  behind a length gate that can reject the payload before it is decoded.
- Every decode in this predicate is length-gated first. This input's
  predicate data must measure exactly `ORDER_ENCODED_LEN` before it is
  decoded as an `Order`, and the witness must measure exactly 64 bytes
  before it is read as a `B512`: `input_predicate_data` blind-decodes any
  Coin or Message input, and `tx_witness_data` does not validate the
  witness against the requested type ([stdlib.md](stdlib.md)). Same-root
  filtering in the uniqueness loop (`input_coin_owner(i) ==
  input_coin_owner(my_index)`) keeps unrelated signed coins — the fee
  inputs, above all — from ever being ABI-decoded.
- The deadline is enforced from both sides: `order.expiration` is part of
  the signed digest, and `tx_expiration() != Some(order.expiration)` fails
  the predicate. Binding only one side is not enough — a policy the builder
  sets but the signature does not cover is attacker-removable, since the
  custom order signature authenticates its own digest rather than the
  transaction ID, so a relayer could resubmit the still-unspent order with
  the `Expiration` policy dropped or extended.
- Replay across UTXOs is closed by the digest, which binds this input's own
  UTXO ID (`GTF` txId `0x201` plus outputIndex `0x202`). The same (order,
  signature) pair attached to a different coin at the same predicate root
  recovers a different signer and fails. The nonce is application-level order
  identity — how the signer distinguishes two otherwise identical orders —
  not the replay defence.
- The digest keeps outer tuple arity at 7 and nests the rest: `Hash` stops at
  arity 8, so nest or stream through `Hasher` rather than flattening
  ([stdlib.md](stdlib.md)).
- Value-flow model: this is a payout/escrow-shaped order with a protected
  remainder. The signature authorizes paying the bound consideration out of
  the bound UTXO and nothing else, so every non-consideration output must be
  a `Change` output and the change for this coin's own asset must roll back
  to the predicate root. The VM permits at most one `Change` output per asset
  and credits it the entire per-asset remainder, so pinning that one output
  pins everything the consideration did not spend. Change in a *different*
  asset is left free because it is the fee payer's own value. Structural
  consequence: when the order's asset is the base asset, a third party cannot
  fee-fund the transaction and also take its own base-asset change — the one
  permitted base-asset `Change` output is already committed to the predicate
  root — so in that case the predicate coin funds its own fee.
- The full-UTXO maker order is the deliberate relaxation: drop the remainder
  loop and the signature then authorizes spending the *entire* fixed UTXO in
  exchange for the bound minimum consideration, leaving the surplus to
  whoever assembles the transaction. That is a legitimate design, but a
  different one, and under it the net-gain caveat below is no longer a side
  note — it becomes the operative model, because the amount bound on the
  consideration output is then the only thing protecting the signer.
- The signer's own inputs are not netted out here: the consideration check
  bounds a gross output amount. When the recipient can supply inputs to the
  same transaction, bind net gain (outputs minus that party's matching
  inputs), not the gross output amount.
- Predicate estimation is not acceptance. `estimatePredicates` — and the
  estimation `assembleTx` performs — meters gas for a predicate that
  returns `false` exactly as it does for one that returns `true`: on
  fuel-core 0.47.1 deliberately failing predicates still estimated
  successfully. Only dry run and submission enforce the predicate, so a
  passing `estimatePredicates` must never be read as "the predicate
  accepts"; [transactions-and-wallets.md](transactions-and-wallets.md)
  shows the signed dry-run gate that does decide it.
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
