# Sway language reference

Verified against the `FuelLabs/sway` `v0.71.2` sources (parser/AST, std, and
e2e-tested programs). Defaults at this tag: `new_encoding`, `references` and
`new_hashing` on; `dynamic_storage` off. Storage syntax lives in
[storage.md](storage.md); std signatures in [stdlib.md](stdlib.md).

## Declare the program type

First non-comment line of the entry file: `contract;`, `script;`,
`predicate;` or `library;`.

- Script: `fn main(...) -> T`. Under new encoding, `main` takes arbitrary
  ABI-encodable typed arguments and may return any encodable type or `()`.
- Predicate: `fn main(...) -> bool` (compile error otherwise); may also take
  typed arguments, decoded from the input's predicate data.
- Contract: no `main`; entry points are `impl SomeAbi for Contract` methods,
  plus at most one module-level `#[fallback] fn` (a contract with only a
  fallback compiles).
- Library: bare `library;` — the package name comes from `Forc.toml`, not
  the source.

## Know the types

Primitives: `u8 u16 u32 u64 u256 b256 bool str str[N] ()`. No signed
integers, no floats, no char type. `raw_ptr`/`raw_slice` are std low-level
types; the Never type `!` and inference placeholder `_` exist in type
position.

Literals: decimal, hex `0x...`, octal `0o...`, binary `0b...`, `_`
separators, `u8..u256` suffixes (e.g. `5u64`). An unsuffixed 64-hex-digit
`0x...` literal is `b256`; add `u256` for u256. Unannotated numerics default
to `u64`.

```sway
let t: (u64, bool) = (42, true);   let v = t.0;   let (a, b) = t;
let one: (u64,) = (42,);           // 1-tuple needs trailing comma
let arr: [u64; 5] = [1, 2, 3, 4, 5];  let zeros = [0u8; 32];  let e = arr[2];

pub struct Point { pub x: u64, y: u64 }        // per-field pub
let p = Point { x: 1, y };                      // shorthand
let Point { x, y } = p;                         // destructuring

enum Shape { Circle: u64, Rect: (u64, u64), Unit: () }
let s = Shape::Circle(3);   let u = Shape::Unit;   // unit variant: no ()

type AnotherU8 = u8;                            // type alias
```

Enums occupy one 8-byte tag word plus the largest variant; structs have no
overhead. Structs, enums and functions all accept generics and `where`
clauses.

## Bind and mutate

`let` is immutable; `let mut` enables reassignment and the compound
operators `+= -= *= /= <<= >>=` (no `%=`, `&=`, `|=`, `^=`). The `let` LHS
is a full pattern. Variables may shadow variables and imports; constants and
configurables cannot be shadowed or shadow.

## Control flow

- `if`/`else` and `match` are expressions. `if let Pattern = expr {}` exists
  and chains with `else if let`.
- `match` patterns: literals, variables, `mut x` binders, constants,
  wildcard `_`, tuples, enum constructors, struct patterns with renames and
  `..` rest, and or-patterns `|` (also nested:
  `Point { x: 333 | 444, .. }`). **No match guards, no range patterns, no
  ref patterns** at this tag.
- Loops: `while cond {}` and `for pat in expr {}`. **There is no `loop`
  keyword.** `for` only iterates values with an `Iterator`-shaped `.iter()`
  (Vec, Bytes, StorageVec); arrays are not directly iterable — index with
  `while`. `break`/`continue` work in both; `return expr;` returns early;
  blocks return their final expression without `;`.

## Functions, methods, impls

```sway
pub fn f<T>(arg: u64, ref mut out: u32) -> u64 where T: PartialEq { ... }

impl Point {
    pub const ORIGIN_X: u64 = 0;              // associated const
    pub fn new() -> Self { Self { x: 0, y: 0 } }
    pub fn translate(ref mut self, dx: u64) { self.x += dx; }
}
```

Receivers are `self`, `ref self`, `mut self`, `ref mut self` — never
`&self`. `ref mut` parameters are the pre-references by-ref mechanism and
still standard for mutating methods. `impl` on primitives is allowed.
Fully-qualified paths work: `<Struct as Trait>::ID`.

Generic constraints go in `where` clauses, not inline angle brackets
(`fn f<T>(x: T) where T: Eq + New`). Turbofish works on functions, methods
and variants: `Vec::<u64>::new()`, `Result::Ok::<u64, bool>(5)`. Const
generics parse with early, partial support — don't rely on them.

## Traits and ABIs

```sway
trait Shape: Area {                 // supertrait(s) via `:`, joined with +
    fn sides(self) -> u64;          // interface block
} {                                 // OPTIONAL second block: provided methods
    fn describe(self) -> u64 { self.sides() + self.area() }
}

trait Convert<T> { fn from(t: T) -> Self; }
impl Convert<Square> for Rectangle { ... }
```

Default method bodies live in that separate second brace block — not inline
in the interface block. Trait items: fn signatures, associated consts (with
defaults, overridable), associated types (`type Item;`). Blanket impls work
(`impl<T, U> Into<U> for T where U: From<T>`). Marker traits in
`std::marker` (`Enum`, `Error`) are compiler-implemented; user impls are
rejected.

ABIs mirror traits, including super-ABIs, regular-trait supertraits, and a
second block for provided methods:

```sway
abi MyAbi: MySuperAbi {
    #[storage(read)]
    fn bar() -> u64;
} {
    fn provided() -> u64 { 7 }
}

impl MyAbi for Contract { ... }     // must also impl supertraits for Contract
```

Calling another contract (call params in braces before the argument
parens — ABI callers only):

```sway
let caller = abi(MyAbi, target_contract_id_b256);
let result = caller.bar { gas: 10_000, coins: 0, asset_id: b256::zero() }();
```

## Modules and visibility

Parent declares `mod name;` / `pub mod name;`; the child lives in
`src/name.sw` (or a directory) and starts with `library;`. Imports:
`use std::hash::*;`, groups `use lib::{A, B};`, renames `use t::{S as T};`,
project-root-absolute `use ::b::*;`. Re-export with `pub use`. `pub`
applies to fns, types, traits, consts, fields, mods and uses. Raw
identifiers (`r#panic`) exist.

## Constants and configurables

`const X: u64 = 42;` at module scope, in `impl` blocks, traits and ABIs;
usable in match patterns; `str`-typed consts are unsupported. Configurables
(one block per program, not allowed in libraries) are deploy-time-patchable
named values referenced bare — see
[worked-examples.md](worked-examples.md) for the block syntax.

## Attributes (complete set at v0.71.2)

| Attribute | Form | Applies to |
|---|---|---|
| `storage` | `#[storage(read)]`, `#[storage(read, write)]` | fns/ABI methods |
| `payable` | `#[payable]` | ABI methods receiving assets |
| `fallback` | `#[fallback]` | one module-level contract fn |
| `test` | `#[test]`, `#[test(should_revert)]`, `#[test(should_revert = "code")]` | test fns |
| `inline` | `#[inline(always|never)]` | fns (hint) |
| `allow` | `#[allow(dead_code)]`, `#[allow(deprecated)]` | most items |
| `cfg` | `#[cfg(target = "fuel"|"evm")]`, `#[cfg(program_type = "...")]`, `#[cfg(experimental_<feature> = true|false)]` | items |
| `deprecated` | `#[deprecated(note = "msg")]` | items, fields, variants |
| `error_type` | `#[error_type]` | enums only |
| `error` | `#[error(m = "message")]` — the arg is literally `m` | variants in `#[error_type]` enums |
| `trace` | `#[trace(always|never)]` — spelled `trace`, not `tracing` | fns (panic backtraces) |
| `abi_name` | `#[abi_name(name = "Old")]` | structs/enums (ABI JSON name) |
| `event` / `indexed` | `#[event]`, `#[indexed]` | event structs / leading fields |
| `require` | `#[require(trivially_encodable)]` | types |

Unknown attributes are a **warning**, not an error — a typo like
`#[namespace(...)]` or `#[tracing(...)]` compiles and silently does nothing.

## Panic and rich errors

`panic` is an expression at this tag: `panic;`, `panic "message";`, or
`panic MyError::Variant(v);` where the enum is `#[error_type]` with
`#[error(m = "...")]` variants. It reverts with a unique per-call-site code
and logs the value; ABI JSON carries the error codes. Generic propagation:
`fn fail<T>(t: T) where T: Error { panic t; }`.

## Operators

Desugar to std traits with non-Rust names: `Add::add`,
`Subtract::subtract`, `Multiply::multiply`, `Divide::divide`,
`Mod::modulo`, `Not::not`, `PartialEq::eq/neq` (+ separate `Eq` marker),
`Ord::gt/lt`, `OrdEq::ge/le`, `BitwiseAnd::binary_and`,
`BitwiseOr::binary_or`, `BitwiseXor::binary_xor`, `Shift::lsh/rsh`
(rhs `u64`), `**` → `Power::pow(self, exponent: u32)`. `&&`/`||` are lazy
built-ins. Implement these traits to overload operators for your types.

## Conversions — there is no `as` cast

`as` only renames imports. Convert with:

- widening methods: `x.as_u16() / as_u32() / as_u64() / as_u256()`;
- narrowing: `x.try_as_u8() -> Option<u8>` etc.;
- `From`/`Into` (widening, `Address::from(b256)`, `b256 <-> u256`);
- `TryFrom`/`TryInto` — **returning `Option<Self>`, not `Result`** at this
  tag;
- bool/int: no direct cast — use `if`/`match`;
- `__transmute::<A, B>(v)` for bit reinterpretation (audit boundary).

## Strings

`str` is a ptr+len slice; literals are `str`. It cannot be a constant,
storage field, or configurable. `str[N]` is a fixed value type created at
compile time with `__to_str_array("fuel")`; convert at runtime with
`from_str_array(s)` and `"abcd".try_as_str_array::<str[4]>()`. Heap strings:
`std::string::String` (ASCII-oriented).

## References (default-on feature)

`&x`, `&mut x` (also of temporaries, and `& &x`), types `&T`/`&mut T`,
slices `&[T]` via `__slice`/`__elem_at`, deref with `*r` (reads,
assignments `*r = v`, field/index access through refs). No ref patterns in
`match`. `&mut` requires the target place itself be mutable. The older
`ref mut` parameter form coexists.

## Intrinsics

`__size_of<T>()`, `__size_of_val(v)`, `__is_reference_type<T>()`,
`__to_str_array`, arithmetic/comparison `__add/__sub/__mul/__div/__mod/
__eq/__gt/__lt/__and/__or/__xor/__lsh/__rsh/__not`,
`__gtf<T>(index, field_id)`, `__addr_of`, `__alloc`, `__ptr_add/__ptr_sub`,
`__state_load_word/__state_store_word/__state_load_quad/__state_store_quad/
__state_clear`, `__log`, `__revert`, `__smo`, `__jmp_mem`,
`__contract_call/__contract_ret`, `__encode_buffer_*`, `__slice/__elem_at`,
`__transmute`, `__dbg` (returns its argument; `Debug` trait). Prefer std
wrappers; raw intrinsic use is an audit boundary per
[sway-authoring.md](sway-authoring.md).
