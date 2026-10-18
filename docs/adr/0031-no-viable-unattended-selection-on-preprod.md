# ADR 0031: No viable Unattended Selection construction on Preprod under current constraints

**Status:** Accepted
**Date:** 2026-10-17

Investigation [#49](https://github.com/MrSufferer/shroudly/issues/49) found no construction that delivers Unattended Selection on Preprod within the pinned Compact 0.31.1 toolchain, the current privacy rules and the viability floor. The only practical survivor, owner-side acceptance sampling (6B), yields low award probability for typical balances, cannot enforce zero future weight without linking nullifiers to leaves or all notes' lineage, cannot compact leaves without public retirement, and cannot back the five-commitment Disclosure Cohort with a leaf count. No real proof exists for any family. See `docs/unattended-selection-design-record.md`.

Until the maintainer accepts one of the changes listed there (public retirement, public per-participant cohort events, a lower effective bound with routine rollover, a compiler-level absence proof, or independent committee parties), no work should assume Unattended Selection is available, and #22's acceptance gate is not met. This decision does not change ADR 0003, 0006, 0028, 0029 or 0030 and makes no production contract change. A probabilistic rejection as a third Prize Rollover cause is not adopted. An independent cryptographic review (ADR 0012) remains required for any novel construction before Mainnet.

## Maintainer decision (2026-10-17)

- The "no viable construction under current constraints" finding is accepted; #49 closes and no longer blocks #25.
- Public retirement (design record section 5, option 1) is accepted as the relaxation to measure: the leaf index or nullifier is visible at withdrawal, which links note lineage. #22 is re-scoped to measure 6B with public retirement using a real proof on proof server 8.1.3 and compiler 0.31.1 (amended 2026-10-18 from 8.1.0 when the version profile was realigned; 8.1.0 evidence is not accepted).
- #25 proceeds with operator-computed selection, and the privacy loss is stated in the authority model. This is an interim path until #22 qualifies or rejects 6B with public retirement.
- Whether a probabilistic rejection becomes a third Prize Rollover cause stays undecided and is not adopted.

## Maintainer decision (2026-10-18)

- #22 measured 6B with public retirement on proof server 8.1.3 and compiler 0.31.1 (`midnight/experiments/public-retirement/`). The mechanics and Preprod limits pass. Typical award probability stays at 0.001 (about one award every 10 days), and no local verifier rejects a tampered proof. 6B with public retirement is **rejected** for Preprod, and #22 closes.
- #25's operator-computed selection is no longer interim pending #22; it is the Preprod selection path. Public cohort events or a lower effective bound with routine rollover would need a new, separately approved ticket.
