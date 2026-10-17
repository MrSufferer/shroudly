# What Compact can express and prove for hidden-state verification (pinned profile)

Research for [#50](https://github.com/MrSufferer/shroudly/issues/50), a research ticket on wayfinder map [#49](https://github.com/MrSufferer/shroudly/issues/49). Date of research: 2026-10-17.

This file records facts only. It makes no design decision and does not apply any kill criterion. Each fact carries its source and a status:

- **Documented**: stated in a first-party document or source file at the pinned version.
- **Observed**: produced by running the pinned compiler 0.31.1 (and the `zkir` binary it ships) on a probe in this research; the probe is in the appendix.
- **Derived**: follows directly from documented or observed facts; the inference is stated.
- **Not established**: could not be settled from primary sources; listed in section 7.

## 0. Scope, pins and sources

### Pinned profile (from `midnight/version-profile.json`)

Compact CLI 0.5.2, language 0.23.0, compiler 0.31.1, runtime `@midnight-ntwrk/compact-runtime` 0.16.0, midnight-js 4.1.1, proof server 8.1.0, `@midnight-ntwrk/ledger-v8` 8.1.0 (root `package.json`), node 1.0.2, indexer 4.3.3-hotfix.

Observed: `compact compile +0.31.1 --ledger-version` prints `ledger-8.0.2`, so the compiler targets ledger 8.0.2 while the profile pins ledger-v8 8.1.0 and proof server 8.1.0.

### Primary sources used

| ID | Source | Version / revision | What it is |
| --- | --- | --- | --- |
| S1 | `LFDT-Minokawa/compact`, tag `compactc-v0.31.1` (commit `0da5b04`, 2026-06-25) | toolchain 0.31.1, language 0.23.0, runtime 0.16.0 | Compiler source and in-tree docs: `compiler/standard-library.compact`, `compiler/midnight-natives.ss`, `compiler/midnight-ledger.ss`, `compiler/langs.ss`, `doc/compact-reference.mdx`, `doc/ledger-adt.mdx` (its header reads "Compact language version 0.23.0, compiler version 0.31.1"), `doc/explicit-disclosure.mdx`, `CHANGELOG.md` |
| S2 | `midnightntwrk/midnight-docs` (clone at `main` commit `61f6009`, 2026-10-15) | release notes for toolchain 0.30.0, 0.31.0, 0.31.1, 0.34.0, 0.35.0, 0.17.25.0, 0.20.28.0 and node 0.20.0 and 0.22.5 | Release notes, plus the guide pages `guides/local-proving.mdx`, `nodes/node-toolkit.mdx`, `troubleshoot/decode-1010-transaction-rejection-errors.mdx` and `relnotes/support-matrix.json` |
| S3 | `midnightntwrk/midnight-ledger`, tag `ledger-8.1.0` (commit `d89e0b6`, 2026-05-13) | ledger 8.1.0 | `spec/onchain-runtime.md`, `spec/contracts.md`, `spec/cost-model.md`, `ledger/src/structure.rs`, `ledger/src/verify.rs`, `base-crypto/src/data_provider.rs`, `ledger/examples/output-params.rs`, `zkir/src/*.rs`. `INITIAL_LIMITS` was also diffed against tags `ledger-8.0.2` and `ledger-8.1.3` and is identical in all three. |
| S4 | Type declarations of `@midnight-ntwrk/compact-runtime` 0.16.0 and `@midnight-ntwrk/midnight-js-types` 4.1.1 (installed in the repo's `node_modules`) | 0.16.0 / 4.1.1 | Runtime API surface (`built-ins.d.ts`, `witness.d.ts`) and `PrivateStateProvider` (`private-state-provider.d.ts`) |
| S5 | Midnight documentation fetched with `npx ctx7@latest` (library `/midnightntwrk/midnight-docs`) | docs `main` | Cross-check of stdlib, Merkle tree and witness documentation. Commands run: `library "Midnight"`, then three `docs` queries (stdlib hashes/curves; MerkleTree/HistoricMerkleTree; witness/private state). |
| S6 | The pinned compiler binary and its bundled `zkir` (`~/.compact/versions/0.31.1/aarch64-darwin`) | 0.31.1 | Used to compile probes and run `zkir mock-compile`, which prints `k` and `rows` per circuit. Per the `zkir` source (`ir.rs`), `rows` excludes custom gates and lookups. |
| S7 | #22 report: `midnight/experiments/offline-participation/README.md` and `results.json` on branch `codex/issue-22-private-offline-integration` | #22 | Inputs only, not re-derived (the README is not on this branch's HEAD) |

Version caution: the live documentation site and `main` of the docs repo describe toolchain 0.35.0 (language 0.27.0, runtime 0.20.0, ledger 9), which adds foreign curves, `ecNeg`, `JubjubScalar`, `sha512`, `keccak256` and cross-contract calls (S2: 0.34.0 and 0.35.0 notes). None of these exist at 0.31.1 (confirmed by compiling, section 1). Any claim below that rests only on a `main` docs page is marked as such.

## 1. Commitment, hash and elliptic-curve primitives; homomorphic structure

### 1.1 What exists at 0.31.1

All **Documented** in S1 `compiler/midnight-natives.ss` (the native-function declarations, which also carry the disclosure annotation for each) and `compiler/standard-library.compact`, and in S4:

| Primitive | Signature (0.31.1) | Notes |
| --- | --- | --- |
| `persistentHash<T>(value: T): Bytes<32>` | SHA-256 compression; stable across upgrades | Compiler annotation "discloses a hash of" its input |
| `persistentCommit<T>(value: T, rand: Bytes<32>): Bytes<32>` | SHA-256 based commitment; stable across upgrades | Annotation "discloses nothing" for both `value` and `rand` |
| `transientHash<T>(value: T): Field` | Circuit-efficient hash; not guaranteed to persist across upgrades | Annotation "discloses a hash of" |
| `transientCommit<T>(value: T, rand: Field): Field` | Circuit-efficient commitment; not guaranteed to persist across upgrades; documentation says not to use it to derive state data, usable for consistency checks | Annotation "discloses nothing" |
| `degradeToTransient(Bytes<32>): Field`, `upgradeFromTransient(Field): Bytes<32>` | Conversions | Annotations "discloses a modulus of" and "a converted form of" |
| `JubjubPoint` | The only curve type (Jubjub, the native embedded curve). `Opaque<'JubjubPoint'>` nominal type | S2 0.30.0 notes: renamed from `NativePoint` at 0.30.0 |
| `ecAdd(a, b: JubjubPoint): JubjubPoint` | In-circuit point addition | Annotation "an elliptic curve sum including" |
| `ecMul(a: JubjubPoint, b: Field): JubjubPoint` | Variable-base scalar multiplication; scalar is a plain `Field` | Annotation "an elliptic curve product including" |
| `ecMulGenerator(b: Field): JubjubPoint` | Fixed embedded-group generator times scalar | Annotation "the product of the embedded group generator with" |
| `hashToCurve<T>(value: T): JubjubPoint` | Hash to a Jubjub point | Annotation "a hash of" |
| `constructJubjubPoint(x, y: Field)`, `jubjubPointX/Y(p): Field` | Construction and coordinates | |
| `MerkleTreePath`, `merkleTreePathRoot`, `merkleTreePathRootNoLeafHash` | See section 2 | |

**Observed** absences at 0.31.1 (each a compile failure, probes pn, ps, pk, pm in the appendix): `ecNeg` ("unbound identifier ecNeg"), `JubjubScalar` ("unbound identifier JubjubScalar"), `keccak256` ("unbound identifier keccak256"), and the operator `/` (parse error). S1 `doc/compact-reference.mdx` ("Binary arithmetic expressions") lists only `+`, `-` and `*` as arithmetic operators; there is no division or modulo operator. The runtime 0.16.0 exports (S4) match: `ecAdd`, `ecMul`, `ecMulGenerator`, `hashToCurve`, `constructJubjubPoint`, `jubjubPointX/Y`, `transient*`, `persistent*`, field add/sub/mul. `Secp256k1Point` is also unbound at 0.31.1 (probe pq). S2 describes secp256k1 operations in the 0.34.0 notes, secp256r1, Curve25519, `sha512` and `kernel.caller()` in the 0.35.0 notes, and says cross-contract calls were added in 0.33.0 (0.34.0 notes); none is in the pinned profile. The 0.31.1 `CHANGELOG.md` entry records only a code-generation fix for certain casts.

### 1.2 Numeric types that bound arithmetic

**Documented** (S1 `doc/compact-reference.mdx`, "Implementation-specific limits"): maximum `Field` value is 52435875175126190479447740508185965837690552500527637822603658699938581184512 (the proving-system scalar field size minus one); maximum `Uint` value is 452312848583266388373324160190187140051835877600158453279131187530910662655 (256^31 - 1, i.e. 31 bytes); maximum vector or byte-vector length is 16777216 (2^24; S2 0.20.28.0 notes record this limit being introduced). `Uint` add and multiply widen the static type and cannot overflow but are a static error if the bound exceeds the maximum `Uint`; `Uint` subtract below zero is a dynamic error; `Field` arithmetic wraps modulo the field size. Relational operators `<`, `<=`, `>`, `>=` are defined only for `Uint` types, not `Field`.

Casts (S1 reference, "Type cast expressions"): a `Bytes<m>` to `Field` or `Uint` cast is a dynamic error if the value exceeds the target maximum, so a full 32-byte hash that is not below the field maximum cannot be cast directly; `degradeToTransient` instead reduces ("a modulus of").

### 1.3 Is additive or homomorphic structure usable inside a circuit

- **Documented and Observed**: `ecAdd`, `ecMul` and `ecMulGenerator` compile as in-circuit operations on Jubjub points. A Pedersen-style relation `C = v*H + r*G` with `H = hashToCurve<Bytes<32>>(pad(32,"H"))`, `v` a witnessed `Uint<64>` cast to `Field`, and `r` a witnessed `Field`, compiles and keys generate (probe pedersenOpen). Equality of two `JubjubPoint` values with `==` inside a circuit compiles. The JavaScript-side `JubjubPoint` equality bug was fixed in toolchain 0.31.0 (S2 0.31.0 notes, issue 278).
- **Observed**: summing N supplied points costs 13 rows per `ecAdd` (probe pointSum: 992 rows at N=32, 2240 at N=128). Verifying N openings `v_i*H + r_i*G == C_i` costs about 1,555 rows per operand (probe pedersenOpen, table in section 4).
- **Documented (code)**: `ecMul` in the circuit converts its `Field` scalar to the embedded (Jubjub) scalar field via `std.jubjub().convert` (S3 `zkir/src/ir_vm.rs`).
- **Observed**: no `ecNeg` exists, so subtraction of points is not expressible by a stdlib call. Whether `ecMul(p, order - 1)` or a scalar derived from a `Field` wraps consistently with the Jubjub subgroup order is **Not established** (section 7).
- **Observed**: `JubjubPoint` is accepted as a ledger field type, as a `Map` value and as a `Set` element (probe pa compiles; `contract-info.json` records it as `Opaque` `JubjubPoint`). Note that S2 0.34.0 lists a ZKIR v3 internal error for nesting `JubjubPoint` in a `Map` (issue 704), which is a later toolchain; the pinned probe compiled and generated a ZKIR file without error but no proof involving a stored point was made.
- **Observed (disclosure interaction)**: storing an `ecAdd`/`ecMulGenerator` result derived from a witness without `disclose` fails with "ledger operation might disclose an elliptic curve sum including the product of the embedded group generator with the witness value" (probe d19), i.e. the compiler treats curve results as disclosing, not as hiding, unlike `persistentCommit`/`transientCommit`. Asserting equality between a witness-derived point and a stored public point compiles without `disclose` (probe d21).
- **Documented**: the proving system is PLONK-family with KZG commitments over BLS12-381 (S2, `guides/local-proving.mdx`).

### 1.4 Relative in-circuit cost of the commitment and hash options

**Observed**, Compact 0.31.1 `zkir mock-compile` (rows, k), one value per call unless noted; section 4 has the scaling tables:

| Operation | rows | k |
| --- | --- | --- |
| Single ledger write (baseline circuit) | 89 | 7 |
| `persistentHash<Bytes<32>>` (SHA-256) | 2,271 | 13 |
| `transientHash<Field>` (Poseidon-family) | 46 | 6 |
| One `persistentCommit<Uint<64>>` opening checked against a supplied commitment | 2,611 | 13 |
| One `transientCommit<Uint<64>>` opening checked against a supplied commitment | 116 | 7 |
| One Pedersen-style opening (`hashToCurve`, `ecMul`, `ecMulGenerator`, `ecAdd`, point equality) | 1,580 | 11 |

Per operand at scale: about 2,587 rows (`persistentCommit`), about 92 rows (`transientCommit`), about 1,555 rows (Pedersen opening).

## 2. Merkle tree and sum-structure support

### 2.1 Ledger types available (Documented: S1 `doc/ledger-adt.mdx`, `doc/compact-reference.mdx` "Ledger-state types")

`Cell<T>` (implicit for ordinary types), `Counter`, `Set<T>`, `Map<K, V>`, `List<T>`, `MerkleTree<n, T>`, `HistoricMerkleTree<n, T>`, `Kernel`. Ledger-state types cannot nest, except that a `Map` value may itself be a ledger-state type (not `Kernel`); nested values must be initialised before use and accessed through the full indirection chain.

- `Counter`: `increment(amount: Uint<16>)`, `decrement(amount: Uint<16>)`, `read(): Uint<64>`, `lessThan(threshold: Uint<64>)`. Documented as not reading the value on update, so the transaction does not depend on the exact current value (S1 reference, "Ledger-state types"); a `Cell` read-modify-write does make the transaction depend on the value read ("If F has the value, say, 27 when the transaction is created, F must still have the value 27 when the proof is checked on chain").
- `Set<T>`: `insert`, `remove`, `member`, `size`, `isEmpty`, `resetToDefault`. `Map<K,V>`: `insert`, `insertDefault`, `lookup`, `member`, `remove`, `size`, `isEmpty`, `resetToDefault`. `List<T>`: `pushFront`, `popFront`, `head`, `length`, `isEmpty`.
- **Documented**: iteration (`[Symbol.iterator]`) on `Set`, `Map` and `List` is "callable only from TypeScript"; there is no in-circuit enumeration of ledger collections. `Map.lookup` and `Set.member` take a key.
- **Documented (code)**: on-chain arithmetic is 64-bit unsigned (S3 `spec/onchain-runtime.md`: `add`, `sub`, `lt` on "64-bit unsigned integers"). On-chain `Array(n)` has `n <= 16` (not exposed as a Compact type).

### 2.2 Merkle trees

- **Documented**: `MerkleTree<nat, T>` and `HistoricMerkleTree<nat, T>` are bounded trees of depth `nat` with 2 <= nat <= 32 (S1 `doc/ledger-adt.mdx`; S1 `compiler/langs.ss` defines `min-merkle-tree-depth` 2 and `max-merkle-tree-depth` 32; S3 `spec/onchain-runtime.md`: `BoundedMerkleTree(n)` for `0 < n <= 32`). S2 (`relnotes/compact/compact-0-20-28-0.mdx`, also returned by the ctx7 query) states the depth-32 bound "is due to a corresponding limit in the Midnight blockchain ledger". Capacity is 2^depth leaves (S1 `isFull` compares first-free with `2^nat`).
- **Documented**: operations: `insert(item)`, `insertHash(hash: Bytes<32>)`, `insertIndex(item, index: Uint<64>)`, `insertHashIndex(hash, index)`, `insertIndexDefault(index)` ("can be used to emulate a removal"), `checkRoot(rt)`, `isFull()`, `resetToDefault()`; `HistoricMerkleTree` adds `resetHistory()`. TypeScript only: `root()`, `firstFree()`, `pathForLeaf(index, leaf)`, `findPathForLeaf(leaf)` (documented as O(n)), and for the historic tree `history()`.
- **Documented (code, S1 `compiler/midnight-ledger.ss`)**: a `MerkleTree` is stored as an array of (bounded Merkle tree, first-free cell); `checkRoot` compares the argument with the tree's current root only. A `HistoricMerkleTree` is stored as an array of (bounded Merkle tree, first-free cell, `Map` of past roots); each `insert` adds the new root to that `Map`, and `checkRoot` is a `member` test against it. No code in the ADT removes entries except `resetHistory()` and `resetToDefault()`. Derived: past roots accumulate in contract state with one entry per insert until reset.
- **Documented (code)**: internal nodes are hashed with `transientHash<Vector<2, Field>>([left, right])` (S1 `compiler/standard-library.compact`, `merkleTreePathEntryRoot`); leaves are `persistentHash` of the leaf with domain separator `"mdn:lh"` (`merkleTreePathRoot`), or taken as given with `merkleTreePathRootNoLeafHash` (leaf type `Bytes<32>`), which pairs with `insertHash` (insert a 32-byte leaf hash without hashing it). Node values are digests only; there is no field in the tree nodes for sums or other aggregates, and no sum-tree ADT exists in S1's ledger ADT list.
- **Documented**: the leaf is a typed value hashed on insert; the leaf and its authentication path are supplied to a circuit as a `MerkleTreePath<n, T>` witness, typically built in a TypeScript witness from `pathForLeaf`/`findPathForLeaf` (S5, stdlib `MerkleTreePath` description). Path handling is by value: a path is a `Vector<n, MerkleTreePathEntry>` of (sibling digest, goes-left flag).
- **Observed (disclosure)**: `T.checkRoot(merkleTreePathRoot<d, Bytes<32>>(witnessPath))` fails to compile without `disclose` ("ledger operation might disclose a hash of the witness value"); with `disclose` around the computed root it compiles (probe merkleMember). Derived: the recomputed root is a public argument of the `checkRoot` read in the transcript, so it is visible; for a `HistoricMerkleTree` it identifies which past root the prover used, not which leaf.
- **Observed (cost)**: path verification adds about 31 rows per level; with the default leaf hash the fixed part is about 2.3k rows (a SHA-256 leaf hash), without it about 0.3k rows (merkleMemberNoLeafHash depth 10: 594 rows, depth 32: 1,276 rows; merkleMember depth 2: 2,342, depth 32: 3,272). Membership plus a nullifier insert (`persistentHash` of leaf and a secret, then `Set.insert`) at depth 32 is 7,416 rows (probe spendPattern). Insertion cost in the circuit does not depend on the depth (probe merkleInsert: 4,267 rows at depths 10, 20, 32); the tree update runs on chain.
- **Observed**: a write position is a public argument: `T.insertHashIndex(h, witnessIndex)` fails to compile without `disclose` on the index (probe pi). A circuit cannot update a tree slot at a hidden position.

### 2.3 What a circuit may read or write per transaction

- **Documented**: a transaction carries a public transcript of ledger reads and writes plus a proof; "a `gas` bound on the execution costs of the transcript program" is part of each `Transcript` (S3 `spec/contracts.md`). Each call has a guaranteed and a fallible transcript; the fallible one is paid for even if it fails; `kernel.checkpoint()` marks atomic segments (S1 `doc/ledger-adt.mdx`).
- **Documented**: reads recorded in the transcript are checked against ledger state when the transaction is applied. A `Cell` read pins the exact value (S1 reference, "Ledger-state types"); `Map`/`Set` `member`/`lookup` are reads of that key; `Counter` updates are not reads; `HistoricMerkleTree.checkRoot` reads membership in the roots map and is therefore not invalidated by later insertions (derived from the ADT source above); `MerkleTree.checkRoot` compares against the current root.
- **Documented (S1 `doc/ledger-adt.mdx`)**: `Kernel` operations include `self()`, `blockTimeLessThan/GreaterThan(time: Uint<64>)` (seconds since the Unix epoch, predicates only), `balance*`, `mint*`, `claim*`, `checkpoint()`. `kernel.caller()` is a 0.35.0 addition (S2) and is absent at 0.31.1.
- **Documented (code)**: the call context given to a transcript has `seconds_since_epoch` with an error bound `seconds_since_epoch_err`, `parent_block_hash`, `balance` and an optional `caller` (S3 `spec/contracts.md`, `CallContext`). The `caller` field is populated from the intent's unshielded inputs (S2 0.35.0 notes, which also state that the top-level user caller is not available to a circuit at proof time).
- **Observed (cost of ledger operations in the circuit)**: constant-key `Map.lookup` costs about 4 rows each (mapLookupConst: 28 rows at N=1, 536 at N=128) and `Map.insert` about 1 row each; `k` rises with the number of operations because of public transcript inputs, not constraints (mapInsertConst_8: rows=32 but k=8).
- **Documented (code)**: proof verification is charged as a constant (3.27 ms in `ledger/examples/output-params.rs`) plus a coefficient (4.56 µs there; a second constants file, `onchain-vm/gen/const_declaration.rs`, lists 3.31 µs; which governs the network was not checked) times the number of public inputs (S3 `ledger/src/structure.rs` `proof_verify(size)`, called from `construct.rs` with `public_input_count`). The charge does not depend on `k`. S2 `guides/local-proving.mdx` likewise says verification is "roughly 3.3 milliseconds plus a small term that scales with size".

## 3. Circuit size, constraint and proving limits relevant to settlement over many identities

### 3.1 Language-level limits (Documented)

- All Compact types have compile-time fixed sizes; loops are bounded by constant bounds or by the size of a constant-size object; recursion is not allowed (S1 reference, "Overview" and "Circuit definitions"). `for (const i of start..end)` bounds must be literals or generic natural-number parameters (generic bounds allowed since 0.31.0, S2).
- Observed: indexing a vector with a runtime (witness) value is a compile error: "vector index did not reduce to a constant nonnegative value at compile time" (probe d25). Selection by a hidden index therefore has to be expressed as a scan over all positions.
- Documented: both branches of an `if` are part of the proven relation; since 0.31.0 operations in untaken branches (downcasts, byte/field conversions, relational comparisons with possibly unknown inputs) are rewritten so they cannot fail, at the cost of a larger circuit (S2 0.31.0 notes).
- Documented: a circuit has no `mod` or `/` operator (section 1.1). A witness-supplied quotient and remainder constrained by `q*total + r == x` and `r < total` compiles (probe modReduce: 341 rows, k=9); the Midnight zk-loan tutorial uses the same witness-supplied (quotient, remainder) pattern for a Schnorr reduction (S5).

### 3.2 Per-circuit size on the pinned compiler (Observed)

Measured with `zkir mock-compile` (rows, k) on probes compiled by 0.31.1; full tables in section 4. Selected points:

| Probe | N | rows | k |
| --- | --- | --- | --- |
| `persistentCommit` openings, equality to supplied commitment | 8 / 16 / 32 / 64 | 20,720 / 41,416 / 82,808 / 165,592 | 15 / 16 / 17 / 18 |
| `transientCommit` openings | 8 / 32 / 128 | 760 / 2,968 / 11,800 | 10 / 12 / 14 |
| Pedersen-style openings | 8 / 16 / 32 | 12,472 / 24,920 / 49,816 | 14 / 15 / 16 |
| Cumulative-weight scan (add, compare, count) over N plain witnessed weights, with `ticket < total` check | 8 / 128 / 1,024 | 1,555 / 23,755 / 189,515 | 11 / 15 / 18 |
| #22 `WitnessAvailability.compact` `select` (8 SHA-256 `persistentCommit` openings and selection) compiled with 0.31.1 | 8 | 19,231 | 15 |

Per-operand marginal rows (from the larger N pairs): `persistentCommit` opening about 2,587; `transientCommit` opening about 92; Pedersen opening about 1,555; cumulative-weight scan step about 185; Merkle level about 31.

Observed key sizes: Pedersen-style circuit at N=32 (k=16) generated keys in about 12 seconds with a 21.2 MB prover key and a 1,591 byte verifier key (the verifier key was also 1,591 bytes for a k=11 circuit). #22 recorded a 9,966,774 byte prover key and 2,119 byte verifier key for its k=15 `select`, a 4,508 byte proof and 1,584 ms proving time on its workstation (S7). Proving time versus `k` was **not** measured here (section 7).

### 3.3 Proving-system and network limits

- **Documented (code)**: the ledger's data provider lists structured-reference-string parameter files `bls_midnight_2p0` through `bls_midnight_2p25` (S3 `base-crypto/src/data_provider.rs`), fetched from `https://srs.midnight.network/`. Derived: parameters exist for circuits up to k = 25. The files cached on the research machine went up to `2p16`.
- **Documented**: no source read states a maximum circuit size (rows or `k`) enforced at deploy or call time. S2 0.17.25.0 notes warn that large unpacked casts "might even cause you to hit fixed circuit size limits" without giving a number.
- **Documented (code)**: initial ledger transaction limits (`INITIAL_LIMITS`, S3 `ledger/src/structure.rs`, unchanged in ledger 8.0.2, 8.1.0 and 8.1.3): `transaction_byte_limit` = 1 MiB (checked in `verify.rs` `well_formed`); per-block `read_time` 1 s, `compute_time` 1 s, `block_usage` 200,000 bytes, `bytes_written` 50,000, `bytes_churned` 1,000,000. S3 `spec/cost-model.md` says these limits are ledger parameters, adjustable at runtime and "given per block"; `SyntheticCost::normalize` returns `None` (not priceable) if any dimension exceeds its block limit. S2 `nodes/node-toolkit.mdx` shows a parameter dump with `transaction_byte_limit: 1048576` (the network and date of that dump are not stated); S2 `troubleshoot/decode-1010-transaction-rejection-errors.mdx` says a transaction with "one cost dimension ... above its block limit" fails fee calculation and must be split. Derived: since `block_usage` (200,000 bytes) is below the 1 MiB transaction limit, the binding per-transaction size ceiling on these initial parameters is the block limit.
- **Documented**: S2 node 0.20.0 notes record a maximum block size reduced from 5 MB to 1 MB. Node limit `MAX_TX_GAS_COST` is configurable per node (node 0.22.5 notes).
- **Documented (S2, `guides/local-proving.mdx`)**: proving is done by the proof server, a native service that receives the transaction and the "proving key, verifier key, and ZKIR", and it sees witness data.
- **Not established**: the parameters in force on Preprod today (section 7).

### 3.4 Derived arithmetic a later ticket can reuse

Because circuits are fixed-size, loops are constant-bounded, no collection can be iterated in-circuit, and a vector cannot be indexed by a hidden value, every operand that participates in a settlement comparison costs rows in that one circuit, and the number of operands per circuit is fixed at compile time. Each additional operand is the marginal cost in section 3.2. Anything over that number needs more than one call (each with its own proof and public inputs), with intermediate state passed through public ledger state or through values disclosed at the boundary (see section 4).

## 4. Measurement tables (Observed, Compact 0.31.1, `zkir mock-compile`)

Probes are generated from templates (appendix). `rows` excludes custom gates and lookups.

| Probe | N | rows | k |
| --- | --- | --- | --- |
| baseline (one ledger write) | 1 | 89 | 7 |
| `hashSha`: one `persistentHash<Bytes<32>>` | 1 | 2,271 | 13 |
| `hashPos`: one `transientHash<Field>` | 1 | 46 | 6 |
| `modReduce` (witness quotient and remainder) | 1 | 341 | 9 |
| `pedersenOpen` | 1 / 2 / 4 / 8 / 16 / 32 | 1,580 / 3,136 / 6,248 / 12,472 / 24,920 / 49,816 | 11 / 12 / 13 / 14 / 15 / 16 |
| `pointSum` (N supplied points added, X coordinate disclosed) | 2 / 8 / 32 / 128 | 602 / 680 / 992 / 2,240 | 10 / 10 / 10 / 12 |
| `persistentCommitOpen` | 1 / 8 / 16 / 32 / 64 | 2,611 / 20,720 / 41,416 / 82,808 / 165,592 | 13 / 15 / 16 / 17 / 18 |
| `transientCommitOpen` | 1 / 8 / 16 / 32 / 64 / 128 | 116 / 760 / 1,496 / 2,968 / 5,912 / 11,800 | 7 / 10 / 11 / 12 / 13 / 14 |
| `cumulativeSelect` | 8 / 32 / 128 / 512 / 1,024 | 1,555 / 5,995 / 23,755 / 94,795 / 189,515 | 11 / 13 / 15 / 17 / 18 |
| `merkleMember` (`checkRoot` on `HistoricMerkleTree`) | depth 2 / 10 / 16 / 20 / 32 | 2,342 / 2,590 / 2,776 / 2,900 / 3,272 | 13 |
| `merkleMemberNoLeafHash` | depth 10 / 20 / 32 | 594 / 904 / 1,276 | 10 / 10 / 11 |
| `merkleInsert` (hash a disclosed leaf, `insert`) | depth 10 / 20 / 32 | 4,267 | 13 |
| `spendPattern` (membership plus `persistentHash` nullifier into a `Set`) | depth 10 / 20 / 32 | 6,734 / 7,044 / 7,416 | 13 |
| `mapLookupConst` (constant keys) | 1 / 8 / 32 / 128 | 28 / 56 / 152 / 536 | 6 / 7 / 9 / 11 |
| `mapInsertConst` | 1 / 8 / 32 / 128 | 25 / 32 / 56 / 152 | 5 / 8 / 10 / 12 |

Caveat on comparability: the `cumulativeSelect` probe selects over plain witnessed weights with no commitment check; adding the opening cost per operand is additive in these probes but the combined circuit was only measured for the #22 probe (19,231 rows, k=15).

## 5. Disclosure rules

### 5.1 What the compiler forces to become public (Documented, with Observed confirmation)

Documented (S1 `doc/explicit-disclosure.mdx`, reference "Explicit disclosure"): data from witness return values, exported-circuit arguments (including the constructor's), and anything derived from them is treated as private witness data. The compiler rejects the program unless the value is wrapped in `disclose(...)` before it is (a) stored in the public ledger, (b) returned from an exported circuit, (c) passed to another contract, or (d) used in a conditional that affects what is stored or returned. `disclose` "has no effect other than telling the compiler that it is okay to disclose the value of the wrapped expression" and equivalently makes the compiler treat the wrapped expression as non-witness data. The compiler's analysis follows arithmetic, casts, struct fields, circuit calls and comparisons ("abstract interpreter"). Two stdlib results are treated as non-witness: `transientCommit(e)` and (per the native annotations) `persistentCommit`; `transientHash`/`persistentHash` results are treated as still containing witness data.

Observed results on 0.31.1 (all in the appendix, probe set d):

| Probe | Result without `disclose` | Compiler's stated reason |
| --- | --- | --- |
| Store a witness `Uint<64>` in a ledger `Cell` | Rejected | ledger operation might disclose the witness value |
| Store `persistentCommit(witness, witnessRand)` or `transientCommit(...)` in a `Cell` | Compiles | commitments disclose nothing |
| Store `persistentHash(witness)` or `transientHash(witness)` | Rejected | "might disclose a hash of the witness value" |
| Return `witnessA < witnessB` from an exported circuit | Rejected; compiles with `disclose(a < b)` | might disclose the result of a comparison involving the witness value |
| `if (witness > 5) { ledgerWrite }` | Rejected; compiles with `if (disclose(witness > 5))` | performing this ledger operation might disclose the boolean value of the result of a comparison involving the witness value |
| `assert(witnessA > witnessB, ...)` | Compiles | an assertion is not a disclosure |
| `assert(transientCommit(w, r) == publicCommitment, ...)` | Compiles | |
| `Map.member(w)` / `Map.lookup(w)` / `Set.member(hash(w))` / `Counter.increment(w16)` / `Tree.insertHashIndex(h, w)` | Rejected; `Map.lookup(disclose(w))` compiles | the argument of a ledger operation is disclosed |
| `blockTimeLt(witness)` | Rejected | "might disclose the lower bound of the time being checked" |
| Store a point built from `ecMulGenerator(witness)`/`ecAdd` | Rejected; compiles with `disclose` | "an elliptic curve sum including the product of the embedded group generator with the witness value" |
| `T.checkRoot(merkleTreePathRoot(witnessPath))` and `Set.insert(persistentHash([leaf, secret]))` | Rejected; compile with `disclose` on the root or hash | might disclose a hash of the witness value |
| Disclose the sum from `fold` over a witnessed vector | Compiles with `disclose(sum)` | |
| Index a vector by a witness value | Rejected for a different reason (section 3.1) | |
| Store a hidden amount next to a commitment key: `Map.insert(commitment, w2)` | Rejected without `disclose(w2)` | |

### 5.2 How `disclose` interacts with hidden operands

- **Documented**: the compiler tracks witness data through the value that flows to the sink; wrapping a derived expression discloses only that expression's value, not the operands that produced it. The documented best practice is to place `disclose` "as close to the actual disclosure site as possible" and, when disclosing a hash or obfuscated variant, after the obfuscation. Wrapping the witness call itself declares everything downstream non-private.
- **Observed**: `disclose(a < b)` returned from an exported circuit compiles and exposes the boolean only; `disclose` on the whole `fold` sum exposes the aggregate. Whether the operands are recoverable from the transcript is not something the compiler checks: only values that reach a ledger operation or circuit output appear in the transcript.
- **Documented**: not exporting a ledger field does not hide it. `export` controls generated TypeScript visibility; the public state remains on chain (S1 reference, "Top-level exports"; consistent with #22's decoding of an unexported balance map, S7). The ledger field layout of non-exported fields is in `contract-info.json` since 0.31.0 (S2).
- **Documented**: the privacy of a commitment rests on its `rand` input; the compiler annotation says only that the commitment "discloses nothing" and does not check that `rand` is high entropy.
- **Documented**: a circuit that fails an `assert` or contradicts a constraint cannot produce a proof, so a false claim reveals nothing on chain.

## 6. What a permissionless caller can supply, and what the circuit cannot obtain

### 6.1 Caller-supplied inputs (Documented)

- Exported circuit arguments and every `witness` return value are chosen by the caller's own DApp code. S1 reference ("Declaring witnesses for private state management") warns: "Do not assume in your contract that the code of any `witness` function is the code that you wrote... Any DApp may provide any implementation that it wants for your `witness` functions. Results from them should be treated as untrusted input." The Midnight battleship tutorial states the same ("The contract does not assume honest execution; returned values are checked by circuit asserts", S5).
- Witness implementations receive only a `WitnessContext` with the public `ledger` state, the caller's own `privateState`, and the `contractAddress` (S4 `witness.d.ts`). The private state provider is scoped to a contract address and held by the caller's own provider (S4, `PrivateStateProvider` in `@midnight-ntwrk/midnight-js-types` 4.1.1: "Set the contract address for scoping private state operations... namespace isolation between different contracts").
- Witnesses that wrap wallet functions (`ownPublicKey`, `createZswapInput`, `createZswapOutput`) are declared as witnesses in S1 `midnight-natives.ss`, so the key and coin material they return are caller-supplied unless the circuit constrains them.
- The caller also controls transaction construction, ordering and timing within the ledger's rules (TTL, balancing), and can omit participation. `kernel.caller()` does not exist at 0.31.1, so a circuit cannot learn the submitter's identity except through a value the caller proves knowledge of.
- The proof server receives the full witness data for the proof it builds (S2, `guides/local-proving.mdx`).
- Merkle paths and all public ledger state are available to any caller: `pathForLeaf`/`findPathForLeaf` run over the public tree (O(n) to find a leaf), so any caller can build a valid path for any leaf value it knows.

### 6.2 What a circuit cannot obtain about other users' private state (Documented)

- A circuit has no mechanism to read another user's private state: witnesses are provided by the calling DApp, private state is local, and 0.31.1 has no language-level cross-contract calls (the 0.34.0 notes describe them as added in 0.33.0).
- The only information about other users available to a circuit is what is in public ledger state (including values previous callers disclosed or committed) and what the calling DApp supplies as witnesses. A hash or commitment in public state does not supply its preimage or opening to a later caller (consistent with the #22 probe result, S7).
- A circuit cannot enumerate ledger collections (section 2.1) and cannot index them by a hidden key without disclosing that key (section 5.1).

## 7. Not established from primary sources

1. The Preprod ledger parameters actually in force (transaction byte limit, per-block limits, fee prices). `INITIAL_LIMITS` in ledger 8.0.2/8.1.0/8.1.3 and a docs dump showing `transaction_byte_limit: 1048576` were found; the profile's indexer `https://indexer.preprod.midnight.network/api/v4/graphql` answered with `ENDPOINT_DECOMMISSIONED` ("decommissioned on 2026-10-09; now provided by Blockfrost"), so the live `ledgerParameters` could not be read without a Blockfrost project key.
2. Any maximum circuit size (rows or `k`) accepted at deploy or call time on the network, and the proving time and memory for `k` above the single #22 data point (k=15, 1,584 ms, one workstation). No proof server was run in this research; only compile and `mock-compile` were.
3. Whether the `ecMul` scalar domain reduces consistently with the Jubjub subgroup order, and whether point subtraction is expressible by a scalar multiplication at 0.31.1. The circuit converts the scalar with `std.jubjub().convert` (S3), but the reduction or range behaviour was not checked against a primary document.
4. The exact proof server 8.1.0 behaviour. The `midnight-ledger` repository has a `proof-server-8.1.3` tag but no `proof-server-8.1.0` tag; ledger 8.1.0 sources were used as the closest primary reference. The pinned profile (node 1.0.2, proof server 8.1.0, indexer 4.3.3-hotfix) is also behind the docs compatibility matrix at `main`, which lists node 1.0.400 and proof server 8.1.3 on all three networks. The compiler's own target is ledger 8.0.2.
5. Whether `HistoricMerkleTree` history growth (one stored root per insert) has any ledger-side pruning or cost ceiling beyond the general storage cost model; only the ADT source and the storage-cost formulas in `structure.rs` were read.
6. A published limit on how many public-transcript operations or ledger operations one call may contain; only the per-call `gas` bound, the byte limit and block-level cost dimensions are documented.
7. The number of contract calls (each with its own proof) that can share one transaction under the pinned node and wallet SDK; not read.
8. Combined circuits: the additivity of commitment-opening cost and selection cost was inferred from separate probes except for the #22 probe.

## Appendix: reproduction

Environment: `compact compile +0.31.1 --skip-zk <src> <outdir>` writes `<outdir>/zkir/<circuit>.zkir`; `~/.compact/versions/0.31.1/aarch64-darwin/zkir mock-compile <file>` (or `mock-compile-many <dir>`) prints `(k=.., rows=..)`. Key generation without `--skip-zk` also needs the SRS file for the circuit's `k` (cached or fetched from `https://srs.midnight.network/`). Each probe starts with `pragma language_version >= 0.23.0; import CompactStandardLibrary;`.

Templates (N is substituted; `wv`, `wr`, `wc` are `witness` functions returning `Vector<N, ...>`):

```compact
// persistentCommitOpen (transientCommitOpen: Field rand/commitment, transientCommit)
witness wv(): Vector<N, Uint<64>>; witness wr(): Vector<N, Bytes<32>>; witness wc(): Vector<N, Bytes<32>>;
export ledger ok: Boolean;
export circuit f(): [] {
  const vs = wv(); const rs = wr(); const cs = wc();
  for (const i of 0..N) { assert(persistentCommit<Uint<64>>(vs[i], rs[i]) == cs[i], "open"); }
  ok = true;
}

// pedersenOpen
witness wv(): Vector<N, Uint<64>>; witness wr(): Vector<N, Field>; witness wc(): Vector<N, JubjubPoint>;
circuit H(): JubjubPoint { return hashToCurve<Bytes<32>>(pad(32, "H")); }
export circuit f(): [] {
  const vs = wv(); const rs = wr(); const cs = wc();
  for (const i of 0..N) { assert(ecAdd(ecMul(H(), vs[i] as Field), ecMulGenerator(rs[i])) == cs[i], "open"); }
  ok = true;
}

// cumulativeSelect
struct Acc { sum: Uint<64>; t: Uint<64>; below: Uint<64>; }
circuit step(a: Acc, w: Uint<64>): Acc {
  const s = (a.sum + w) as Uint<64>;
  return Acc { sum: s, t: a.t, below: (s <= a.t) ? ((a.below + 1) as Uint<64>) : a.below };
}
export circuit f(): [] {
  const r = fold(step, Acc { sum: 0, t: wt(), below: 0 }, wv());   // wv(): Vector<N, Uint<64>>, wt(): Uint<64>
  assert(r.t < r.sum, "ticket in range");
  idx = disclose(r.below);
}

// merkleMember (depth d)
export ledger T: HistoricMerkleTree<d, Bytes<32>>;  witness wp(): MerkleTreePath<d, Bytes<32>>;
export circuit f(): [] { assert(T.checkRoot(disclose(merkleTreePathRoot<d, Bytes<32>>(wp()))), "member"); ok = true; }

// modReduce
assert(tot > 0, "t"); assert(rm < tot, "r"); assert((q * tot + rm) == (x as Uint<128>), "qr"); out = disclose(rm);
```

Disclosure probes (set d) each define `witness w(): Uint<64>; witness w2(): Uint<64>; witness wb(): Bytes<32>; witness wf(): Field;` and one exported circuit `f`; the bodies are the expressions listed in section 5.1 (for example `c = persistentCommit<Uint<64>>(w(), wb());`, `return w() < w2();`, `if (w() > 5) { L = 1; }`, `assert(M.member(w()), "x");`, `P = ecAdd(ecMulGenerator(wf()), ecMulGenerator(wf()));`). Absence probes: `ecNeg(ecMulGenerator(wf()))`, a `witness wf(): JubjubScalar`, `keccak256<Bytes<32>>(wb())`, `wb() / 3`, and `ledger P: Secp256k1Point`.
