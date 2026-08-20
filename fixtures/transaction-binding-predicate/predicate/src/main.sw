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
        // output, and a `Change` output carrying this coin's own asset is
        // REQUIRED to exist and to roll back to this predicate root. Only
        // validating such an output when one happens to be present would be
        // vacuous: an assembler could drop it and burn the remainder, or
        // spend an input in some other asset and hand the remainder slot to
        // that asset's change instead. The VM allows at most one `Change`
        // per asset and credits it the whole per-asset remainder, so "own
        // asset change exists and is owned by this root" pins the leftover.
        // A fee payer's change in a *different* asset is that payer's own
        // and may go anywhere.
        let my_asset = input_asset_id(my_index);
        let outputs = output_count().as_u64();
        let mut own_change_seen = false;
        let mut j = 0;
        while j < outputs {
            if j != order.output_index {
                match output_type(j) {
                    Some(Output::Change) => {
                        if output_asset_id(j) == my_asset {
                            if output_asset_to(j) != my_owner {
                                return false;
                            }
                            own_change_seen = true;
                        }
                    },
                    _ => return false,
                }
            }
            j += 1;
        }
        if !own_change_seen {
            return false;
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
