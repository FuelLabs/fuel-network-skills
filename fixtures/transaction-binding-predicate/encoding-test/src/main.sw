library;

use std::codec::encode;

struct Order {
    output_index: u64,
    witness_index: u64,
    output_count: u16,
    recipient: Address,
    asset: AssetId,
    amount: u64,
    nonce: b256,
    expiration: u32,
}

#[test]
fn encoded_len_is_126() {
    let o = Order {
        output_index: 0,
        witness_index: 0,
        output_count: 0,
        recipient: Address::zero(),
        asset: AssetId::base(),
        amount: 0,
        nonce: b256::zero(),
        expiration: 0,
    };
    let s: raw_slice = encode(o);
    assert(s.number_of_bytes() == 126);
    // A 1-tuple adds nothing, so predicate-data bytes match either way.
    let t: raw_slice = encode((o,));
    assert(t.number_of_bytes() == 126);
}
