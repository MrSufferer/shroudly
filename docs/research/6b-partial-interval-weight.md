# How family 6B can prove time-weighted partial-interval weight

Research for [#55](https://github.com/MrSufferer/shroudly/issues/55), a research ticket on the wayfinder map in [#49](https://github.com/MrSufferer/shroudly/issues/49). Date: 2026-10-17. Toolchain: Compact compiler 0.31.1, language 0.23.0, runtime `@midnight-ntwrk/compact-runtime` 0.16.0, ledger sources at tag `ledger-8.1.0` (`midnight/version-profile.json`).

The question: how can family 6B (public-index sampling with owner-side acceptance `u < w`) prove `w = balance x overlap(note lifetime, Draw Interval)` without linking nullifiers to leaves or disclosing timing? This file reports the constructions a Compact circuit can verify on the pinned profile, what each discloses publicly, and how full withdrawal keeps elapsed weight while giving zero future weight. It makes **no recommendation** and chooses nothing. Decisions belong to the maintainer; 6B is a candidate, not accepted (#53).

Every claim carries one tag.

- **Documented**: stated by a primary source I read; the source is named.
- **Observed**: produced by running the pinned compiler 0.31.1 (`compact compile +0.31.1 --skip-zk`), its bundled `zkir mock-compile`, or the generated contract code under `compact-runtime` 0.16.0 on a probe in the appendix. `mock-compile` reports circuit rows and `k` only. **No proof was generated and no proof server ran.** Executed probes are local simulations: the client chooses the simulated block time, so they show what a circuit and its transcript contain, not what the network accepts.
- **Derived**: my own reasoning from tagged facts, stated so it can be checked or rejected.
- **Not established**: could not be settled from primary sources (section 8).

## 1. Inputs taken as given

Not re-derived here.

- **The relation** (screening findings, sections 4.6 and 5.1 item 4). Leaves are insertion-ordered, one per note. At settlement the contract publishes a leaf index `i` and an acceptance draw `u` in `[0, W_max)`. The owner of leaf `i` proves at claim time that the leaf is theirs, was valid in the interval, and `u < w`. The unconditional award probability per try is `(1/n)(w_i / W_max)`. Screening probe B measured the claim relation at 8,405 rows, k=14, with the index binding and without any time arithmetic.
- **Domain terms** (`midnight/CONTEXT.md` on the maintainer checkout; this worktree's copy lacks the Draw Interval entries). *Draw Interval*: "A fixed UTC period over which one Prize Draw's selection weights are computed independently. Principal that remains outstanding carries into each subsequent Draw Interval without participant action." *Unresolved Interval*: "A closed Draw Interval whose Prize Draw has been neither finalized nor cancelled. Its weights remain valid, and it never prevents a safe Principal withdrawal." *Time-Weighted Principal*: "accrues from confirmed contribution until confirmed withdrawal; weight already accrued during a draw remains valid without locking Principal." *Private Participant Data* includes "the participant's identity and linkages, individual balance and action amounts, selection weight" and states "Public contract activity must not be described as hiding its own occurrence or timing."
- **Preprod constants** (ADR 0027/0028, #51): Draw Interval 900 s; Contribution Bound 1 to 1,000 `tMIX` (10^6 to 10^9 micro-units); so one interval's maximum weight `W_max = 10^9 x 900 = 9 x 10^11`, which fits `Uint<64>`.
- **Time-source limits** (ADR 0030, `docs/midnight-stack-review.md` lines 163 to 169 and 178 to 183): "Network predicates must enforce the clock without browser/operator time authority or an assumed raw block-time accessor"; the official guidance describes "block-time comparison predicates, no raw block-time accessor, and block-scale timing accuracy." ADR 0006 (public Winning Commitment stays public) is not touched by anything below.
- **Compact expressiveness rules** (`research/compact-hidden-state-expressiveness`, sections 2, 5 and 6): arguments of ledger operations are public and need `disclose`; a branch whose body writes the ledger needs a disclosed condition; `checkRoot` on a `HistoricMerkleTree` discloses the root (not the leaf); a write position is a public argument; a circuit cannot read another user's private state and cannot enumerate ledger collections; there is no non-membership primitive in the ADT list.

## 2. What the time source gives a circuit

1. **Documented** (Compact 0.31.1 `doc/ledger-adt.mdx`, kernel section): `blockTimeGreaterThan(time: Uint<64>)` and `blockTimeLessThan(time: Uint<64>)` are the only time operations; each returns a Boolean for "the current block time (measured in seconds since the Unix epoch)" against the given value. `compiler/standard-library.compact` (tag `compactc-v0.31.1`) builds `blockTimeLt/Lte/Gt/Gte` from them. The official security guidance says "There is no raw block-time accessor" and "Treat a time gate as accurate to the scale of blocks, not seconds" (`midnight-docs` `docs/guides/security-best-practices.mdx`, via `npx ctx7@latest docs /midnightntwrk/midnight-docs`).
2. **Documented** (`compiler/midnight-ledger.ss` at the same tag): both operations are `read` operations. They compare the supplied value to element 2 of the call context (`tblock`) and record the Boolean as a cached `popeq` result in the public transcript. The compiler annotates the argument as disclosed ("discloses the lower bound of the time being checked" for `blockTimeLessThan`, "the upper bound" for `blockTimeGreaterThan`). The call context carries `tblock_err` at element 3 but neither predicate reads it (Documented in source; `onchain-runtime/src/context.rs` at `ledger-8.1.0` lists the context array order).
3. **Documented** (`midnight-ledger` `spec/contracts.md`, ledger-8.1.0): "The call context is in part derived from a block context, given at application time." Derived: the Boolean is recorded at proof time and re-evaluated by the ledger against the block context in which the transaction is applied, so the predicate constrains the block that includes the transaction, not the client's clock. A transaction built near a bucket edge can therefore fail if it lands in a later block. I did not test this on a network.
4. **Observed**: a predicate argument computed from a witness is rejected without `disclose` ("the call to standard-library circuit blockTimeLt might disclose the lower bound of the time being checked", probe Neg1). The transcript of a call that uses `blockTimeGte(lo)` and `blockTimeLt(lo+60)` contains `lo` and `lo+60` as cell values (probe `createC1`, ops 2 and 7: bytes `d007` = 2000 and `0c08` = 2060).
5. **Derived**: since the only time operations are the two predicates, any time value stored in the ledger or kept in a note is a value the caller supplied and the circuit constrained with predicates. I found no other time operation in the compiler's kernel list (`midnight-ledger.ss`, kernel functions) or the standard library.

Consequences (Derived):

- A time value used in a ledger operation or predicate is public to the precision of the predicate bounds. A time value used only in circuit arithmetic (as in the claim) is private.
- The transaction that creates or retires a note is itself public, applied in a known block. Its occurrence and approximate time are public whatever the circuit does (`midnight/CONTEXT.md`, Private Participant Data). What the options below differ in is whether *a specific leaf* can be tied to that time or to its retirement transaction.
- The security-relevant direction differs for the two ends. The owner gains by **backdating** creation (earlier `t_c` means more overlap) and by **forward-dating** retirement (later `t_r` means more overlap). A circuit needs a predicate that forbids only those directions. Misdating the other way lowers the owner's own weight. A single predicate per end suffices for soundness against inflation. The probes use two (a bucket) for symmetry.
- A bucket of width `D` seconds bounds the inflation per end at `balance x D`. With the illustrative `D = 60` (a probe constant, not a proposal) and the maximum balance 10^9, that is 6 x 10^10, or 6.7 percent of `W_max`. This bound is separate from the unmeasured accuracy of block timestamps (section 8).

## 3. What the claim has to be convinced of

For interval `j` with public bounds `[s_j, e_j)`, the weight is `w = b x max(0, min(t_r, e_j) - max(t_c, s_j))`, with `t_r` taken as infinity if the note is still live. Observed: this arithmetic (two min/max comparisons, one subtraction, one multiplication) is expressible; the `overlap` circuit in the appendix compiles, and the claim circuits that use it measure 6,138 to 10,064 rows (table 5.1). Inputs `b`, `t_c`, `t_r` are private witnesses. The circuit therefore needs four things to be authentic:

- **(a) Balance and creation time bound to the leaf.** The leaf commitment contains `b` and `t_c`; the claim opens it inside the circuit (as in the screening probe B).
- **(b) The creation time is the true creation time.** Section 4.1.
- **(c) The retirement time, if any, is the true retirement time.** Section 4.2.
- **(d) The note was not retired earlier than the claim states, including "not retired at all".** This is the hard part: it is a statement of absence. Section 4.2.

## 4. Options and what each discloses

### 4.1 Creation time (items a and b)

**C1. Private `t_c` bracketed by block-time predicates in the creating transaction.** The leaf is `transientCommit([b, t_c], secret)`. The creation circuit takes a public bucket start `lo`, asserts `blockTimeGte(lo)` and `blockTimeLt(lo + D)`, and asserts privately `lo <= t_c < lo + D`.

- Observed (probe `createC1`, 1,107 rows, k=11): compiles; with a simulated block time outside the bucket the call fails ("before bucket end"); with `t_c` outside the bucket it fails ("tc in bucket"). The transcript contains the new leaf digest, `lo` and `lo + D`, and the history-root update. It does not contain the secret, the balance bytes or `t_c` (the byte search handles the runtime's trailing-zero trimming).
- Public: the bucket (also visible from the transaction's block), the leaf digest. Private: `b`, exact `t_c` inside the bucket, the secret.
- Cheat bound: `b x D`. Granularity: `D` seconds (public).

**C1-single.** Only the soundness-relevant predicate (`blockTimeLt(t_c + D)`) with `t_c` private. Derived: the same public information (one bound instead of two), same bound. Not compiled separately.

**C2. Creation interval fixed by contract state, no per-leaf time in the leaf.** A permissionless checkpoint circuit advances a stored interval counter using predicates; the creating circuit reads the counter and stamps the leaf with it (or inserts into a per-interval structure). Derived from the documented behaviour that a `Cell` read pins the exact value in the transcript and fails the transaction if it changed (reference, "Ledger-state types", cited in the expressiveness findings): the leaf's creation interval is public, as it is for every option; granularity is the Draw Interval (900 s), and creation contends with the checkpoint. A leaf created at any time inside interval `k` is treated as created at a fixed point of `k` (start or end), so partial weight is quantised. That differs from ADR 0006's "accrued continuously from confirmed contribution"; whether it is acceptable is for the maintainer. Not compiled; the ledger-state mechanics are standard.

**C3. C1 plus a public registry `leaf -> bucket`.** Observed (probe `createC3`, 1,107 rows, k=11, the same count as C1): the registry insert adds no measurable rows. In the executed simulation `leafBucket.lookup(leaf)` returned the bucket. Derived: the claim may read it with the leaf as key, and because the Winning Commitment is already public (ADR 0006) the lookup discloses nothing new; the registry then lets `t_c` be omitted from the leaf. Cost: one stored map entry per leaf (Documented per-block limit `bytes_written` 50,000 in `INITIAL_LIMITS`; not measured against this).

### 4.2 Retirement and "not retired" (items c and d)

A retirement transaction must stop the note from being spent again (nullifier) and record when it ended. The options differ in how the claim learns the retirement time and, separately, how it is convinced the note is *not* retired.

**A. Nullifier-keyed retirement map.** Retirement writes `retiredAt[nf] = bucket`, `nf = H(secret, "nf")`. The claim discloses `nf`, tests `retiredAt.member(nf)`, and uses `lookup(nf)` as `t_r` (or treats it as infinity if absent).

- Observed (probes `retireA`, `claimA`): `retireA` 6,105 rows (k=13), `claimA` 10,064 rows (k=14). `nf` without `disclose` is rejected ("ledger operation might disclose a hash of the witness value", probe Neg2). The executed `claimA` transcript contains `nf`, the history root, and the claim nullifier; it does not contain the leaf or the secret. A second retirement of the same note fails ("not retired").
- Public: at retirement, `nf`, the bucket and the root used; at claim, `nf` and the root.
- Linkage (Derived): the claim binds to the public index `i`, so observers learn that leaf `i` has nullifier `nf`, hence which retirement transaction ended it, when, and, if the retirement transaction also created a successor leaf, which leaf succeeded it. This is a nullifier-to-leaf link for the winner, and it is the thing the ticket asks to avoid. Even when the note is live at claim, the claim discloses `nf`, and the same `nf` will appear later in the retirement transaction, so the link is created at the later retirement (Derived).
- Gives: both enforcement of zero future weight and retention of elapsed weight (section 5).

**R2. Unlinkable retirement record in a Merkle tree.** Retirement inserts `rec = H(secret, t_r)` into a separate tree (`insertHash`) alongside the spend nullifier. The claim proves, privately, that `rec` opens to its leaf's secret and a private `t_r`, and proves membership in the record tree. `checkRoot` discloses only the root.

- Observed (probes `retireR2`, `claimR2`): `retireR2` 8,103 rows (k=13), `claimR2` 9,461 rows (k=14). The executed retirement transcript contains `nf`, `rec`, the bucket and the root; it does not contain the leaf digest or the secret. The executed `claimR2` transcript contains neither `nf`, `rec`, the leaf nor the secret.
- Public: at retirement, `nf`, `rec`, bucket, root. At claim, only roots. The `nf` and `rec` published in one retirement transaction are not linkable to the leaf without the secret (Derived from the hiding of the hash).
- **It is a positive proof only.** It authenticates `t_r` for notes that have a record. Nothing forces a retired note's owner to use it. Observed: `claimNoCheck`, which has no retirement evidence at all, accepts a note that was retired at 2300 for an interval starting at 2700 (appendix). So R2 alone does not give zero future weight; it needs one of the other mechanisms for the "live" branch.
- Branch disclosure (Derived from the expressiveness rule that a conditional ledger write needs a disclosed condition): a circuit that checks the record tree only when the note is retired reveals one bit, whether the winner's note was retired at claim time. A circuit that always checks both would need a fixed set of ledger operations, which needs a live-branch mechanism that does not disclose.
- The record tree grows by one root per insert in a `HistoricMerkleTree` (Documented: history is a map of past roots, cleared only by `resetHistory()`/`resetToDefault()`; unbounded growth effect not established).

**L1. Removal by overwrite at a public index, with cutoff roots.** Retirement calls `insertIndexDefault(index)` (Documented: "This can be used to emulate a removal from the tree"), replacing the leaf by the default. A claim for interval `j` proves membership against the root recorded at the interval's cutoff. A leaf removed before the cutoff is absent from it; a leaf removed after is still present.

- Observed (probes `addLeaf`, `removeL1`): `removeL1` 5,447 rows (k=13). In the executed simulation the leaf's index appears in the retirement transcript as a public cell. After the removal, a path taken before the removal still passes `checkRoot` against the history (the old root remains valid), so claims for closed intervals keep working.
- Public: at retirement, the removed leaf's index (hence the retirement transaction is linked to a specific leaf, and through any successor in that transaction, to the successor leaf, for every observer, for every note, not only winners). At claim, only the root.
- Positive proof of "live at the cutoff" (membership in the cutoff root) without any non-membership proof. Derived: a leaf removed inside the interval is absent from the end-of-interval root, so partial credit for the retirement interval needs a second root (the start-of-interval root, presence at which plus absence at the end shows retirement inside the interval) and still needs `t_r` from a record or map; a leaf both created and retired inside one interval is in neither root.
- Linkage and balance-change pattern: the lineage of every account's notes becomes public. This conflicts with the "linkages" entry of Private Participant Data (Derived by comparing with the glossary text).

**L3. Non-membership in a sparse tree keyed by a nullifier prefix (shape probe).** Retirement writes a marker at slot `prefix32(H(nf))` with `insertHashIndex`; the claim shows the slot holds the blank leaf in the cutoff root.

- Observed (probes `retireL3`, `claimL3`): both compile, 8,363 rows (k=14) and 7,915 rows (k=13). The retirement transcript contains the slot as a public cell (the 32-bit prefix, bytes `7a587b3c` in the run). The claim contains only a root.
- **Blocked in the tooling I used (Observed):** `pathForLeaf` from the generated TypeScript API on `compact-runtime` 0.16.0 cannot produce a path for an unpopulated slot below the tree's first-free index ("invalid index into sparse merkle tree"); it succeeded only for the first free slot. So I could not execute `claimL3` end to end. Whether the ledger or a hand-built path allows it is not established.
- Also not established: the digest of a never-written slot (the probe asserts 32 zero bytes, unverified); and Derived: a 32-bit prefix collides after roughly 2^16 retirements by the birthday bound, so a prefix-only marker would also reject some honest retirements unless handled. With `insertHashIndex` the ADT's first-free index becomes the maximum written slot plus one (Observed: 1014716539 after writing slot 1014716538).
- Public: at retirement, the 32-bit prefix of a hash of the secret (not linkable to the leaf), `nf` if also published; at claim, only the cutoff root.
- Gives (if it works): a private proof of absence as of a recorded root, so a claim need not disclose `nf` or a branch bit.

**N. No retirement evidence.** The claim checks only membership and arithmetic. Observed: `claimNoCheck` (6,138 rows, k=13) accepts a note retired before the interval. Included as the reference showing what the evidence in the other rows buys.

**Not an option I could verify: weight-free exits.** An exit design that changes what a withdrawal means (for example, withdrawal effective only at the next interval boundary, or leaves with a committed lifetime that requires a participant action to renew) changes the product rather than the verifier, and renewal would be a per-draw participant action (K3 in the screening). Listed so it is not mistaken for an omission; not analysed.

## 5. Putting the pieces together

### 5.1 Measurements (Observed, mock-compile only)

| Circuit | What it is | rows | k |
|---|---|---|---|
| `createC1` | creation, predicates bracket private `t_c`, leaf insert | 1,107 | 11 |
| `createC3` | `createC1` plus registry insert | 1,107 | 11 |
| `retireA` | membership, nullifier map insert with bucket | 6,105 | 13 |
| `retireR2` | `retireA` plus record insert | 8,103 | 13 |
| `claimA` | membership, `nf` lookup, overlap, `u < w`, claim nullifier | 10,064 | 14 |
| `claimR2` | membership, record membership, overlap, `u < w`, claim nullifier | 9,461 | 14 |
| `claimNoCheck` | membership, overlap with `t_r` unbounded, `u < w`, claim nullifier | 6,138 | 13 |
| `removeL1` | membership, `insertIndexDefault` at the path's index | 5,447 | 13 |
| `claimL3` | non-membership shape in a sparse tree | 7,915 | 13 |
| `retireL3` | prefix split and marker insert | 8,363 | 14 |
| `setInterval` | writes the interval bounds and `u` (driver helper) | 240 | 8 |

Caveats. Rows exclude custom gates and lookups. These circuits omit the screening probe B's index binding (about 2,179 rows in that probe) and the equality of the root with the stored cutoff root, so a full claim is larger; the sum is Derived and was not measured. Probes use `transientCommit` for the leaf and `persistentHash` for nullifiers and records; other choices change the numbers.

### 5.2 Disclosure by combination

"Winner" means the owner of the selected leaf `i`, which is public (ADR 0006). "Others" means every leaf that is not selected.

| Combination | Public at creation | Public at retirement | Public at claim | Link nullifier/retirement tx to leaf | Zero future weight enforced | Elapsed weight retained |
|---|---|---|---|---|---|---|
| C1 + A | leaf digest, bucket | `nf`, bucket, root | `nf`, root | winner only, at claim (and at later retirement if live at claim) | yes (Observed) | yes (Observed) |
| C1 + R2 alone | leaf digest, bucket | `nf`, `rec`, bucket, root | roots; a branch bit if the record check is conditional | none | **no** (Observed via `claimNoCheck`) | yes for retired notes with a record |
| C1 + L1 (+ record for partial) | leaf digest, bucket | removed leaf index, bucket | root | **all notes**, at retirement | yes (structure of cutoff roots) | yes (Observed: old roots stay valid) |
| C1 + L3 | leaf digest, bucket | 32-bit prefix of a hash of the secret, `nf`, bucket | root | none (not established end to end) | yes if the path is constructible | not established |
| C3 + any of the above | adds a public `leaf -> bucket` entry | as above | as above | as above | as above | as above |
| C2 + any of the above | leaf digest, creation interval | as above | as above | as above | as above | as above |
| C1 + N | as C1 | `nf`, bucket | root | none | **no** (Observed) | yes |

Honesty note on the "link" column: the linkage in A needs one step the probes do not contain, the binding of the claim to the public index `i`. That binding is in the screening's probe B and is what ties the winner's leaf to the claim's `nf`.

### 5.3 How a full withdrawal retains past weight and gives zero future weight

1. **Retention** (Documented and Observed). The tree is append-only; a `HistoricMerkleTree` keeps every past root valid in a map and clears them only on `resetHistory()` or `resetToDefault()`. A claim for a closed interval proves membership against the root recorded at that interval's cutoff, so the retired note's leaf and its `(b, t_c)` stay provable for intervals that ended before retirement. With L1 the removal creates a new root without the leaf; Observed: the pre-removal path still passes `checkRoot` afterwards.
2. **Elapsed weight in the retirement interval** needs `t_r`: from the public map (A), from a private record (R2), or from a public bucket in a removal record (L1). The overlap arithmetic then yields `b x (min(t_r, e_j) - max(t_c, s_j))`.
3. **Zero future weight** needs a statement of absence for the live case, or a presence proof that excludes retired leaves (L1). Observed in the executed simulation (500 `tMIX` note, created in bucket 1000, retired in bucket 2300, `lo`-bucket times in seconds):

| Claim | Interval | Overlap used | Result |
|---|---|---|---|
| `claimA`, retired at 2300 | [1800, 2700) | 500 s, `w` = 2.5 x 10^11 | accepted at `u` = 2.4 x 10^11; rejected at 2.6 x 10^11 |
| `claimA`, same note | [900, 1800) | 790 s from `t_c` 1010, `w` = 3.95 x 10^11 | accepted at `u` = 3.9 x 10^11 |
| `claimA`, same note | [2700, 3600) | 0 | rejected |
| `claimR2`, same note | [1800, 2700) / [2700, 3600) | 500 s / 0 | accepted at `u` = 2.4 x 10^11 / rejected at `u` = 0 |
| `claimA`, live note created at 2017 | [1800, 2700) | 700 s, `w` = 3.5 x 10^11 | accepted at 3.4 x 10^11; rejected at 3.6 x 10^11 |
| `claimA`, same live note | [900, 1800) (before creation) | 0 | rejected |
| `claimNoCheck`, the retired note | [2700, 3600) | treated as live | **accepted** at `u` = 10^9 |

4. After a full withdrawal the leaf remains in the tree as a leaf whose weight is zero for every later interval. Whether retired leaves count in the public `n` of the sampling relation, and what that does to award probability and to the five-commitment Disclosure Cohort, is screening question 5.1 items 5 and 6, not examined here.

## 6. Cross-check against the Compact disclosure rules

| Rule (expressiveness findings) | Where it bites here | Observed or Derived |
|---|---|---|
| Ledger-operation arguments are public; hidden values need `disclose` | Predicate arguments (`lo`, `lo + D`), map keys (`nf`, leaf), `insertHash` arguments, `insertIndex*` positions | Observed (Neg1, Neg2, transcripts) |
| An `assert` is not a disclosure | `tc in bucket`, `u < w`, record opens: private checks that disclose nothing | Observed (executed: failures reveal nothing but a failed proof) |
| `checkRoot` on a historic tree discloses the root | Claim and retirement each reveal which past root they use | Observed |
| A conditional ledger write needs a disclosed condition | Any "retired or live" branch that touches the ledger reveals one bit | Derived from the rule |
| A write position is a public argument | L1 (removal index), L3 (slot) | Observed |
| Another user's commitment gives a later caller no opening | Claims are owner-side; nothing here needs another party's opening | Documented (#50) |
| Commitments "disclose nothing" if `rand` is high entropy | Leaf privacy rests on the secret; not audited here | Documented |

## 7. Things found along the way (not decided)

- **Rounding is a free parameter.** C2 and any bucketed time quantise partial weight. A bucket larger than the cheat bound the maintainer will tolerate is a policy question.
- **Cutoff-root recording.** A circuit cannot read a tree's current root (Documented: `root()` is TypeScript only); the checkpoint must be handed the root and assert `checkRoot` (Derived), which leaves a gap between the cutoff time and the recorded root during which further leaves may be inserted. This is screening item 7; every option with a "cutoff root" inherits it.
- **Public bounds restate the transaction's block time.** The predicate bounds in C1 add nothing an observer could not get from the transaction's own block, to within the bucket width. Whether a bucket narrower than block-timestamp accuracy is meaningful depends on that accuracy (section 8, item 2).
- **Successor notes.** A partial withdrawal retires a note and creates a successor with `t_c = t_r`; if both happen in one circuit call, the transaction itself joins `nf` and the new leaf publicly (Derived). This is account-state design (map: deferred) but it determines how much A or L1 reveals.
- **Winner-side leakage in A is bounded by one note per claim** and does not leak balances or the secret (Observed: the claim transcript has neither). The retirement transaction's own contents (timing, the nullifier, any successor leaf) are public regardless.

## 8. Not established

1. A real proof, proving time or key size for any circuit here. Only compile and `mock-compile` ran.
2. The accuracy and permitted skew of block timestamps on Preprod, and therefore the usable bucket width. `tblock_err` exists in the call context but neither stdlib predicate reads it (Documented in source). ADR 0030 and the clock tickets (#23) own this.
3. On-chain behaviour: that the predicate result recorded at proof time is re-checked against the including block, and that a transaction landing after a bucket's end is rejected. Derived from `spec/contracts.md` and the transcript structure; not tested on a network.
4. Adversarial soundness: none of the claim probes include the index binding or the cutoff-root equality, and I did not test a malicious prover (for example a path witness for another leaf).
5. L3 end to end: the digest of a blank slot, a way to construct a path for an unpopulated slot, behaviour of `insertHashIndex` into an occupied slot beyond the documented removal emulation, and prefix-collision handling.
6. Contention: concurrent retirements and checkpoints against pinned `Cell` reads, and whether the one-root-per-insert history of the record tree has a storage or fee ceiling.
7. Whether any option here needs a second proof or call per claim on the pinned node and wallet SDK (inherited open item 7 in the expressiveness findings).
8. Whether a Compact construction exists that proves absence from a ledger `Set` or `Map` without disclosing the key. I found none in the ADT list or compiler source at 0.31.1; this is absence of evidence, not a proof of impossibility.
9. How the retirement transaction and its successor are packaged, and the cost of the account-state design that decides how much each option reveals.

## 9. Sources

- Issues: [#49](https://github.com/MrSufferer/shroudly/issues/49), [#50](https://github.com/MrSufferer/shroudly/issues/50), [#51](https://github.com/MrSufferer/shroudly/issues/51), [#52](https://github.com/MrSufferer/shroudly/issues/52), [#53](https://github.com/MrSufferer/shroudly/issues/53), [#55](https://github.com/MrSufferer/shroudly/issues/55).
- Research branches (throwaway, read with `git show`): `research/candidate-screening` (`docs/research/unattended-selection-candidate-screening.md`, sections 4.6 and 5.1), `research/compact-hidden-state-expressiveness`, `research/unbiased-sampling`.
- Repository (maintainer checkout): `midnight/CONTEXT.md`, `docs/adr/0006`, `0028`, `0029`, `0030`, `docs/midnight-stack-review.md`.
- `LFDT-Minokawa/compact` tag `compactc-v0.31.1`: `doc/ledger-adt.mdx`, `compiler/standard-library.compact`, `compiler/midnight-ledger.ss`.
- `midnightntwrk/midnight-ledger` tag `ledger-8.1.0`: `spec/contracts.md`, `onchain-runtime/src/context.rs`.
- `midnightntwrk/midnight-docs` via `npx ctx7@latest docs /midnightntwrk/midnight-docs` (two queries): `docs/guides/security-best-practices.mdx`, `docs/relnotes/compact/compact-0-17-25-0.mdx`, `docs/compact/data-types/ledger-adt.mdx`.
- Pinned compiler 0.31.1 and its `zkir`; `@midnight-ntwrk/compact-runtime` 0.16.0 (maintainer checkout `node_modules`).

## Appendix: probes and reproduction

Environment: `compact compile +0.31.1 --skip-zk <src> <outdir>`, then `~/.compact/versions/0.31.1/aarch64-darwin/zkir mock-compile-many <outdir>/zkir`. Probes were written outside the repository. Executed results used a small Node driver (ESM) that imports the generated `contract/index.js` with `@midnight-ntwrk/compact-runtime` 0.16.0, supplies witnesses through private state, sets the simulated block time through `createCircuitContext(..., time)`, builds paths with `ledger(state).leaves.pathForLeaf`, and searches the serialised public transcript for known byte strings (the runtime trims trailing zero bytes of cell values). No keys, proofs or witnesses beyond these simulations were produced.

### Probe file Weights.compact (creation, retirement and claim variants)

```compact
pragma language_version >= 0.23.0;
import CompactStandardLibrary;

export ledger leaves: HistoricMerkleTree<32, Bytes<32>>;
export ledger leafBucket: Map<Bytes<32>, Uint<64>>;
export ledger retiredAt: Map<Bytes<32>, Uint<64>>;
export ledger retireRecs: HistoricMerkleTree<32, Bytes<32>>;
export ledger claimed: Set<Bytes<32>>;
export ledger sj: Uint<64>;
export ledger ej: Uint<64>;
export ledger selU: Uint<64>;

witness wbal(): Uint<64>;
witness wtc(): Uint<64>;
witness wtr(): Uint<64>;
witness wsec(): Bytes<32>;
witness wpath(): MerkleTreePath<32, Bytes<32>>;
witness wpathRec(): MerkleTreePath<32, Bytes<32>>;

export circuit leafOf(bal: Uint<64>, tc: Uint<64>, sec: Bytes<32>): Bytes<32> {
  return upgradeFromTransient(transientCommit<Vector<2, Uint<64>>>([bal, tc], degradeToTransient(sec)));
}
export circuit nullifierOf(sec: Bytes<32>): Bytes<32> {
  return persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "nf")]);
}
export circuit recordOf(sec: Bytes<32>, tr: Uint<64>): Bytes<32> {
  return persistentHash<[Bytes<32>, Uint<64>]>([sec, tr]);
}
circuit overlap(tc: Uint<64>, tr: Uint<64>, s: Uint<64>, e: Uint<64>): Uint<64> {
  const a = tc > s ? tc : s;
  const b = tr < e ? tr : e;
  return b > a ? ((b - a) as Uint<64>) : (0 as Uint<64>);
}

export circuit setInterval(s: Uint<64>, e: Uint<64>, u: Uint<64>): [] {
  sj = disclose(s);
  ej = disclose(e);
  selU = disclose(u);
}

// Creation, option C1: private time bracketed by two public block-time predicates.
export circuit createC1(lo: Uint<64>): [] {
  const l = disclose(lo);
  assert(blockTimeGte(l), "not before bucket start");
  assert(blockTimeLt((l + 60) as Uint<64>), "before bucket end");
  const bal = wbal();
  const tc = wtc();
  assert(tc >= lo && tc < (lo + 60) as Uint<64>, "tc in bucket");
  assert(bal >= 1000000 && bal <= 1000000000, "bound");
  leaves.insertHash(disclose(leafOf(bal, tc, wsec())));
}

// Creation, option C3: C1 plus a public leaf -> bucket registry.
export circuit createC3(lo: Uint<64>): [] {
  const l = disclose(lo);
  assert(blockTimeGte(l), "not before bucket start");
  assert(blockTimeLt((l + 60) as Uint<64>), "before bucket end");
  const bal = wbal();
  const tc = wtc();
  assert(tc >= lo && tc < (lo + 60) as Uint<64>, "tc in bucket");
  assert(bal >= 1000000 && bal <= 1000000000, "bound");
  const leaf = disclose(leafOf(bal, tc, wsec()));
  leaves.insertHash(leaf);
  leafBucket.insert(leaf, l);
}

// Retirement, option A: nullifier -> retirement bucket map.
export circuit retireA(lo: Uint<64>): [] {
  const l = disclose(lo);
  assert(blockTimeGte(l), "not before bucket start");
  assert(blockTimeLt((l + 60) as Uint<64>), "before bucket end");
  const sec = wsec();
  const p = wpath();
  assert(p.leaf == leafOf(wbal(), wtc(), sec), "leaf opens");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  const nf = disclose(nullifierOf(sec));
  assert(!retiredAt.member(nf), "not retired");
  retiredAt.insert(nf, l);
}

// Retirement, option R2: nullifier map plus unlinkable retirement record in a tree.
export circuit retireR2(lo: Uint<64>): [] {
  const l = disclose(lo);
  assert(blockTimeGte(l), "not before bucket start");
  assert(blockTimeLt((l + 60) as Uint<64>), "before bucket end");
  const sec = wsec();
  const p = wpath();
  assert(p.leaf == leafOf(wbal(), wtc(), sec), "leaf opens");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  const nf = disclose(nullifierOf(sec));
  assert(!retiredAt.member(nf), "not retired");
  retiredAt.insert(nf, l);
  retireRecs.insertHash(disclose(recordOf(sec, l)));
}

// Claim relation, option A: owner discloses its nullifier; time comes from the public map.
export circuit claimA(): [] {
  const sec = wsec();
  const bal = wbal();
  const tc = wtc();
  const p = wpath();
  assert(p.leaf == leafOf(bal, tc, sec), "leaf opens");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  const nf = disclose(nullifierOf(sec));
  const tr = retiredAt.member(nf) ? retiredAt.lookup(nf) : (18446744073709551615 as Uint<64>);
  const w = bal * overlap(tc, tr, sj, ej);
  assert(selU < w, "accepted");
  claimed.insert(disclose(persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "claim")])));
}

// Claim relation, option R2: owner proves a retirement record privately; no nullifier disclosed.
export circuit claimR2(): [] {
  const sec = wsec();
  const bal = wbal();
  const tc = wtc();
  const tr = wtr();
  const p = wpath();
  const pr = wpathRec();
  assert(p.leaf == leafOf(bal, tc, sec), "leaf opens");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  assert(pr.leaf == recordOf(sec, tr), "record opens");
  assert(retireRecs.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(pr))), "record member");
  const w = bal * overlap(tc, tr, sj, ej);
  assert(selU < w, "accepted");
  claimed.insert(disclose(persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "claim")])));
}

// Claim relation with no retirement evidence at all: the baseline that cannot give zero future weight.
export circuit claimNoCheck(): [] {
  const sec = wsec();
  const bal = wbal();
  const tc = wtc();
  const p = wpath();
  assert(p.leaf == leafOf(bal, tc, sec), "leaf opens");
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  const w = bal * overlap(tc, 18446744073709551615 as Uint<64>, sj, ej);
  assert(selU < w, "accepted");
  claimed.insert(disclose(persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "claim")])));
}
```

### Probe file Pos3.compact (removal at a public index; sparse-tree non-membership shape)

```compact
pragma language_version >= 0.23.0;
import CompactStandardLibrary;
// L1: removal by overwrite at a position derived from the leaf's own path (position becomes public)
// L3: sparse tree keyed by a 32-bit prefix of the nullifier hash (shape probe only)
export ledger leaves: HistoricMerkleTree<32, Bytes<32>>;
export ledger nfTree: HistoricMerkleTree<32, Bytes<32>>;
export ledger sj: Uint<64>;
witness wpath(): MerkleTreePath<32, Bytes<32>>;
witness wsec(): Bytes<32>;
witness wq(): Uint<248>;
witness wprefix(): Uint<32>;
circuit pathIndex(p: MerkleTreePath<32, Bytes<32>>): Uint<64> {
  const idx = fold((acc: [Uint<64>, Uint<64>], e: MerkleTreePathEntry): [Uint<64>, Uint<64>] =>
      [ (acc[0] + (e.goes_left ? 0 : acc[1])) as Uint<64>, (acc[1] * 2) as Uint<64> ],
      [0 as Uint<64>, 1 as Uint<64>], p.path);
  return idx[0];
}
export circuit addLeaf(h: Bytes<32>): [] {
  leaves.insertHash(disclose(h));
}
export circuit removeL1(): [] {
  const p = wpath();
  assert(leaves.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "member");
  leaves.insertIndexDefault(disclose(pathIndex(p)));
}
export circuit hOf(sec: Bytes<32>): Field {
  return transientHash<Bytes<32>>(persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "nf")]));
}
circuit prefixOf(sec: Bytes<32>): Uint<32> {
  const h: Field = transientHash<Bytes<32>>(persistentHash<[Bytes<32>, Bytes<32>]>([sec, pad(32, "nf")]));
  const TWO_32: Field = 4294967296 as Field;
  const px = wprefix();
  const q = wq();
  assert((q as Field) * TWO_32 + (px as Field) == h, "split");
  return px;
}
// non-membership claim shape: the slot at the nullifier prefix holds the blank value
export circuit claimL3(): [] {
  const sec = wsec();
  const p = wpath();
  const px = prefixOf(sec);
  assert(pathIndex(p) == (px as Uint<64>), "slot is nullifier prefix");
  assert(p.leaf == pad(32, ""), "slot is blank");
  assert(nfTree.checkRoot(disclose(merkleTreePathRootNoLeafHash<32>(p))), "non-member at root");
  sj = 1;
}
export circuit retireL3(): [] {
  const sec = wsec();
  const px = prefixOf(sec);
  nfTree.insertHashIndex(persistentHash<[Bytes<32>, Bytes<32>]>([pad(32, "used"), pad(32, "")]), disclose(px as Uint<64>));
}
```

### Negative disclosure probes

`Neg1`: `assert(blockTimeLt((wtc() + 60) as Uint<64>), ...)` with `wtc` a witness and no `disclose`; rejected with "the call to standard-library circuit blockTimeLt might disclose the lower bound of the time being checked the result of an addition involving the witness value". `Neg2`: `retiredAt.member(persistentHash([wsec(), pad(32, "nf")]))` with no `disclose`; rejected with "ledger operation might disclose a hash of the witness value".

### Driver (summary)

The driver ran, in order: `createC1` (simulated time inside the bucket, then outside it, then a `t_c` outside the bucket), `createC3`, `retireR2` (then a replay, then a call after the bucket end), ten claim calls through `setInterval` + `claimA`/`claimR2`/`claimNoCheck` for the intervals and `u` values in section 5.3, and a transcript search of `createC1`, `retireR2`, `claimA` and `claimR2`. Separate drivers ran `addLeaf` then `removeL1` (twice, the second with the pre-removal path) and `retireL3`/`claimL3` with `pathForLeaf` on blank slots. Results are those quoted in sections 4 and 5; nothing else was run.
