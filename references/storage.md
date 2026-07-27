# Contract storage

Verified against Sway `v0.71.2` compiler and std sources. Defaults at this
tag: `dynamic_storage` **off** (classic 32-byte-slot "quads" model, documented
here), `new_hashing` **on**. Re-verify on other tags; dynamic storage changes
APIs, purity attributes and key layouts.

## Declare storage

Contracts only; scripts, predicates and libraries cannot declare or touch
storage. Every field needs a const-evaluable initializer:

```sway
storage {
    var1: u64 = 1,
    var2: b256 = b256::zero(),
    owner: Option<Identity> = None,
    // custom slot: the `in` key replaces the derived slot entirely
    pinned in 0xcecf0a910789de762c699a85a66835df1662df633238cbb25804b7f78640747b: u64 = 2,
    // namespaces nest arbitrarily and salt the derived key
    ns1 {
        counter: u64 = 0,
    },
    map: StorageMap<Identity, u64> = StorageMap {},
    vec: StorageVec<b256> = StorageVec {},
    text: StorageString = StorageString {},
    blob: StorageBytes = StorageBytes {},
}
```

Access is `storage.var1`, and for namespaces `storage::ns1.counter`
(`storage::ns1::ns2.field` when nested). The path must match exactly —
`storage.counter` cannot reach a namespaced field. Do not use the
`#[namespace(...)]` attribute: it is unknown at this tag (compiles with only
a warning and has no effect); the in-block namespace syntax is the real
mechanism.

Not storable: types containing `raw_ptr` (e.g. `Vec`), `str` slices; arrays
in storage are unimplemented at this tag. `StorageMap`/`StorageVec`/
`StorageString`/`StorageBytes` are zero-sized marker types — they emit no
initial slots, and nesting like `StorageMap<u64, StorageVec<u8>>` is allowed.

## Read and write through StorageKey

`storage.field` yields a `StorageKey<T>` (`slot`, word `offset`, `field_id`):

```sway
#[storage(read)]        fn read(self) -> T          // reverts on uninitialized slots
#[storage(read)]        fn try_read(self) -> Option<T>
#[storage(read, write)] fn write(self, value: T)    // read-modify-write on shared slots
#[storage(write)]       fn clear(self) -> bool
```

Prefer `try_read()` — dynamic storage types are never initialized at deploy,
so a first `read()` of e.g. a map entry reverts. `clear()` wipes whole
slots, including sibling values packed into the same slot.

Purity: functions are pure by default; annotate ABI declarations and
implementations alike. `#[storage(read)]` forbids writes;
`#[storage(write)]` **also permits reads** (partial-slot writes read first).
Enforcement runs on final IR — storage instructions inside `asm` blocks
(`srw`, `sww`, `srwq`, `swwq`, `scwq`, `sclr`) count, transitively through
calls.

## Use the storage collections

`StorageMap<K, V>` (requires `K: Hash`; import `std::hash::Hash`):

```sway
fn get(self, key: K) -> StorageKey<V>       // pure; no existence check
#[storage(read, write)] fn insert(self, key: K, value: V)
#[storage(read, write)] fn try_insert(self, key: K, value: V) -> Result<V, StorageMapError<V>>
#[storage(write)]       fn remove(self, key: K) -> bool
```

Read entries with `storage.map.get(k).try_read().unwrap_or(default)`.
`try_insert` returns `StorageMapError::OccupiedError(existing)` instead of
overwriting.

`StorageVec<V>`: `push`, `pop() -> Option<V>`,
`get(i) -> Option<StorageKey<V>>`, `set`, `insert`, `remove(i) -> V`
(shifts tail; reverts out-of-bounds), `swap_remove`, `swap`, `len`,
`is_empty`, `first`/`last`, `reverse`, `fill`, `resize`,
`store_vec(Vec<V>)`/`load_vec() -> Vec<V>`, `iter()`. There is no
`StorageVec::clear`; the generic `StorageKey::clear()` wipes only the length
slot and strands (unreachable but present) element slots. `pop` likewise
leaves the popped element's data in place — treat "cleared" storage as
length-zeroed, not erased.

`StorageString`/`StorageBytes` implement `StorableSlice`:
`write_slice(value)`, `read_slice() -> Option<String|Bytes>`, `clear()`,
`len()`. A written empty value still reads back as `None`; length 0 is
indistinguishable from never-written.

## Know the key derivation

All slots are sha256 of domain-separated preimages:

| State | Slot key |
|---|---|
| Plain field | `sha256(0x00 ++ "storage.field")` |
| Namespaced field | `sha256(0x00 ++ "storage::ns1::ns2.field")` |
| Struct member | field's base slot `+ byte_offset/32`; members share slots word-aligned |
| `in <key>` field | the given `b256`, verbatim |
| Map entry | `sha256(0x01 ++ Hash(key) ++ field_id)` |
| Vec length | `field_id` (the field's own key) |
| Vec content | `sha256(field_id) + word offset`; element id `sha256((index, sha256(field_id)))` |
| String/Bytes | length at `field_id`, content from `sha256(field_id)` |

Values are left-aligned at byte 0 of each 32-byte slot (a `u64` occupies
bytes 0-8) — the opposite of EVM right-alignment. A field spans
`ceil(size/32)` consecutive slots; distinct top-level fields never share a
slot, but members of one struct field do.

Security consequences:

- The `0x00` field / `0x01` map domain bytes are the fix for the historical
  variables-vs-maps collision class (Sway #6317); with `new_hashing` on,
  `str`/`Bytes` map keys are length-prefixed before hashing, which **moves
  those map slots relative to pre-new_hashing toolchains** — audit any
  migration between hashing modes as a storage migration.
- Two declarations hashing the same path string (e.g. contract and library
  both contributing `storage { x: ... }`) collide; namespaces are the salt
  mechanism. Duplicate keys — including deliberate `in` aliases — are a
  compile *warning* (`DuplicatedStorageKey`), not an error. Treat any `in`
  key as its own audit item.

## Initialize and verify at deploy

Initializers const-evaluate at compile time into
`out/<profile>/<package>-storage_slots.json`, which feeds the contract's
initial state root and therefore the contract ID. Zero-sized storage types
emit no slots. Diff this artifact on every change
(`scripts/diff_fuel_artifacts.py` covers it); reordering, renaming or
re-namespacing fields moves live state.

Raw access (`std::storage::storage_api::{read_quads, write_quads}` and the
`__state_load_word`/`__state_store_word` intrinsics with self-chosen `b256`
keys) bypasses all derivation — isolate and audit per
[sway-authoring.md](sway-authoring.md).

## Test storage behavior

Storage is contract-local; other contracts and tests reach it only through
ABI methods. In-language tests call the contract via
`abi(MyAbi, CONTRACT_ID)`; `forc test` builds the contract twice to inject
`CONTRACT_ID`, and each unit test runs against isolated storage. Test the
uninitialized-read revert, the `try_read` default path, absent vs `Some(0)`
map entries, out-of-bounds vec ops, and post-`clear` re-reads.
