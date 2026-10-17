# Family 6B: leaf lifecycle and cutoff-root binding

Research ticket #56 on the wayfinder map in #49. Scope: what leaf lifecycle keeps family 6B (public-index sampling, owner-side acceptance `u < w`, one leaf per note) within the tree's limits and keeps the Disclosure Cohort check meaningful. This document reports options and what each costs. It does not choose or recommend. Family 6B stays a candidate, not accepted (maintainer decision on #53).

Pins: Compact 0.31.1, runtime 0.16.0 (`@midnight-ntwrk/compact-runtime`), ledger 8.1.0 (`midnight-ledger` tag `ledger-8.1.0`; Compact source tag `compactc-v0.31.1`). All probes used the pinned compiler (`compact compile +0.31.1 --skip-zk`) and the pinned zkir tool (`~/.compact/versions/0.31.1/aarch64-darwin/zkir mock-compile-many`). No proofs were generated and no node or proof server was run.

Base commit: `7e34a23` (the repository HEAD when this branch was created). The maintainer checkout carried uncommitted ADRs 0028, 0029, 0030 and newer terms in `midnight/CONTEXT.md` (Draw Interval, Unresolved Interval, Unattended Selection, Participant Identity, Contribution Bound) that were not in the agent worktree. Those were read from the maintainer checkout; they are not part of this branch.

## Tags

- **Documented**: stated in a primary source (cited).
- **Observed**: measured by a probe on the pinned toolchain. Mock-compile rows are circuit sizes; serialized sizes come from the pinned JS runtime's `ContractState.serialize()`; neither is a node or proving measurement.
- **Derived**: my own reasoning from the above. Check before relying on it.
- **Not established**: not found in primary sources and not probed.

## 1. Summary of findings

1. **Growth bound.** Documented: depth is at most 32, so at most 4,294,967,296 insert slots per tree; an insert into a full tree fails. Observed: a full depth-2 tree rejects the fifth insert with `exceeded structure bounds`, `firstFree` stays at 4, and nothing wraps. No per-contract state-size cap was found in the ledger sources. Under append-only leaves, growth is one leaf per balance-changing transaction (contribute or withdraw), not per interval (Derived from CONTEXT.md: principal carries over without participant action).
2. **Compaction without participant action** is possible only if retirement is public (a slot is marked retired on the ledger). With private nullifier retirement no third party can tell which leaves are dead (Derived from the locality principle), so nothing can be compacted without the owner.
3. **Retired leaves in `n`.** Under append-only, `n` includes dead leaves. Award probability per try falls by the live fraction, `1/(1+d)` for `d` dead leaves per live leaf. This changes whether an award happens within the permitted number of tries, not who wins among live leaves (Derived).
4. **Cohort check.** With live and dead leaves indistinguishable, a leaf count is a count of notes ever created, which one participant can inflate. A third party cannot count distinct live private notes at all (it sees only public state). A meaningful count needs a public event per eligible participant (as `participantCount` does today) or a public per-note counter that still counts notes, not identities.
5. **Cutoff binding.** Documented: neither `root()` nor `firstFree()` is callable in a circuit. Under an append-only tree, binding to the cutoff reduces to recording `n` at the cutoff and requiring the selected index to be below it; no root pinning is needed because slots below `n` never change (Derived). Any lifecycle that overwrites slots needs a pinned root checked by a twin plain `MerkleTree` (Observed: compiles; costs measured below).
6. **History growth.** Observed: one stored root per insert; serialized contract state grows about 180 to 193 bytes per leaf for a `HistoricMerkleTree<32>`, 1.92 MB at 10,000 leaves. `checkRoot` gas was identical for the newest and oldest root at 10,000 stored roots. `resetHistory` reclaimed only about 100 KB of 1.92 MB at 10,000 roots. The ledger-side ceiling asked about in the expressiveness findings (item 5 of its section 7) was not found beyond the general storage cost model; see section 7.

## 2. Q1. What bounds leaf growth, and can compaction avoid participant action?

### 2.1 Documented facts

- Tree depth is `2 <= nat <= 32` (Compact `doc/ledger-adt.mdx` at `compactc-v0.31.1`, lines 485 and 597).
- `insert` / `insertHash` write at the first free index; `insertIndex` / `insertHashIndex` write at a public index; `insertIndexDefault` writes the default leaf and "can be used to emulate a removal" (same file, lines 503 to 535 and 641 to 647).
- `HistoricMerkleTree.checkRoot` accepts proofs against prior versions of the tree. The Midnight docs add: "`HistoricMerkleTree` is not suitable if items are frequently removed or replaced, as this could lead to proofs being considered valid which should not be" (midnight-docs `docs/concepts/how-midnight-works/keeping-data-private.mdx`, retrieved with `npx ctx7@latest docs /midnightntwrk/midnight-docs ...`).
- `resetHistory` "leaves only the current root valid"; `resetToDefault` "resets this Merkle tree to the empty Merkle tree" (same ADT doc, lines 659 to 675).
- `root()`, `firstFree()`, `isFull()`, `pathForLeaf`, `findPathForLeaf` and `history()` are TypeScript-only (same doc, lines 565 to 590 and 675 to 700).
- Block limits at `INITIAL_LIMITS` (`ledger/src/structure.rs`, line 1173, ledger 8.1.0): `transaction_byte_limit` 1 MiB; per block `read_time` 1 s, `compute_time` 1 s, `block_usage` 200,000, `bytes_written` 50,000, `bytes_churned` 1,000,000. The ledger spec (`spec/cost-model.md`, line 158) shows `bytes_written: 20_000`, which disagrees with the code; the code value is used here. These are initial limits; the limits in force on Preprod are not established (the indexer endpoint was decommissioned, per the expressiveness findings, section 7 item 1).
- Persistent write and delete costs are computed globally at transaction end from `charged_keys`, with garbage-collection credit bounded by `gc_limit(added_cost)` (`ledger/storage/src/delta_tracking/mod.rs`, `ledger/onchain-state/src/state.rs`, `ledger/onchain-runtime/src/context.rs`). I found no cap on a contract's total state size.

### 2.2 Observed

| Probe | Result |
| --- | --- |
| Depth-2 `HistoricMerkleTree`, insert 5 leaves | Inserts 1 to 4 succeed (`isFull` true after the fourth). Fifth fails with `Error: exceeded structure bounds`. `firstFree` stays 4. |
| `retire` (`insertIndexDefault`) at index 1 of a depth-32 historic tree holding 4 leaves | `firstFree` unchanged (4); the root changes; a history entry is added (5 to 6 roots); the pre-retire root stays valid in the historic tree. This is the stale-root hazard for any lifecycle that overwrites slots. |
| Reuse of the retired slot with `insertHashIndex` | Succeeds, `firstFree` unchanged (4); another history entry. |
| `insertHashIndex` at index 10 (beyond `firstFree`) | `firstFree` becomes 11 (it moves to `index + 1`). A later `insert` lands at 11. |
| `resetToDefault` | `firstFree` 0, history length 1. |
| Plain `MerkleTree` | Old root becomes invalid after the next insert; the new root is valid. |
| In-circuit use of `root()` | Compile error: `HistoricMerkleTree root is a runtime-only method, but was invoked in-circuit`. |
| In-circuit use of `firstFree()` | Compile error: `operation firstFree undefined for ledger field type HistoricMerkleTree<32, Bytes<32>>`. |

### 2.3 Derived: what drives the leaf count

- Under "every balance change retires a leaf and adds one" with private retirement, leaves grow by one per contribute or withdraw transaction. Time passing does not add leaves, because outstanding principal carries into each Draw Interval without participant action (CONTEXT.md, Draw Interval). The partial-interval weight question is a separate ticket.
- The Contribution Bound (1,000 tMIX per identity, 1 tMIX minimum new contribution) bounds live notes per identity only if every note is at least the minimum and withdrawals do not leave smaller remainders as separate notes. Withdrawals "may leave any nonnegative remainder", so I cannot derive a bound on live notes per identity from it. Churn (contribute then withdraw repeatedly) is not bounded by the Contribution Bound at all. What limits churn is transaction cost and fees; fee levels were not examined. Not established.

### 2.4 Derived: time to exhaust 2^32 slots

N = 4,294,967,296. Years = N / (leaves per second x 31,557,600).

| Sustained inserts into this tree | Years to fill | Assumption source |
| --- | --- | --- |
| 1 per second | 136 | arithmetic |
| 10 per second | 13.6 | arithmetic |
| 100 per second | 1.36 | arithmetic |
| Whole-chain write limit, historic tree, 193 B per leaf (serialized-size slope at 10,000 leaves): 259 per block, 43 per second | about 3.2 | `bytes_written` 50,000 per 6 s block; per-leaf bytes Observed (proxy, see 6.2) |
| Whole-chain write limit, plain tree, 85 B per leaf: 588 per block, 98 per second | about 1.4 | same |
| Whole-chain `block_usage` limit, if one insert transaction uses 5 KB: 40 per block | about 20 | transaction size is an assumption, not measured |
| Same, 10 KB per transaction: 20 per block | about 41 | assumption |

The last five rows assume the whole chain's block capacity goes to this one tree, so they are lower bounds on lifetime for the capacity-limited case. A 6 s block time is assumed from the earlier research; I did not re-verify it. In-circuit compute is not binding: one insert measured about 1.3 to 1.4 ms of compute time per call in the runtime's gas model against a 1 s per-block budget.

### 2.5 Options for the lifecycle

| Option | What happens on a balance change | What bounds growth | Compaction without participant action | Costs and leaks |
| --- | --- | --- | --- | --- |
| **L1. Append-only, private nullifier retirement** | Spend nullifier published privately; new leaf appended | Depth 32 and chain throughput only; one slot per balance change, permanently | No. Dead leaves are not identifiable by anyone but the owner (Derived). Only a full reset (`resetToDefault`) reclaims space, and that discards live leaves, which only owners can re-add. | Cheapest circuit (appendOnly: 303 rows). Dead leaves dilute `n`. Griefing by churn consumes slots permanently; fee cost of an attack not established. Full tree is a hard stop (insert fails). |
| **L2. In-place replacement at a public slot** | Owner proves ownership of the old leaf at slot `s` against the current root and overwrites it (`insertHashIndex`) | Number of notes ever opened (new slots only for new notes); holes appear when notes close | Yes, if closing a note is public: any party can run a move-last-into-hole step. Owners must refresh their stored index and path from public state, which is a wallet sync, not a transaction. | Leaks slot `s`: links the creation transaction and the replacement transaction of the same note. Requires a current-root check (twin plain tree) because a historic tree would accept a stale root with the old leaf. replaceInPlace: 4,831 rows (Observed). moveLastIntoHole: 7,547 rows (Observed). Needs a public live-count counter. |
| **L3. Public retirement mark plus compaction or rejection** | Owner publicly writes the default leaf at `s` (`insertIndexDefault`), then appends a fresh leaf for the new balance | Live notes plus holes not yet compacted | Yes, same as L2: the hole is public, so move-last-into-hole is permissionless | Same linkage leak as L2 (slot closed is public). Two circuits per balance change. Alternatively leave holes and have the finalizer skip dead candidates (section 4.4): 3,500 rows per candidate. |
| **L4. Epoch or double-buffered trees** | Live leaves are copied into a fresh tree; the old tree is reset | Live notes per epoch | Only if live leaves are identifiable (public retirement, as in L3). With private retirement, copying everything keeps the dead ones; owner re-commit is required. | Migration is O(live) permissionless transactions per epoch, each carrying a path witness and a current-root check on the old tree (moveLastIntoHole: 7,547 rows is the closest measured shape). Compiles: `Map<Uint<64>, MerkleTree<8, Bytes<32>>>` with `insertDefault`, `lookup(..).insertHash`, `lookup(..).checkRoot` (Observed: compile only; creation of entries at runtime not run). Claims against an old interval need the claimant's old path after the old tree is reset; where it comes from is not established (see 5.3). |

Under L2 and L3, "permissionless compaction" depends on one thing: the hole being public. That moves the linkage cost from the compaction step to the retirement step. How much that linkage matters depends on what the creation and withdrawal transactions already reveal under the privacy model of ADR 0007/0008; I did not assess it.

## 3. Q2. How are retired leaves excluded from, or accounted for in, `n`?

### 3.1 Derived

- 6B picks an index uniformly in `[0, n)`; the owner of a live leaf `i` accepts with probability `w_i / W_max`. Per try, P(award) = sum over live `i` of `(1/n)(w_i/W_max)` = `f * (mean live w / W_max)`, where `f = live/n` and `1/(1+d)` when `d` is dead leaves per live leaf.
- Dead leaves contribute zero, so the shares among live leaves stay proportional to weight. Dilution lowers the chance an award occurs in the allowed tries, not fairness among live leaves.
- Illustration (arithmetic only): `f = 0.1`, mean `w/W_max = 0.5` gives 0.05 per try; with 64 tries, P(no award) = 0.95^64, about 3.7 percent. The number of tries a finalizer may take is a separate design parameter that is not fixed anywhere I read.

### 3.2 Options

| Option | How `n` treats retired leaves | Cost |
| --- | --- | --- |
| **N1. `n` = all leaves ever inserted** (L1) | Dead leaves stay in `n`; success per try shrinks as dead leaves accumulate | Free to maintain; unbounded dilution; an adversary can lower the award rate by churning |
| **N2. `n` = live leaves, dense** (L2/L3 with compaction) | Exact; holes compacted | Compaction steps (7,547 rows each, measured shape); a live counter; current-root twin tree |
| **N3. `n` = leaves incl. holes; public rejection of dead candidates** (L3 without compaction) | Finalizer proves each candidate slot against the pinned root and skips default leaves; success per try still scales with the live fraction but each failed candidate is skipped inside one proof | Measured: `finalizeResample4` 14,143 rows (k=14); `finalizeResample8` 28,203 rows (k=15). Marginal cost about 3,500 rows per candidate. Fails (cannot finalize) only if all K candidates are dead, probability (dead fraction)^K. |

## 4. Q3. What can the "five eligible commitments" check count?

### 4.1 Documented

- CONTEXT.md: Disclosure Cohort is "the minimum of five eligible commitments required before a draw may disclose exact aggregate values or select a winner. Commitments are not proof of five distinct people". Participant Identity is "a deployment-scoped cryptographic participant credential preserved across that participant's notes ... The Contribution Bound applies to this identity."
- `midnight/PrizePool.compact` today: `participantCount` is incremented on first contribution by an identity and never decremented; `contribute` rejects when `participantCount` reaches `disclosureCohort` (5); `finalize` requires `participantCount == disclosureCohort` and a distinct five-vector cohort. The count is over public identity keys, not commitments in a tree.

### 4.2 Derived

- A circuit sees only public state and the caller's own private state, so a third party cannot count distinct live private notes. Any "five" must come from public events or from a proof in which all five owners take part.
- A raw leaf count (firstFree mirrored by a `Counter`, since `firstFree()` is not callable in-circuit) counts notes ever created. One participant who contributes five times reaches 5. Under split notes, even a live-note count is not a count of identities. Identity de-duplication across notes belongs to the deferred account-state design (Participant Identity), not to the tree lifecycle.
- If a single circuit takes an optional private retirement, an observer cannot tell a new participant's entry from a balance change, so the public counter cannot count entries. Counting entries requires the circuit shapes to differ, which publishes which transactions are entries.

### 4.3 Options

| Option | What it counts | Cost |
| --- | --- | --- |
| **C1. Raw leaf counter** | Notes ever created (dead included) | Cheap (+160 rows on an insert, Observed `appendSnapshotCount` 463 vs `appendOnly` 303). One participant can reach five. Not a cohort in any useful sense. |
| **C2. Public identity registry plus counter** (current five-slot semantics) | Distinct public identity keys that ever contributed; never decrements | Independent of the tree. Identities are public. Whether "eligible" should mean "currently holds principal at the cutoff" is not settled by the current contract. |
| **C3. Live-note counter by transaction shape** (new-entry circuit increments, retire decrements) | Live notes (L2/L3 only; L1 cannot decrement) | One counter and distinct entry/retire circuits. Counts notes, not identities. Entry transactions are identifiable. |
| **C4. In-circuit distinct count of K claimed leaves** | K distinct leaves proven live against a pinned root | About 3,500 rows per member path (Observed in the resample probe, which includes root equality and index derivation). Requires all K owners' private witnesses in one proof, so it cannot be a permissionless step. Proves distinct leaves, not distinct identities, unless leaves carry a per-identity tag, which is the registry in C2 by another route. |

## 5. Q4. Recording the root and `n` at the cutoff

### 5.1 Documented

- `HistoricMerkleTree.checkRoot` is membership in the stored set of past roots; `MerkleTree.checkRoot` compares to the current root only. `root()` and `firstFree()` are not callable in circuits (see 2.1 and 2.2 for the compile errors).
- Midnight docs warning on removals and replacement: see 2.1.

### 5.2 Observed relation sizes (mock-compile rows, pinned zkir; each claim relation has a transientCommit leaf binding, a path-index fold, a root test, `selU < w`, and a nullifier insert)

| Circuit | Rows | k |
| --- | --- | --- |
| appendOnly (insert + counter increment) | 303 | 9 |
| appendSnapshotCount (lazy `n` snapshot, then insert) | 463 | 9 |
| appendSnapshotRoot (lazy pinned root via twin tree `M.checkRoot(prev)`, then insert into both trees) | 487 | 9 |
| claimHistoric (any past root) | 8,405 | 14 |
| claimPinned (equality with pinned root) | 8,473 | 14 |
| claimPrefix (index below recorded `n`, any past root) | 8,503 | 14 |
| moveLastIntoHole | 7,547 | 13 |
| replaceInPlace | 4,831 | 13 |
| finalizeResample4 / finalizeResample8 | 14,143 / 28,203 | 14 / 15 |

The claim cost of binding is small next to the membership path itself: +68 rows (pinned root) or +98 rows (prefix check) over the unbound claim.

### 5.3 Options

| Option | How the claim binds to the cutoff | Valid when | Costs |
| --- | --- | --- | --- |
| **R1. Append-only prefix** | Record `n_c` at the cutoff. Claim requires selected index `< n_c` and membership in any stored root (historic tree). | Leaves are never overwritten after insertion (L1). Derived: a slot below `n_c` never changes, so any root that contains it contains the same leaf; sampled indices are below `n_c`, so post-cutoff leaves cannot be selected. | Claim +98 rows. Claimant uses an ordinary current path. Needs `n_c` recorded anyway because it is the sampling modulus. Needs the history to stay available (no `resetHistory` before claims close). |
| **R2. Pinned root, twin plain tree** | At the first insert after cutoff, the caller supplies the previous root; a plain `MerkleTree` twin checks `checkRoot(prev)` (current root only) and the circuit stores it per interval. Claim tests root equality, so the historic tree is not needed. | Required whenever slots can be overwritten (L2, L3, L4). | Insert +184 rows at the crossing (and the twin tree doubles the per-leaf state: about 85 B per leaf, section 6). Claimant must reconstruct the path against the historic root, which is O(n) hashing from the current leaves (append-only) or from archived history (after overwrites); where a wallet gets historic tree states is not established. The crossing transaction depends on the exact current root, so two such transactions built concurrently conflict (Derived from how transcript guards work; not run on a node). |
| **R3. Per-interval trees** | One tree per interval in a `Map<Uint<64>, MerkleTree<...>>`; claims check that interval's tree | Only if the interval's tree is populated from the live set | Observed: the shape compiles. The live set is private under L1, so copying it requires owner action (violates carry-over, Derived). With public retirement it needs an O(live) migration per interval (L4 cost). |
| **R4. Any past root, no pinning** | Historic `checkRoot` as is | Sound only if no leaf is replaced or removed and the selected index is bounded by `n_c`; otherwise a stale root with an old leaf validates (Documented warning) | No extra rows. Becomes R1 once the index bound is added. |

How the snapshot is taken (applies to R1 and R2): a circuit cannot read the root or `firstFree`, so `n_c` is either mirrored by a `Counter` (read inside the circuit with `count.read()`) or the root is supplied by the caller and verified. A snapshot taken lazily on the first insert after the cutoff reads state inside the transaction, so a concurrent insert between building and applying invalidates it (Derived from the fact that a transcript records the read value; not run on a node). A separate permissionless `checkpoint(interval)` is correct only if every insert path performs the same snapshot-before-insert check; otherwise a checkpoint called late would include post-cutoff inserts (Derived). When no transaction occurs across several cutoffs, the first later transaction must backfill several intervals; a bounded backfill rule was not worked out (Not established).

## 6. Q5. Consequences of history growth

### 6.1 Observed (growth probe, 10,000 `insertHash` calls on `HistoricMerkleTree<32, Bytes<32>>` plus a `Counter`, other small trees constant)

| Leaves | Serialized contract state (bytes) | History roots |
| --- | --- | --- |
| 0 | 706 | 1 |
| 1 | 2,186 | 2 |
| 10 | 4,162 | 11 |
| 100 | 20,195 | 101 |
| 1,000 | 181,828 | 1,001 |
| 5,000 | 953,155 | 5,001 |
| 10,000 | 1,920,795 | 10,001 |

- Slope: about 180 B per leaf from 100 to 1,000 leaves, about 193 B per leaf averaged to 10,000.
- A plain `MerkleTree<32>` in a separate probe contract: 174 B empty, 86,355 B at 1,000 leaves, about 85 B per leaf. The two probes use different contracts, so the difference of roughly 95 B per leaf is suggestive of history overhead but is not isolated.
- `checkRoot` gas at 10,000 stored roots: identical for the current root and the oldest root (read time 0.68 ms, compute time 1.77 ms). I did not measure it at smaller sizes, so I cannot say whether it is flat across sizes.
- `insertIndexDefault` (retire) at 10,000 leaves adds a history root (10,002) and left `firstFree` at 10,000. The runtime gas for that call was about 4.1 ms read and 7.4 ms compute.
- `resetHistory` at 10,000 roots: serialized state fell from 1,920,889 to 1,820,468 B (about 100 KB, about 10 B per root), history length became 1, `firstFree` unchanged, and the oldest pre-reset root became invalid. This reclaimed far less than the 95 B per leaf implied by the plain-tree comparison. I do not know why; the two observations are not reconciled. Not established.
- Local runtime wall-clock for a simulated insert grew with state size: about 12 ms per insert up to 1,000 leaves, about 21 ms from 1,000 to 5,000, about 60 ms from 5,000 to 10,000 (396 s total). This is the JS mock executing against a locally held state on one workstation. It says nothing about node cost, but a client that simulates a call against full state pays this growth.

### 6.2 Interpretation caveats

- The JS gas figures report `bytesWritten` equal to `bytesDeleted` and vary between 180 and 1,456 bytes per insert across sizes. They reflect the VM's logging churn and are not a measure of persistent growth. Serialized state size (which includes bookkeeping) is used as the proxy for persistent growth and the rate table in 2.4 inherits that proxy.
- Documented: the ledger charges persistent writes per `bytes_written` against a block budget, with GC credit bounded by `gc_limit`. I did not find a per-contract ceiling or an automatic pruning of the root set. That a `resetHistory` call must be made by a circuit (anyone who can call it, unless guarded) is Derived from the ADT being callable in a circuit.

### 6.3 Options for history

| Option | Effect | Cost |
| --- | --- | --- |
| **H1. Keep full history** (historic tree, R1) | Any past root valid; claims need no coordination | About 10 B per root of reclaimable history by the one reset observation, but 180 to 193 B per leaf in total state; state grows monotonically; client simulation slows with size |
| **H2. Plain tree plus pinned roots per interval** (R2) | Only current root valid; per-interval pinned digests (32 B each) | Claimants need old paths; every insert path interacting with claims needs care; crossing transaction contention |
| **H3. Periodic `resetHistory`, guarded** | Drops all but current root; reclaims about 10 B per root (observed once) | Invalidates every unclaimed proof built against a past root; incompatible with R1 unless claims for all open intervals are complete or pinned digests are used instead |
| **H4. Epoch rollover** (L4) | Resets the tree and history together | Migration cost and old-path problem in L4 |

## 7. Not established

1. The ledger parameters in force on Preprod (block limits, fee prices); only `INITIAL_LIMITS` at ledger 8.1.0 was read. The ledger spec disagrees with the code on `bytes_written` (20,000 vs 50,000).
2. Whether any ledger-side pruning or cost ceiling applies to a contract's history set or total state beyond the general cost model. None found; none ruled out.
3. Persistent (on-chain) growth per leaf; only serialized size from the JS runtime was measured. The history-versus-tree split is unreconciled (6.1).
4. Real transaction sizes for insert and claim calls, which determine the `block_usage` row in 2.4. Not measured.
5. Fees for churn and the cost of a slot-exhaustion or dilution attack.
6. Whether wallets or the indexer can produce a path against a past root (R2) or against an archived tree (L4) without the claimant holding its own history.
7. Runtime behaviour on a node of the lazy-snapshot read dependency and of the twin-tree root check under concurrent transactions; claimed only from how transcripts work.
8. A backfill rule for several missed cutoffs in a row.
9. Runtime creation and use of `Map<Uint<64>, MerkleTree<...>>` entries (only compile checked).
10. How much linkage between creation and retirement transactions (L2, L3) matters under the privacy model (ADR 0007/0008); not assessed.
11. Proving time and memory for the measured circuit sizes (k=13 to 15); only mock-compile was run.

No option is recommended here. Choices belong to the maintainer through the wayfinder map in #49.

## Appendix A. Reproduction

Environment: Node with the repository's `node_modules` (pinned `@midnight-ntwrk/compact-runtime` 0.16.0), `compact compile +0.31.1 --skip-zk <src> <outdir>`, `~/.compact/versions/0.31.1/aarch64-darwin/zkir mock-compile-many <outdir>/zkir`. Each source begins with `pragma language_version >= 0.23.0; import CompactStandardLibrary;`. The JS harnesses import `<outdir>/contract/index.js`, build the state with `contract.initialState(RT.createConstructorContext({}, '0'.repeat(64)))`, and run each circuit with `RT.createCircuitContext(addr, coin, state, {})`, carrying `result.context.currentQueryContext.state` forward.

### A.1 Growth probe (`growth.compact`; harness loops `add(leaf_i)` with `leaf_i = sha256("leaf" + i)` and records `ContractState.serialize().length` at marks)

```compact
export ledger leaves: HistoricMerkleTree<32, Bytes<32>>;
export ledger leafCount: Counter;
export ledger small: HistoricMerkleTree<2, Bytes<32>>;
export ledger smallPlain: MerkleTree<2, Bytes<32>>;
export circuit add(h: Bytes<32>): [] { leaves.insertHash(disclose(h)); leafCount.increment(1); }
export circuit addAt(h: Bytes<32>, i: Uint<64>): [] { leaves.insertHashIndex(disclose(h), disclose(i)); }
export circuit retire(i: Uint<64>): [] { leaves.insertIndexDefault(disclose(i)); }
export circuit resetHist(): [] { leaves.resetHistory(); }
export circuit resetAll(): [] { leaves.resetToDefault(); }
export circuit addSmall(h: Bytes<32>): [] { small.insertHash(disclose(h)); smallPlain.insertHash(disclose(h)); }
export circuit chk(r: MerkleTreeDigest): Boolean { return disclose(leaves.checkRoot(disclose(r))); }
export circuit chkSmallPlain(r: MerkleTreeDigest): Boolean { return disclose(smallPlain.checkRoot(disclose(r))); }
export circuit full(): Boolean { return disclose(small.isFull()); }
```

After the inserts the harness calls `chk` with `ledger(state).leaves.root()` and with the first element of `ledger(state).leaves.history()`, then `retire(5)`, then `resetHist`, then `chk` with the oldest root. The plain-tree comparison is a separate contract with `P: MerkleTree<32, Bytes<32>>` and `addPlain`. The depth-2 fill (`small`/`smallPlain`) is run by inserting five leaves through `addSmall` and then exercising `addAt`/`retire` on the larger tree.

### A.2 Lifecycle and claim relations (`lifecycle.compact`)

```compact
export ledger H: HistoricMerkleTree<32, Bytes<32>>;   // history-tolerant tree
export ledger M: MerkleTree<32, Bytes<32>>;           // twin: checkRoot compares with the CURRENT root only
export ledger count: Counter;                         // mirror of first-free (firstFree is TypeScript-only)
export ledger live: Uint<64>;
export ledger cutoffAt: Uint<64>;
export ledger nAtCutoff: Map<Uint<64>, Uint<64>>;
export ledger rootAtCutoff: Map<Uint<64>, MerkleTreeDigest>;
export ledger claimed: Set<Bytes<32>>;
export ledger selIndex: Uint<64>;
export ledger selU: Uint<64>;

witness wpath(): MerkleTreePath<32, Bytes<32>>;
witness wweight(): Uint<64>;
witness wsecret(): Bytes<32>;
witness wprevRoot(): MerkleTreeDigest;

circuit pathIndex(p: MerkleTreePath<32, Bytes<32>>): Uint<64> {
  const idx = fold((acc: [Uint<64>, Uint<64>], e: MerkleTreePathEntry): [Uint<64>, Uint<64>] =>
      [ (acc[0] + (e.goes_left ? 0 : acc[1])) as Uint<64>, (acc[1] * 2) as Uint<64> ],
      [0 as Uint<64>, 1 as Uint<64>], p.path);
  return idx[0];
}

export circuit appendOnly(h: Bytes<32>): [] { H.insertHash(disclose(h)); count.increment(1); }

export circuit appendSnapshotCount(h: Bytes<32>, interval: Uint<64>): [] {
  const cut = disclose(cutoffAt);
  if (blockTimeGt(cut) && !nAtCutoff.member(disclose(interval))) {
    nAtCutoff.insert(disclose(interval), count.read());
  }
  H.insertHash(disclose(h));
  count.increment(1);
}

export circuit appendSnapshotRoot(h: Bytes<32>, interval: Uint<64>): [] {
  const cut = disclose(cutoffAt);
  if (blockTimeGt(cut) && !rootAtCutoff.member(disclose(interval))) {
    const prev = wprevRoot();
    assert(M.checkRoot(disclose(prev)), "prev root is the current root");
    rootAtCutoff.insert(disclose(interval), disclose(prev));
  }
  H.insertHash(disclose(h));
  M.insertHash(disclose(h));
  count.increment(1);
}

export circuit claimHistoric(): [] {
  const w = wweight();  const s = wsecret();
  const leaf = transientCommit<Uint<64>>(w, s as Field);
  const p = wpath();
  assert(p.leaf == upgradeFromTransient(leaf), "leaf binds weight and secret");
  assert(pathIndex(p) == selIndex, "selected index");
  assert(H.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  assert(selU < w, "accepted");
  claimed.insert(disclose(persistentHash<[Bytes<32>, Bytes<32>]>([s, pad(32, "claim")])));
}
```

`claimPinned(interval)` replaces the `H.checkRoot` line with `assert(merkleTreePathRootNoLeafHash<32>(p) == rootAtCutoff.lookup(disclose(interval)), ...)`. `claimPrefix(interval)` keeps `H.checkRoot` and adds `assert(selIndex < nAtCutoff.lookup(disclose(interval)), ...)`.

```compact
export circuit moveLastIntoHole(hole: Uint<64>): [] {
  const p = wpath();
  const last = (live - 1) as Uint<64>;
  assert(pathIndex(p) == last, "path is for the last live index");
  assert(M.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "current root");
  H.insertHashIndex(disclose(p.leaf), disclose(hole));
  M.insertHashIndex(disclose(p.leaf), disclose(hole));
  H.insertIndexDefault(disclose(last));
  M.insertIndexDefault(disclose(last));
  live = last;
}

export circuit replaceInPlace(slot: Uint<64>, newLeaf: Bytes<32>): [] {
  const w = wweight();  const s = wsecret();
  const leaf = transientCommit<Uint<64>>(w, s as Field);
  const p = wpath();
  assert(p.leaf == upgradeFromTransient(leaf), "owner of the old leaf");
  assert(pathIndex(p) == slot, "slot");
  assert(M.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "current root");
  H.insertHashIndex(disclose(newLeaf), disclose(slot));
  M.insertHashIndex(disclose(newLeaf), disclose(slot));
}
```

### A.3 Public rejection of retired slots (`resample.compact`)

```compact
export ledger rootAtCutoff: Map<Uint<64>, MerkleTreeDigest>;
export ledger selIndex: Uint<64>;
witness wpaths4(): Vector<4, MerkleTreePath<32, Bytes<32>>>;
witness wcands4(): Vector<4, Uint<64>>;
// pathIndex as in A.2

circuit step(acc: [Uint<64>, Boolean], p: MerkleTreePath<32, Bytes<32>>, c: Uint<64>, pinned: MerkleTreeDigest): [Uint<64>, Boolean] {
  assert(merkleTreePathRootNoLeafHash<32>(p) == pinned, "root");
  assert(pathIndex(p) == c, "index");
  const alive = p.leaf != pad(32, "dead");
  const take = !acc[1] && alive;
  return [take ? c : acc[0], acc[1] || alive];
}

export circuit finalizeResample4(interval: Uint<64>): [] {
  const pinned = rootAtCutoff.lookup(disclose(interval));
  const paths = wpaths4();  const cands = wcands4();
  const r = fold((acc: [Uint<64>, Boolean], p: MerkleTreePath<32, Bytes<32>>, c: Uint<64>): [Uint<64>, Boolean] =>
      step(acc, p, c, pinned), [0 as Uint<64>, false], paths, cands);
  assert(r[1], "all tries retired");
  selIndex = disclose(r[0]);
}
```

`finalizeResample8` is the same with `Vector<8, ...>`. The probe treats a leaf equal to `pad(32, "dead")` as retired; real retirement through `insertIndexDefault` writes the tree's default leaf, whose byte value was not checked against this constant. Not established.

### A.4 Compile failures and the nested-tree compile check

- `export circuit readRoot(): [] { out = H.root().field; }` fails: `HistoricMerkleTree root is a runtime-only method, but was invoked in-circuit`.
- `export circuit readFirstFree(): [] { out = H.firstFree(); }` fails: `operation firstFree undefined for ledger field type HistoricMerkleTree<32, Bytes<32>>`.
- `export ledger perInterval: Map<Uint<64>, MerkleTree<8, Bytes<32>>>;` with circuits calling `perInterval.insertDefault(i)`, `perInterval.lookup(i).insertHash(h)`, and `perInterval.lookup(i).checkRoot(r)` compiles at 0.31.1.

### A.5 Sources read

- Compact `compactc-v0.31.1`: `doc/ledger-adt.mdx`, `compiler/midnight-ledger.ss` (HistoricMerkleTree ADT, around lines 1127 to 1340).
- `midnight-ledger` `ledger-8.1.0`: `ledger/src/structure.rs` (limits, cost functions), `storage/src/delta_tracking/mod.rs`, `onchain-state/src/state.rs`, `onchain-runtime/src/context.rs`, `onchain-vm/src/vm.rs`, `spec/cost-model.md`, `spec/storage-io-cost-modeling.md`.
- Repository: `midnight/PrizePool.compact`, `midnight/CONTEXT.md`, ADRs 0003, 0006, 0007, 0008, 0013, 0015, 0027 (branch) and 0028, 0029, 0030 (maintainer checkout), and branches `research/candidate-screening`, `research/unbiased-sampling`, `research/compact-hidden-state-expressiveness` (read with `git show`, not merged).
