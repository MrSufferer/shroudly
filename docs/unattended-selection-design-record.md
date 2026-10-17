# Unattended Selection on Preprod: design record

Outcome of [#49](https://github.com/MrSufferer/shroudly/issues/49), the investigation that gates [#25](https://github.com/MrSufferer/shroudly/issues/25). Date: 2026-10-17. Toolchain: Compact compiler 0.31.1, language 0.23.0, runtime 0.16.0, proof server 8.1.0, ledger 8.1.0 (`midnight/version-profile.json`).

**Finding: no viable construction was found for Unattended Selection on Preprod under the current constraints.** One candidate (owner-side acceptance sampling, "6B") survives screening but fails the viability floor. A second (a threshold/MPC committee) needs independent parties that do not exist. No real proof was generated for any family; every number below is a compile, `mock-compile` or local-runtime simulation unless stated. Nothing in the production contracts changed.

## 1. Constraints applied

Unattended Selection: private exact weighted selection, no participant check-ins, no operator-held participant secrets, balances, weights and ownership kept private (`midnight/CONTEXT.md`).

Kill criteria: K1 participant openings or secrets needed at settlement; K2 operator-visible weights, balances or ownership (including via the three operator-controlled keys of ADR 0003); K3 a per-draw participant action; K4 verifier not expressible and provable as a Compact circuit; K5 no safe exit when an extra liveness dependency fails.

Viability floor: capacity above five, steady-state settlement inside the 15-minute cadence, bounded per-transaction catch-up, and a real proof on proof server 8.1.0 / compiler 0.31.1 for anything recommended.

## 2. What Compact 0.31.1 can and cannot do

Evidence: [expressiveness findings](https://github.com/MrSufferer/shroudly/blob/research/compact-hidden-state-expressiveness/docs/research/compact-hidden-state-expressiveness.md).

- SHA-256, Poseidon and Jubjub `ecAdd`/`ecMul`/`hashToCurve` exist. There is no `ecNeg`, no division or modulo operator and no sum tree.
- No hidden-index access, so hidden selection means scanning every operand (about 185 rows per scan step).
- No cross-contract calls or `kernel.caller()`; another user's commitment gives a later caller no opening.
- Ledger-operation arguments are public and need `disclose`; `checkRoot` on a `HistoricMerkleTree` discloses the root; a conditional ledger write needs a disclosed condition.
- Unbiased sampling is feasible: 248-bit sampling or rejection gives bias and failure below 2^-184 per sample, while 64-bit modulo is visibly biased (about 1.2e-4). A failed assert yields no transaction, so a cancellation needs an explicit in-circuit rejection branch ([sampling findings](https://github.com/MrSufferer/shroudly/blob/research/unbiased-sampling/docs/research/unbiased-sampling-onto-total-weight.md)).

## 3. Candidate screening

Of 14 families, two survive ([screening](https://github.com/MrSufferer/shroudly/blob/research/candidate-screening/docs/research/unattended-selection-candidate-screening.md)).

- **6B, owner-side acceptance sampling.** The contract publishes a leaf index `i` and a threshold `u`; the owner of leaf `i` proves at claim time that `u < w`. Claim relation: 8,405 rows (k=14), independent of participant count.
- **Family 3, threshold/MPC committee.** Needs independent parties. Parked.

The rest are eliminated by a named criterion (sum tree with public nodes by K2, FHE by K2/K4, TEE by K4, and so on).

## 4. Why 6B fails the viability floor

### 4.1 Award probability ([findings](https://github.com/MrSufferer/shroudly/blob/research/6b-award-probability/docs/research/6b-award-probability.md))

`W_max` = Contribution Bound x Draw Interval = 1,000 tMIX x 900 s, about 9x10^11 micro-unit-seconds. One try awards with probability P = sum(w) / (n x W_max), where `n` counts every leaf, live or retired.

- Four 1 tMIX balances: P = 0.001, expected wait about 10 days.
- One whale among four small balances: P is about 0.2.
- After c balance changes P falls to 1/(1+c); a balance split into s notes gives 1/s.
- 90% confidence of an award takes 11 to 2,302 tries. The winner stays proportional to weight for any number of tries.
- Each try is a separate claim window. Sequential 60-minute windows take 60k minutes; splitting one window gives each owner 60/k minutes. Whether that satisfies ADR 0030 is the maintainer's call.

The Prize would roll over most of the time for typical balances. Rollover as a routine outcome conflicts with the Prize Draw definition and the ADR 0006 rollover causes.

### 4.2 Partial-interval weight ([findings](https://github.com/MrSufferer/shroudly/blob/research/6b-partial-interval-weight/docs/research/6b-partial-interval-weight.md))

A full withdrawal must keep elapsed weight and give zero future weight, without linking nullifiers to leaves.

| Option | Zero future weight | Disclosure |
|---|---|---|
| A: nullifier to retirement-bucket map | yes (observed) | winner's claim links its nullifier to its leaf |
| R2: unlinkable retirement record in a tree | no (a retired note was accepted) | none, plus a branch bit if conditional |
| L1: removal at a public index with cutoff roots | yes, by structure | retirement links every note's lineage |
| L3: sparse-tree non-membership | not established (no path constructible for an unpopulated slot) | unknown |
| N: no evidence | no | none |

Creation time works: private `t_c` bracketed by block-time predicates, 1,107 rows (k=11), with a cheating bound of balance x bucket width. No non-disclosing absence proof was found in 0.31.1 (absence of evidence, not impossibility).

### 4.3 Leaf lifecycle and cutoff binding ([findings](https://github.com/MrSufferer/shroudly/blob/research/6b-leaf-lifecycle/docs/research/6b-leaf-lifecycle-and-cutoff-binding.md))

- Tree depth is at most 32 (4,294,967,296 slots); a full tree rejects inserts. One leaf per contribute or withdraw. Fill time is 136 years at one insert per second and 1.4 to 3.2 years if the whole chain's write limit fed the tree (derived).
- Compaction with no participant action requires public retirement, which links a note's creation and replacement. With private nullifier retirement nobody but the owner knows which leaves are dead, so dead leaves dilute `n` permanently.
- A leaf count cannot back the five-commitment Disclosure Cohort: one participant can reach five. A meaningful count needs public per-participant events (as `participantCount` does today).
- `root()` and `firstFree()` cannot be used in a circuit. Append-only binding is `n` recorded at the cutoff plus an index bound (derived, not proven). Any overwrite lifecycle needs a pinned root through a twin plain tree. After a slot is retired in a historic tree the pre-retire root stays valid (observed).
- History costs about 180 to 193 bytes per leaf for a `HistoricMerkleTree<32>`; `resetHistory` reclaims little and invalidates old roots.

### 4.4 Summary

| Floor / criterion | 6B |
|---|---|
| Capacity above five | claim size independent of `n`, but only measured by mock-compile |
| Meaningful award | fails: P is small for typical balances and falls with churn |
| Zero future weight and no linkage | fails: no option achieves both |
| Disclosure Cohort check | fails unless per-participant events become public |
| Bounded growth without participant action | fails unless retirement becomes public |
| Real proof | none |

## 5. What would make 6B viable

Any one of these changes could reopen it; each needs a maintainer decision.

1. Accept public retirement (leaf index or nullifier visible at withdrawal). This fixes compaction and zero future weight but links note lineage.
2. Accept public per-participant events for the Disclosure Cohort (as today), which exposes participation counts.
3. Accept routine rollover and lower the effective Contribution Bound so P is meaningful, or sample over live weight only (requires 1 or 2).
4. Provide a non-disclosing absence proof, which Compact 0.31.1 does not offer. A later compiler or an L3 variant could change this.
5. Recruit independent parties for family 3.

## 6. Decision request

The maintainer is asked to decide, in order:

1. Whether to accept "no viable construction under current constraints" for #49 and unblock #25 on that basis.
2. Which of the options in section 5, if any, to accept, so a follow-up can measure a real proof.
3. How #25 proceeds without Unattended Selection: continue with operator-computed or check-in selection with the privacy loss stated, or hold.
4. Whether a probabilistic rejection is a third Prize Rollover cause (ADR 0006, `midnight/CONTEXT.md`) if 6B is revisited.

## 7. What #22 must re-run

#22's acceptance gate (private offline participation and exits) cannot pass under the current design. After the decisions in section 6, #22 re-runs: the offline-participation experiment ([results](../midnight/experiments/offline-participation/README.md)) against the accepted selection construction; a real proof on proof server 8.1.0 and compiler 0.31.1; a transcript disclosure audit; capacity above five; a bounded catch-up transaction; safe exit with an unresolved interval; and the identity cap across split notes (ADR 0028) and durable single-writer state (ADR 0029).

## 8. Not established

- A real proof, proving time or key size for any family.
- Live Preprod limits (the spec says `bytes_written` 20,000, the code says 50,000), block-timestamp accuracy, and on-chain re-checking of block-time predicates.
- Adversarial soundness: the probes lack index binding and cutoff-root equality.
- Any ledger ceiling on history or contract state; wallet and indexer support for past-root paths.
- Whether a Compact construction proves absence from a `Set`/`Map` without disclosing the key.
- Family 3 beyond the screening.

## 9. Unrelated findings

- `midnight/version-profile.json` carries a stale, decommissioned `indexerGraphql` URL.
- The compiler targets ledger 8.0.2 while the profile pins ledger and proof server 8.1.0.
- The independent cryptographic review required by ADR 0012 applies to any novel construction before Mainnet; this record neither performs nor schedules it.

## 10. Research branches

Throwaway, never merged: `research/compact-hidden-state-expressiveness`, `research/unbiased-sampling`, `research/candidate-screening`, `research/6b-award-probability`, `research/6b-partial-interval-weight`, `research/6b-leaf-lifecycle`.
