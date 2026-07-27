# FuelVM assembly and ISA

Verified against `fuel-asm`/`fuel-vm` `v0.66.4` (the exact crates Sway
`v0.71.2` pins) and the matching `fuel-specs` revision `dd11147`, plus the
Sway compiler's own asm-block whitelist. This ISA revision is newer than most
public web docs: it includes NIOP, LQW/LHW/SQW/SHW, JAL, PSHL/PSHH/POPL/POPH,
ECOP/EPAR, BSIZ/BLDD, ECAL and the SCLR/SRDD/SRDI/SWRD/SWRI/SUPD/SUPI/SPLD
storage family, and deprecates SRWQ/SWWQ/SCWQ. Re-verify opcode availability
against the target node's pinned VM before relying on newer instructions.

## Write Sway `asm` blocks correctly

```sway
let value = asm(rout, ra: left, rb: right) { // bindings: name[: init_expr]
    add  rout ra rb;        // operands space-separated, `;`-terminated
    addi rout rout i5;      // immediate = `i` + DECIMAL digits (no hex)
    rout: u64               // return register, optional `: Type`, no `;`
};
```

- Bindings without an initializer are uninitialized virtual registers
  (initialize before reading). Names are virtual; the compiler allocates
  real registers.
- Readable reserved names inside blocks: `zero one of pc ssp sp fp hp err
  ggas cgas bal is ret retl flag` (never writable).
- Without a final register expression the block evaluates to `()`. Type
  defaults to `u64`.
- Immediate width is checked at compile time (imm06/12/18/24); wrong usage
  errors: `MalformedAsmImmediate`, `Immediate12TooLarge`,
  `UnnecessaryImmediate`, `MissingImmediate`,
  `IncorrectNumberOfAsmRegisters`.
- **Not accepted in Sway asm blocks** (`UnrecognizedOp`): all jumps/labels
  (`ji jmp jne jnei jnzi jmpb jmpf jnzb jnzf jneb jnef jal`) — no
  intra-block control flow; sub-word memory ops `lqw lhw sqw shw`; `niop`,
  `mldv`; all 128-bit `wd*` wide ops; `pshl pshh popl poph`. The 256-bit
  `wq*` family IS exposed.
- Accepted set (lowercase): ALU (`add addi and andi div divi eq exp expi gt
  lt mlog mod modi move movi mroo mul muli noop not or ori sll slli srl
  srli sub subi xor xori`), `wqcm wqop wqml wqdv wqmd wqam wqmm`, `ret`,
  memory (`aloc cfe cfei cfs cfsi lb lw mcl mcli mcp mcpi meq sb sw`),
  blockchain (`bal bhei bhsh burn call cb ccp croo csiz bsiz ldc bldd log
  logd mint retd rvrt smo sclr scwq srw srwq srdd srdi sww swwq swrd swri
  supd supi spld time tr tro`), crypto (`eck1 ecr1 ed19 k256 s256 ecop
  epar`), `ecal flag gm gtf`.
- Quirks: `aloc size` (destination `$hp` implicit); `cfei/cfe/cfs/cfsi`
  (`$sp` implicit). `asm` cannot appear in `const` evaluation. Prefer
  `__gtf::<T>(index, FIELD_ID)` over raw `gtf`.

## Register model

64 registers, 64-bit, unsigned, big-endian. `0x10`-`0x3F` are writable;
writing `0x00`-`0x0F` panics `ReservedRegisterNotWritable`.

| idx | reg | meaning |
|---|---|---|
| 0x00 | `$zero` | always 0 |
| 0x01 | `$one` | always 1 |
| 0x02 | `$of` | overflow high-bits/flag |
| 0x03 | `$pc` | program counter |
| 0x04 | `$ssp` | stack start (bottom of writable stack) |
| 0x05 | `$sp` | stack pointer (grows up) |
| 0x06 | `$fp` | frame pointer (0 in external context) |
| 0x07 | `$hp` | heap pointer (heap grows DOWN) |
| 0x08 | `$err` | error code |
| 0x09 | `$ggas` | global remaining gas |
| 0x0A | `$cgas` | context remaining gas |
| 0x0B | `$bal` | forwarded balance |
| 0x0C | `$is` | instructions start |
| 0x0D | `$ret` | return value/pointer |
| 0x0E | `$retl` | return length |
| 0x0F | `$flag` | flags |

## Memory model and flags

- `VM_MAX_RAM` = 64 MiB, byte-addressable, word = 8 bytes. Stack starts low
  and grows up from `$ssp`; heap starts at `VM_MAX_RAM` and grows down.
  `ALOC` does `$hp -= size`; the zeroed allocation starts at the NEW `$hp`.
- Ownership on writes: a context owns `[$ssp, $sp)` plus its heap range;
  violations panic `MemoryOwnership`; touching never-allocated memory
  panics `UninitalizedMemoryAccess`; only `[$is, $ssp)` is executable.
- `$flag`: `F_UNSAFEMATH (0x01)` — undefined math sets `$err=1`, dest=0
  instead of `ArithmeticError`; `F_WRAPPING (0x02)` — overflow sets `$of`
  (high 64 bits; SUB borrow = all-ones; EXP sets `$of=1`, dest=0) instead
  of `ArithmeticOverflow`. Other bits panic `InvalidFlags`. `CALL` resets
  `$flag` to 0.
- Shifts are the quiet exception: `SLL/SRL/SLLI/SRLI` with shift ≥ 64 yield
  0 — no panic, no `$of`. `MLDV` divisor 0 divides by 2^64;
  `WDMD`/`WQMD` divisor 0 divides by 2^128/2^256; these never math-panic.
- `LW`/`SW` immediates are WORD offsets (scaled by 8); `LB`/`SB` byte
  offsets — a classic off-by-8 source when porting.

## Instruction set (v0.66.4)

ALU (dest panics if reserved; `$of`/`$err` cleared unless noted):
`ADD ADDI SUB SUBI MUL MULI` (overflow→panic/`$of`), `DIV DIVI MOD MODI
MLOG MROO` (undefined→panic/`$err`), `EXP EXPI` (overflow→panic/`$of=1`),
`AND ANDI OR ORI XOR XORI NOT MOVE MOVI NOOP`, comparisons `EQ GT LT`,
shifts `SLL SLLI SRL SRLI`, fused `MLDV` (128-bit `(a*b)/c`), `NIOP`
(8/16/32-bit checked narrow ops; width+op in imm06).

Wide integer (memory operands; imm06 selects mode/indirection): 128-bit
`WDCM WDOP WDML WDDV WDMD WDAM WDMM` and 256-bit `WQCM WQOP WQML WQDV WQMD
WQAM WQMM` (compare / ALU op / multiply / divide / muldiv / addmod /
mulmod). Sway exposes only the `wq*` set — use them for u256 kernels.

Control: `JMP JI JNE JNEI JNZI` ($is-relative instruction indices),
relative `JMPB JMPF JNZB JNZF JNEB JNEF`, `JAL` (absolute byte address,
link register), `RET` (value; pops frame internally), `RETD` (return
`MEM[rA, rB]` + digest receipt), `RVRT` (revert all state).

Memory: `ALOC`, stack `CFE CFEI CFS CFSI`, `PSHL PSHH POPL POPH`
(bitmask-selected register save/restore), loads/stores `LB LQW LHW LW / SB
SQW SHW SW`, `MCL MCLI` (zero), `MCP MCPI` (copy; overlap panics), `MEQ`.

Blockchain/contract: `BAL` (contract's asset balance), `BHEI`/`BHSH`
(height/hash), `CB` (coinbase), `TIME` (TAI64 of height), `MINT`/`BURN`
(sub-ID at rB; require internal context), `CALL`, `CCP`/`CROO`/`CSIZ`
(code copy/root/size), `LDC rA rB rC imm` — load code, mode imm06:
**0=contract, 1=blob, 2=VM memory**; needs `$ssp == $sp`, `LOG LOGD`
(receipts), `SMO` (L2→L1 message), `TR` (to contract) / `TRO` (to address
via Variable output; zero amount panics).

Storage (internal context only): current family `SRW SWW` (word),
`SCLR SRDD SRDI SWRD SWRI SUPD SUPI SPLD` (variable-length slot
clear/read/write/update/preload; `$err=1` on absent slot); deprecated but
executable `SRWQ SWWQ SCWQ` (32-byte sequential quads).

Blob: `BSIZ` (size), `BLDD` (load blob data).

Crypto: `ECK1` (secp256k1 recover → 64-byte pubkey; bad sig zeroes and
sets `$err`), `ECR1` (secp256r1), `ED19` (ed25519 verify; msg len 0 treated
as 32), `K256`, `S256`, `ECOP`/`EPAR` (alt_bn128 point ops and pairing).

Other: `FLAG`, `GM rD imm18`, `GTF rD rA imm12`, `ECAL` (host escape
hatch).

GM selectors: 0x01 caller-is-external, 0x02 caller frame ptr, 0x03
verifying-predicate index, 0x04 chain ID, 0x05 tx memory address, 0x06 base
asset ID address, 0x07 gas price (panics in predicates), 0x08 tx owner.

## GTF selectors

`gtf $rA $rB imm12` — `$rB` is the index for indexed fields. Key selectors
(complete enum at v0.66.4; `std::tx/inputs/outputs` wrap most):

- Tx: type 0x001, scriptGasLimit 0x002, scriptLength 0x003, scriptDataLength
  0x004, script 0x009, scriptData 0x00A, txLength 0x00E. Generic counts (use
  these, the 0x005-0x007 forms are deprecated): inputs 0x900, outputs 0x901,
  witnesses 0x902; inputAt 0x903, outputAt 0x904, witnessAt 0x905.
- Create: bytecodeWitnessIndex 0x101, storageSlotsCount 0x102, salt 0x106,
  storageSlotAt 0x107.
- Input coin: type 0x200, txId 0x201, outputIndex 0x202, owner 0x203,
  amount 0x204, assetId 0x205, witnessIndex 0x207, predicateLength 0x209,
  predicateDataLength 0x20A, predicate 0x20B, predicateData 0x20C,
  predicateGasUsed 0x20D. Input contract: contractId 0x225. Input message:
  sender 0x240, recipient 0x241, amount 0x242, nonce 0x243, witnessIndex
  0x244, dataLength 0x245, predicateLength 0x246, predicateDataLength
  0x247, data 0x248, predicate 0x249, predicateData 0x24A,
  predicateGasUsed 0x24B.
- Output: type 0x300, coinTo 0x301, coinAmount 0x302, coinAssetId 0x303
  (Change/Variable answer as coins), contractInputIndex 0x304,
  createdContractId 0x307, createdStateRoot 0x308. Selectors 0x305/0x306
  appear in the spec but are NOT in the v0.66.4 enum — they panic
  `InvalidMetadataIdentifier`.
- Witness: dataLength 0x400, data 0x401. Policies: types-bitmask 0x500, tip
  0x501, witnessLimit 0x502, maturity 0x503, maxFee 0x504, expiration
  0x505, owner 0x506 (unset policy panics `PolicyIsNotSet`). Upload
  0x600-0x605; blob id 0x700, blob witnessIndex 0x701; upgrade purpose
  0x800.

## Predicate restrictions

Illegal in predicates (panic `ContractInstructionNotAllowed`): `RETD RVRT
LOG LOGD TIME BHEI BHSH BAL CALL CCP CROO CSIZ CB MINT BURN TR TRO SMO` and
every storage op. Allowed: all ALU/wide ops, all jumps, all crypto, `GM`
(except gas-price mode), `GTF`, `ECAL`, `BSIZ`/`BLDD`, and `LDC` modes 1
(blob) and 2 (memory) — mode 0 (contract) panics inside predicates. A
predicate must `RET` exactly 1 (`PredicateReturnedNonOne` otherwise), and
its declared `predicateGasUsed` must match actual consumption.

## Call frames

`CALL $rA $rB $rC $rD`: `$rA` → packed `(to: 32B, param1: u64, param2:
u64)`, `$rB` coins, `$rC` → 32-byte asset ID, `$rD` gas (clamped). Frame at
`$fp`: to (32) ++ asset_id (32) ++ 64 saved registers (512) ++ padded code
size (8) ++ param1 (8) ++ param2 (8) ++ code. So `MEM[$fp, 32]` is the
current contract ID and param1/param2 sit at `$fp+584`/`$fp+592`. No stored
return address: `RET`/`RETD` restore saved registers and set
`$pc = saved_pc + 4`; `$ggas $cgas $ret $retl $hp` survive the return.
`$flag` and `$bal` are reset per call.

## Panic reasons (receipt debugging)

0x01 Revert, 0x02 OutOfGas, 0x03 TransactionValidity, 0x04 MemoryOverflow,
0x05 ArithmeticOverflow, 0x06 ContractNotFound, 0x07 MemoryOwnership,
0x08 NotEnoughBalance, 0x09 ExpectedInternalContext, 0x0b/0x0c/0x0d
Input/Output/WitnessNotFound, 0x0e TransactionMaturity,
0x0f InvalidMetadataIdentifier, 0x10 MalformedCallStructure,
0x11 ReservedRegisterNotWritable, 0x12 InvalidFlags,
0x13 InvalidImmediateValue, 0x15 EcalError, 0x16 MemoryWriteOverlap,
0x17 ContractNotInInputs, 0x19 ContractMaxSize,
0x1a ExpectedUnallocatedStack, 0x1d ExpectedOutputVariable,
0x1f PredicateReturnedNonOne, 0x22 MessageDataTooLong,
0x23 ArithmeticError, 0x24 ContractInstructionNotAllowed,
0x25 TransferZeroCoins, 0x26 InvalidInstruction, 0x27 MemoryNotExecutable,
0x28/0x29 PolicyIsNotSet/PolicyNotFound, 0x2a TooManyReceipts,
0x2d TooManySlots, 0x2f MemoryGrowthOverlap,
0x30 UninitalizedMemoryAccess (sic), 0x36 BlobNotFound,
0x38 GasCostNotDefined, 0x39-0x3b curve/point errors,
0x40 CanNotGetGasPriceInPredicate, 0x41 OwnerIsUnknown,
0x42 StorageOutOfBounds. (Full enum in `fuel-asm/src/panic_reason.rs`.)

## Receipts

Call, Return, ReturnData (ptr/len/sha256 digest), Panic (reason +
instruction), Revert, Log (4 register values), LogData (log ID in rB +
data + digest), Transfer, TransferOut, ScriptResult (result + gas_used;
always last), MessageOut, Mint, Burn. Receipt count capped at 2^16 with the
last two slots reserved for Panic/ScriptResult.

## Gas behavior

Per-instruction charge; exceeding `$cgas` reverts out-of-gas. `CALL`
forwards `min($rD, available)` and unused context gas returns to the
caller. First touch of a storage slot is the expensive one (cache persists
across calls in-tx); variable-length slot ops charge for the full slot even
on partial ranges; `LDC` charges on `max(contract_len, requested_len)`.
Query the target node's gas cost table — do not hardcode per-op costs.
