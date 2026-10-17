# Award probability and claim sequencing for owner-side acceptance sampling (family 6B)

Research for [#54](https://github.com/MrSufferer/shroudly/issues/54), a research ticket on the wayfinder map in [#49](https://github.com/MrSufferer/shroudly/issues/49). Date: 2026-10-17. Toolchain context: Compact compiler 0.31.1 (`midnight/version-profile.json`).

This file reports numbers and sequencing facts. It sets **no acceptable award rate** and **recommends no design**. Whether to accept probabilistic rejection as a Prize Rollover cause is the maintainer's decision (#49 "Not yet specified"; #53).

Every claim carries one tag.

- **Documented**: stated by a source I read in this repository or on the research branches; the source is named.
- **Observed (inherited)**: measured by an earlier ticket (#50, #52) with the pinned compiler's `zkir mock-compile`. I ran no compiler and no proof in this ticket.
- **Derived**: my own arithmetic or reasoning from tagged facts. The script in the appendix reproduces the arithmetic.
- **Assumption**: an input I chose to make a number computable. Each is labelled where used.
- **Not established**: could not be settled from the sources (section 8).

## 1. Summary of numbers

1. **`W_max` can be a deployment constant: `1,000 tMIX x 900 s = 9 x 10^11` micro-`tMIX`-seconds (about 2^39.7).** It follows from the Contribution Bound and the Draw Interval length, both fixed for Preprod v1 (sections 2.1, 2.2). It is a valid bound on every leaf's weight only if the per-identity total-balance invariant of ADR 0028 is actually enforced; the reference contract does not enforce it yet (section 2.3).
2. **With `W_max` fixed, the unconditional award probability of one try is the mean over leaves of (balance / 1,000 `tMIX`) x (fraction of the interval held)**, counting every leaf in the tree at the cutoff, live or retired. When every leaf is live for the full interval it does not depend on the number of leaves: `P = mean(balance) / 1,000 tMIX` (section 3).
3. **Examples (one try).** Five equal balances of 1 / 10 / 100 / 500 / 1,000 `tMIX`: `P` = 0.001 / 0.01 / 0.1 / 0.5 / 1. One 1,000 `tMIX` balance among four of 1 `tMIX`: 0.2008. The same whale among 15 / 63 / 127 / 1,023 small ones (n = 16 / 64 / 128 / 1,024): 0.0634 / 0.0166 / 0.0088 / 0.00198.
4. **Leaf-count inflation lowers `P` linearly.** Each retired leaf (a balance change that adds a leaf and retires the old one), each split note and each dust leaf adds 1 to `n` and little or nothing to the sum. Five identities at the cap, each with `c` earlier balance changes whose retired leaves stay in `n`: `P = 1/(1+c)` (section 3.4).
5. **Expected rollover for one try is `1 - P`** (plus the existing ADR 0006 causes, which are unchanged). At `P` = 0.001 / 0.01 / 0.1 / 0.2008: 99.9% / 99% / 90% / 79.9% of draws roll over; the expected wait to the first award is 10.4 days / 25 hours / 2.5 hours / 75 minutes (section 4).
6. **Tries needed for a target.** `k >= ln(1-T) / ln(1-P)`. For T = 0.99: 4,603 tries at `P` = 0.001; 459 at 0.01; 44 at 0.1; 21 at 0.2008; 7 at 0.5. The full grid is in section 5. Winner probability stays exactly proportional to weight for any `k` (section 5).
7. **Sequencing.** A later owner's claim cannot be honoured before every earlier try's window has ended, and the chain cannot tell a rejected leaf from an unclaimed one (sections 6.1, 6.2). Back-to-back full 60-minute windows take `60k` minutes (120 for k = 2; 240 for k = 4) and keep `ceil(60k / 15)` draws' claims open at once. Splitting one 60-minute window into `k` sequential sub-windows gives each owner `60/k` minutes (30 for k = 2; 5 for k = 12; 1 minute for k = 60). ADR 0030's text guarantees sixty usable minutes after finalized selection; whether a shorter per-owner window satisfies it is not settled by the ADR (section 6.3).
8. **Per-draw dependency on offline participants.** The windows' start times are fixed by the clock and do not depend on any earlier owner's behaviour, so a specific offline owner cannot delay a later owner's start. Each try's award, however, requires its specific owner to be online inside that try's specific slot (section 6.4).

## 2. What `W_max` can be

### 2.1 Inputs (Documented)

| Quantity | Value | Source |
|---|---|---|
| Contribution Bound | 1,000 `tMIX` total outstanding Principal per Participant Identity; new contributions at least 1 `tMIX`; withdrawals may leave any positive six-decimal remainder | ADR 0028; `midnight/CONTEXT.md` "Contribution Bound" |
| Immutability | Preprod safety constants are immutable for v1; changing one needs a new ADR, source revision, compile and evidence | ADR 0027 "Consequences" |
| Unit | six decimals, `1 tMIX = 1,000,000` micro-units | ADR 0027 |
| Draw Interval | fixed UTC period, fifteen minutes on Preprod; schedule changes only for the future, bounded, via timelocked governance | ADR 0003, ADR 0006 "Consequences", `midnight/CONTEXT.md` "Draw Interval" |
| Time unit | seconds (`drawCutoff = 900`, `claimDeadline = now + 3600`, `kernel.blockTime*` in seconds) | `midnight/PrizePool.compact`; #50 section 2.3. The second as the weight unit is inferred from the code, not stated in an ADR (as in #51 section 1) |
| Weight | Time-Weighted Principal, accrued continuously from confirmed contribution until confirmed withdrawal; weight per Draw Interval is computed independently, remaining Principal carries forward without action | ADR 0006; `midnight/CONTEXT.md`; `docs/preprod-technical-spec.md` line 33 |
| Claim Window | sixty minutes from finalized selection on Preprod, extended only by an enforced settlement pause that prevents the claim | ADR 0006, ADR 0030, `midnight/CONTEXT.md` |
| Cadence | weighting closes every fifteen minutes; commitments close three minutes before; reveals accepted for five minutes after | ADR 0003 |

### 2.2 The bound (Derived)

A leaf's weight for one Draw Interval is `balance x overlap_seconds`, where `overlap_seconds <= 900` and, per identity, `balance <= 1,000 tMIX` once ADR 0028 is enforced. A note's balance is at most its identity's total. Therefore every leaf satisfies

`w <= W_max = 1,000 tMIX x 900 s = 1,000,000,000 micro-tMIX x 900 s = 9 x 10^11 micro-tMIX-seconds` (log2 = 39.71).

Its relation to #51's weight table: five identities at the cap for one interval is `5 x W_max = 4.5 x 10^12`, #51 row D. #51 row F (`9 x 10^15`) is the whole issuance cap for one interval, which is not a per-leaf bound.

The acceptance probability of a leaf is `w / W_max`, a ratio that does not depend on the unit chosen. Because `W_max` and `w` are integers, there is no rounding in the acceptance test.

Sampling accuracy of the two public draws, using the #51 bound `TV <= T/(4N)` with a 248-bit sample `N = 2^248`: the leaf index over at most `2^32` leaves is within `2^-218` of uniform; the threshold over `W_max` is within `2^-210.3` (Derived from #51 arithmetic; the script prints it). Both are far below any realistic threat, so sampling bias is not a driver of the numbers below.

### 2.3 Conditions under which the bound holds, and what is public

- **Cap enforcement (Documented).** ADR 0028 says "Implementation and qualification must add the total-balance invariant ... before claiming enforcement." The reference contract's `contribute` checks only `amount >= 1000000 && amount <= 1000000000` per deposit (`midnight/PrizePool.compact`, `contribute`), so repeated deposits can currently exceed the cap. `W_max` is a valid bound only after that invariant exists.
- **Many identities do not break the bound.** A fresh credential is a different identity (ADR 0028; `midnight/CONTEXT.md` "Participant Identity"); each leaf is still bounded by its own identity's cap. It does change `n` and the sum (section 3.4).
- **Interval length.** Governance may change the Preprod schedule for future intervals (ADR 0006). `W_max` then equals cap x the interval length in force, a public value per interval (Derived). Partial or catch-up intervals use the same fixed length (Derived from "Draw Interval ... fixed UTC period").
- **Alternatives to the constant.** `W_max` only has to be a public value no smaller than every leaf's weight, otherwise the acceptance probability exceeds the intended `w / W_max` for the heaviest leaf (Derived). The constant above is the one that needs no hidden data. A tighter bound would raise `P`: if the aggregate weight `S = sum w` were public, `W_max = S` gives `P = 1/n` for every distribution (Derived: `sum w / (n S)`). The reference contract already writes the total weight to ledger state at finalization and hashes it into `aggregateDisclosure` (`finalize`, `totalShareTwab`), and `midnight/CONTEXT.md` allows exact aggregates at a boundary meeting the Disclosure Cohort. **Not established**: whether family 6B can obtain an aggregate weight or aggregate Principal at the cutoff without a participant action or a scan, which is the capability #50 found missing. I do not use this alternative in the tables.

## 3. Award probability of one try

### 3.1 Formula

**Derived** (from #52 section 4.6, checked here): a try draws a public leaf index `i` uniformly from `[0, n)` and a public threshold `u` uniformly from `[0, W_max)`. Leaf `i` is awarded if `u < w_i`. So

`P = (1/n) x sum_i (w_i / W_max) = sum_i w_i / (n x W_max)`,

where `n` is the number of leaves in the tree at the cutoff, including retired and zero-weight leaves, because the index is drawn over the public leaf count. Conditional on an award, leaf `i` wins with probability `w_i / sum w`. With the weights expressed as a fraction `f_i = (balance_i / 1,000 tMIX) x (seconds held / 900)`, `P = mean_i f_i`.

### 3.2 Realistic distributions, every leaf live for the full interval (Derived; script Table 1)

| Distribution | n=5 | n=16 | n=64 | n=128 | n=1024 |
|---|---|---|---|---|---|
| equal 1 `tMIX` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |
| equal 10 `tMIX` | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 |
| equal 100 `tMIX` | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| equal 500 `tMIX` | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| equal 1,000 `tMIX` (all at cap) | 1 | 1 | 1 | 1 | 1 |
| one 1,000 `tMIX` + (n-1) x 1 `tMIX` | 0.2008 | 0.06344 | 0.01661 | 0.008805 | 0.001976 |
| one 999 `tMIX` + (n-1) x 1 `tMIX` | 0.2006 | 0.06338 | 0.01659 | 0.008797 | 0.001975 |
| balances uniform on [1,1000] `tMIX`, expected | 0.5005 | 0.5005 | 0.5005 | 0.5005 | 0.5005 |
| balances log-uniform on [1,1000] `tMIX`, expected | 0.1446 | 0.1446 | 0.1446 | 0.1446 | 0.1446 |

Notes.

- The uniform and log-uniform rows are **Assumption** distributions I chose for illustration; no source gives a balance distribution. The log-uniform mean is `(1000 - 1) / ln(1000) = 144.6 tMIX`.
- Exact value for one whale and four small: `251/1250 = 0.2008`.
- **Capacity.** "Five to the measured capacity": no capacity of family 6B has been measured. #52 section 5.1 says capacity is bounded by the `2^32`-leaf limit of a depth-32 tree and not by circuit size, since the claim relation measured 8,405 rows, k=14, independent of the number of participants (Observed, inherited). The columns above are therefore sample sizes, not a measured limit. For the sizes #50 did measure for the hidden scan (not family 6B): 64 `persistentCommit` openings, 128 `transientCommit` openings, 1,024 plain weights. Equal-balance rows do not depend on `n`; only skewed mixes do.
- Disclosure Cohort: the reference contract caps the Preprod cohort at exactly five participants (`participantCount < disclosureCohort`; `finalize` asserts `participantCount == disclosureCohort`). That is a property of the reference contract, not of family 6B. The n = 5 column is that case.

### 3.3 Partial intervals (Derived)

`f_i` scales linearly with the overlap fraction. A note created uniformly at random inside a Draw Interval has expected overlap 1/2 in that first interval, so its expected `f` is half of the full-interval value; from the second interval it carries forward at full overlap. This follows from `w = balance x overlap` (ADR 0006, `midnight/CONTEXT.md`) and the carry-forward rule. How a leaf proves overlap is #52 section 5.1 item 4, not examined here.

### 3.4 Leaf-count inflation (Derived; script Table 2)

All leaves count in `n`; weight sums only what is held.

| 5 identities at `b` tMIX plus `m` extra leaves of 1 `tMIX` | m=0 | m=10 | m=100 | m=1000 |
|---|---|---|---|---|
| b = 100 | 0.1 | 0.034 | 0.005714 | 0.001493 |
| b = 1,000 | 1 | 0.334 | 0.04857 | 0.00597 |

- One identity holding 1,000 `tMIX` alone, split into `s` equal notes (one leaf each): `P = 1/s` (1, 0.5, 0.1, 0.01, 0.001 for s = 1, 2, 10, 100, 1,000). A split into the smallest permitted contributions is the worst case per balance. The cap applies to total Principal per identity (ADR 0028), so splitting does not breach it.
- Retired leaves: if each balance change adds a leaf and the retired leaf stays in the tree, five identities at the cap that have each changed balance `c` times give `n = 5(1+c)` and `P = 1/(1+c)`: 1, 0.5, 0.1, 0.01, 0.001 for c = 0, 1, 9, 99, 999.
- Whether the real design counts retired leaves in `n`, caps note count per identity, or compacts is open (#52 section 5.1 items 5 and 6). I report only the sensitivity.
- A Sybil or dust participant lowers everyone's `P`. The only documented friction is ADR 0027's faucet (1,000 `tMIX` per owner per 24 hours) and the 1 `tMIX` minimum contribution (ADR 0028); neither is a bound on leaf count (Derived).

## 4. Expected rollover for one try (Derived; script Table 3)

Per draw, the award occurs with probability `P` if the owner of an accepted leaf claims. Rollover from rejection is `1 - P`. Draws are independent given fixed weights (the index and threshold are fresh from each draw's reveal), so intervals to first award are geometric with mean `1/P`. The table assumes the owner of an accepted leaf always claims in time (**Assumption**; owner absence is an existing, separate rollover cause under ADR 0006, whose rate is not established).

| P | rollover `1-P` | expected intervals to first award | expected wait at 15 min | P(no award in 96 intervals = 24 h) | awards per day |
|---|---|---|---|---|---|
| 0.001 | 0.999 | 1000 | 10.4 days | 0.908 | 0.096 |
| 0.01 | 0.99 | 100 | 25.0 hours | 0.381 | 0.96 |
| 0.05 | 0.95 | 20 | 5.0 hours | 0.00727 | 4.8 |
| 0.1 | 0.9 | 10 | 2.5 hours | 4.05e-05 | 9.6 |
| 0.2008 | 0.7992 | 4.98 | 75 minutes | 4.52e-10 | 19.3 |
| 0.5 | 0.5 | 2 | 30 minutes | 1.26e-29 | 48 |
| 1 | 0 | 1 | 15 minutes | 0 | 96 |

Not established: how much Simulated Yield is released for a rolled interval and whether the rolled Prize is added to the next draw's Prize, so I do not state expected prize per award or per day.

## 5. Independent tries needed (Derived; script Table 4)

Tries `j = 1..k` use independent pairs `(i_j, u_j)` taken from the one reveal (the reveal is a given uniform input, #49 "Out of scope"; expanding it into `2k` independent 248-bit samples is not examined). With replacement over the same leaf set, tries are identically distributed and independent. The probability that at least one try is accepted is `1 - (1-P)^k`, so a target `T` needs `k >= ln(1-T) / ln(1-P)`.

| P per try | T = 0.5 | T = 0.9 | T = 0.99 | T = 0.999 |
|---|---|---|---|---|
| 0.001 | 693 | 2,302 | 4,603 | 6,905 |
| 0.01 | 69 | 230 | 459 | 688 |
| 0.05 | 14 | 45 | 90 | 135 |
| 0.1 | 7 | 22 | 44 | 66 |
| 0.2008 | 4 | 11 | 21 | 31 |
| 0.5 | 1 | 4 | 7 | 10 |

- The proportional-selection property survives. If the first accepted try wins, each try accepts leaf `i` with probability `w_i / (n W_max)` regardless of its position, so the winner is leaf `i` with probability `w_i / sum w` exactly (Derived). A Monte Carlo check with a fixed seed (appendix) matches both the award rate and the whale's share: at k = 3 the simulated award rate is 0.48987 against 0.48953 closed-form, and the whale wins 0.99609 of awards against 0.99602 proportional.
- Several tries can select the same leaf; that is one owner and one claim (Derived).
- The finalize circuit would write `k` index/threshold pairs. Using #50's witness-quotient reduction cost (341 rows, k=9 per reduction; Observed, inherited), `2k` reductions cost `682k` rows, for example 6,820 rows at k = 10 and 40,920 at k = 60, before hashing the reveal into `2k` samples (hash cost not added; not measured, so this is a lower bound on the added cost).

## 6. Sequencing tries against claim windows

### 6.1 What constrains the order

- **Documented**: the winner's claim is a private proof of membership, selection and ownership consuming a Claim Nullifier (ADR 0006). The Claim Window is sixty minutes from finalized selection (ADR 0006, ADR 0030, `midnight/CONTEXT.md`) and ADR 0030 says the claim clock "must guarantee sixty usable minutes after finalized prize selection". ADR 0030 permits a bounded network-time margin only after measurement and separate acceptance; "no margin is assumed yet".
- **Documented**: time is enforced by predicates (`blockTimeLessThan/GreaterThan`, seconds, predicates only, #50 section 2.3), and ADR 0030 forbids browser or operator time authority. Sub-window boundaries are therefore public times derived from the recorded finalization time (Derived).
- **Derived**: only the owner of a selected leaf can tell whether `u_j < w`. The chain cannot distinguish "accepted but not claimed" from "rejected" (#52 section 4.6, K2 note). A later try's owner is only entitled to the Prize if no earlier try claimed it. The chain can therefore honour a later claim only after it knows no earlier claim can still arrive, which is when the earlier windows have ended (the issue text and ADR 0030 point to the same rule).
- **Documented timeline** (ADR 0003, ADR 0006): weighting closes at `T`; commitments closed at `T - 3 min`; reveals close at `T + 5 min`; finalization is permissionless after that. Let `F = T + 5 min` be the earliest finalization. The next draw closes at `T + 15 min` and finalizes at `F + 15 min`. A sixty-minute window starting at `F` therefore spans the finalizations of the next three draws and ends exactly when the fourth later draw becomes finalizable (Derived).
- **Documented difference from the reference contract**: ADR 0030 says draws "retain separate liabilities and claim deadlines while the fixed UTC schedule continues". The reference `PrizePool.compact` tracks a single `winningCommitment`/`claimDeadline` and sets the next `drawCutoff` only after a claim or an expiry rollover, i.e. it does not run overlapping claim windows. Overlap in the arithmetic below follows ADR 0030, not the reference contract.

### 6.2 Facts that follow (Derived)

1. Because the chain cannot tell a rejecting owner from an absent one, the start of try `j`'s window cannot depend on what earlier owners did. It is `F + sum of earlier window lengths`, a clock value. Without a chain-visible "decline" action, an early rejection cannot shorten the sequence. A decline action would be a participant action tied to a specific leaf and proves information about that leaf's weight (`u >= w`); I did not design or evaluate one.
2. If an earlier accepted owner is offline, that try's window runs out and the next try's window opens. An absent owner costs time (the window length), not the later tries' chance. If the earlier owner claims, the draw is closed and later tries are void.
3. Latency to the final outcome of a draw is therefore fixed by the schedule: the last window ends at `F + (sum of window lengths)`. A rolled Prize from draw `d` becomes available to a later draw only after that moment (Derived; which later draw receives it is not stated in the sources).

### 6.3 Sequencing options and their arithmetic (Derived; script Table 5)

Draw `d` has `k` tries. Times are minutes after `F`.

**Option S1: back-to-back full windows.** Each try's owner gets a full 60 minutes; window `j` is `[60(j-1), 60j]`.

**Option S2: one window partitioned.** The 60 minutes are divided into `k` equal sequential sub-windows of `60/k` minutes.

**Option S3: concurrent windows, one winner.** All `k` windows are open for the same 60 minutes and the chain accepts the first valid claim (no sequencing). Listed because it removes the ordering dependency; its properties are in 6.5.

| k | S2 window per try | S1 total span | S1 draws with a claim window open at once | S1 first later draw finalizing strictly after the span | S2 draws open at once |
|---|---|---|---|---|---|
| 1 | 60 min | 60 min | 4 | d+5 | 4 |
| 2 | 30 min | 120 min | 8 | d+9 | 4 |
| 3 | 20 min | 180 min | 12 | d+13 | 4 |
| 4 | 15 min | 240 min | 16 | d+17 | 4 |
| 6 | 10 min | 360 min | 24 | d+25 | 4 |
| 12 | 5 min | 720 min | 48 | d+49 | 4 |
| 30 | 2 min | 1,800 min | 120 | d+121 | 4 |
| 60 | 1 min | 3,600 min | 240 | d+241 | 4 |

Reading across to the tries needed (section 5): reaching T = 0.99 at `P` = 0.2008 needs `k` = 21, which gives 2.86 minutes per owner in S2 or 1,260 minutes (21 hours) of span in S1. At `P` = 0.01, `k` = 459 gives 7.8 seconds per owner in S2 or 459 hours in S1. At `P` = 0.001, `k` = 4,603 gives 0.78 seconds per owner in S2 (all Derived: 3,600 s / k).

Which options fit ADR 0030 is for the maintainer: S1 gives every selected owner the full sixty minutes the ADR guarantees but stretches resolution to `60k` minutes and keeps `ceil(60k/15)` draws' claims open at once. S2 keeps the sixty-minute total but gives each owner `60/k` minutes, which the ADR's wording ("sixty usable minutes after finalized prize selection") does not clearly allow. Any bounded network-time margin (ADR 0030, not yet measured) would apply to every window and so subtracts `k` times in S1 and S2 (Derived; margin value Not established).

### 6.4 Dependency on specific offline participants (Derived)

- **Start times**: none. Section 6.2 item 1.
- **Per-try availability**: yes. For try `j` to produce an award, its specific owner (named by the public index `i_j`, known only to that owner) must be online during window `j`. The exposure per owner is the window length: 60 minutes in S1 and S3, `60/k` in S2.
- **Illustration (Assumption)**: if the selected owner is online as a Poisson process with rate `lambda` per hour, the chance of coming online during a window of `L` minutes is `q = 1 - exp(-lambda L/60)`, and `P_eff = 1 - (1 - P q)^k`. This is my model, not a measurement of anyone's behaviour.

| lambda per hour | P | k=1 (60 min) | k=2, S2 (30 each) | k=4, S2 (15 each) | k=12, S2 (5 each) | k=4, S1/S3 (60 each) | k=12, S1/S3 (60 each) |
|---|---|---|---|---|---|---|---|
| 0.25 | 0.1 | 0.0221 | 0.0234 | 0.0240 | 0.0245 | 0.0856 | 0.235 |
| 0.25 | 0.01 | 0.00221 | 0.00235 | 0.00242 | 0.00247 | 0.00882 | 0.0262 |
| 1 | 0.1 | 0.0632 | 0.0772 | 0.0856 | 0.0918 | 0.230 | 0.543 |
| 1 | 0.01 | 0.00632 | 0.00785 | 0.00882 | 0.00955 | 0.0251 | 0.0733 |
| 4 | 0.1 | 0.0982 | 0.166 | 0.230 | 0.292 | 0.339 | 0.711 |
| 4 | 0.01 | 0.00982 | 0.0172 | 0.0251 | 0.0335 | 0.0387 | 0.112 |

In this model the absent-owner effect is large: with `lambda` = 0.25 per hour and `P` = 0.1, one try yields 0.022, a factor 4.5 below the 0.1 of the always-online case in section 4. Because family 6B needs the accepted owner to claim online, the effective award rate is `P` times the online chance; it is the owner-offline cause already in ADR 0006, now multiplied by `P`. Real owner presence is not established.

### 6.5 Concurrent windows (S3) (Derived)

- Each claim relation is self-contained: it checks only the owner's own leaf against the public `(i_j, u_j)` (#52 probe B). No claim depends on another owner's data.
- The first accepted claim must close the draw, for example with a draw-level nullifier; a second near-simultaneous claim would fail on chain (a wasted proof). That consumes a shared draw-level state write, which I did not measure.
- If claim latency is independent of the leaf, the winner is still proportional to weight by symmetry among accepted tries (Derived). If latency is correlated with balance (for example heavier holders run better-connected clients), the winner distribution shifts toward them. Not measured.
- No later owner waits on an earlier owner, so there is no ordering dependency on any specific participant, and all `k` owners get the full window. The price is the first-landed-claim race above.

### 6.6 Catch-up (Derived)

Claim windows start at finalized selection, so a late (catch-up) finalization of an Unresolved Interval starts its own windows at its own `F`; the per-draw sequencing above does not change. A catch-up of `N` missed intervals produces `N` independent draws each with `k` tries; the finalize step per interval writes `k` pairs (section 5). The per-transaction bound is not measured.

## 7. Documented fact versus derivation

| Statement | Basis |
|---|---|
| Contribution Bound 1,000 `tMIX` total per identity; contribution at least 1 `tMIX`; Preprod constants immutable for v1 | Documented, ADR 0027, ADR 0028 |
| Interval 15 min; reveals 5 min after close; commit cutoff 3 min before; Claim Window 60 min; no margin assumed | Documented, ADR 0003, ADR 0006, ADR 0030 |
| Reference contract does not enforce the total-balance cap and runs one claim window at a time | Documented, `PrizePool.compact` |
| `W_max = cap x interval length = 9 x 10^11` micro-`tMIX`-seconds | Derived from the Documented inputs |
| `P = sum w / (n W_max)`; winner proportional to `w` | Derived (#52 section 4.6, rechecked by script and Monte Carlo) |
| Tries needed `ln(1-T)/ln(1-P)`; proportionality survives `k` tries | Derived |
| Chain cannot tell reject from absent; later claims wait for earlier windows | Derived (#52 4.6); the ordering rule matches the issue text and ADR 0030 |
| Claim relation 8,405 rows, k=14 regardless of participant count; reduction 341 rows | Observed, inherited from #52 and #50 (mock-compile only) |
| Tree capacity `2^32` leaves | Documented, #50 section 2.2 |
| Poisson online model, balance distributions other than equal/whale | Assumption |

## 8. Not established

1. A measured capacity of family 6B, and any real proof, proving time or key size for the claim relation. Only #52's `mock-compile` figures exist.
2. The distribution of real balances and of leaf counts per identity; every distribution here is a worked example.
3. Whether the design counts retired leaves, split notes and dust leaves in `n`, and any bound on them (#52 section 5.1 items 5 and 6). Section 3.4 shows `P` is sensitive to this.
4. Whether an aggregate weight or aggregate Principal is obtainable in family 6B (section 2.3), which would lift `W_max`.
5. Owner presence: how often the owner of an accepted leaf is online within a window of a given length. The ADR 0006 owner-offline rollover rate for the current design is likewise unknown.
6. Whether a window shorter than sixty minutes per owner satisfies ADR 0030, and the value of any bounded network-time margin (ADR 0030 says none is assumed).
7. Yield behaviour on rolled intervals (how the rolled Prize combines with the next Prize), so the expected prize per award is not stated.
8. How `2k` independent 248-bit samples are derived from one reveal and what that costs in a circuit; the cost of a draw-level "closed" write for concurrent windows (S3).
9. Whether an owner "decline" action is expressible without revealing information about the leaf, and whether it would count as a per-draw participant action.
10. The `blockTime` predicates' granularity and the margin they impose on sub-minute windows (relevant to `60/k` windows below one minute).

## 9. Sources

- Issues [#49](https://github.com/MrSufferer/shroudly/issues/49), [#52](https://github.com/MrSufferer/shroudly/issues/52), [#53](https://github.com/MrSufferer/shroudly/issues/53), [#54](https://github.com/MrSufferer/shroudly/issues/54).
- Repository: `docs/adr/0003-stage-randomness-trust-by-release.md`, `0006-use-continuous-weight-and-prize-rollover.md`, `0027-preprod-safety-constants.md`, and (maintainer checkout, not on this branch) `0028-cap-total-participant-principal.md`, `0030-preserve-usable-preprod-claim-windows.md`; `midnight/CONTEXT.md`; `midnight/PrizePool.compact`; `docs/preprod-technical-spec.md`.
- Research branches (read with `git show`, not merged): `origin/research/candidate-screening` (`docs/research/unattended-selection-candidate-screening.md`, sections 4.6, 5.1, probe B), `origin/research/unbiased-sampling` (`docs/research/unbiased-sampling-onto-total-weight.md`, sections 1 and 2), `origin/research/compact-hidden-state-expressiveness` (`docs/research/compact-hidden-state-expressiveness.md`, sections 2.2, 2.3, 3.2, 4).

## Appendix: reproduction script

Save as `award_probability.py` in a directory that contains no other Python files (for example a fresh empty directory), then run:

```text
python3 -I award_probability.py
```

Standard library only; deterministic (the Monte Carlo check uses a fixed seed and runs in about a second). The output of this script is the source of every table above (section 6.4's table is rounded to three significant figures).

```python
"""Reproduces every number in docs/research/6b-award-probability.md.

Run:  python3 -I award_probability.py
Standard library only. Deterministic (fixed seed for the one Monte Carlo check).
"""
import math
import random
from fractions import Fraction as Fr

# ---- Constants (sources: ADR 0027/0028, midnight/CONTEXT.md, PrizePool.compact) ----
UNIT = 10**6                 # micro-tMIX per tMIX (ADR 0027, six decimals)
CAP_TMIX = 1000              # Contribution Bound, total Principal per identity (ADR 0028)
L = 900                      # Draw Interval, seconds (ADR 0003/0006; PrizePool.compact +900)
WMAX = CAP_TMIX * UNIT * L   # micro-tMIX x seconds
CADENCE_MIN = 15
CLAIM_MIN = 60


def fmt(x, nd=4):
    return f"{float(x):.{nd}g}"


print("== Constants ==")
print(f"W_max = {CAP_TMIX} tMIX x {L} s = {WMAX:,} micro-tMIX*s  (log2 = {math.log2(WMAX):.2f})")
print(f"tMIX*s form: {CAP_TMIX * L:,}")


# ---- Award probability P = sum(w) / (n * W_max) ----
def P_of(balances_tmix, n=None):
    n = n or len(balances_tmix)
    tot = sum(Fr(b) * UNIT * L for b in balances_tmix)
    return tot / (n * WMAX)


print("\n== Table 1: n leaves, all live for the full interval ==")
ns = [5, 16, 64, 128, 1024]
print("| Distribution | " + " | ".join(f"n={n}" for n in ns) + " |")
print("|---|" + "---|" * len(ns))
for label, b in [("equal 1 tMIX", 1), ("equal 10 tMIX", 10), ("equal 100 tMIX", 100),
                 ("equal 500 tMIX", 500), ("equal 1000 tMIX (all at cap)", 1000)]:
    print(f"| {label} | " + " | ".join(fmt(P_of([b] * n)) for n in ns) + " |")
print("| one 1000 tMIX + (n-1) x 1 tMIX | "
      + " | ".join(fmt(P_of([1000] + [1] * (n - 1))) for n in ns) + " |")
print("| one 999 tMIX + (n-1) x 1 tMIX | "
      + " | ".join(fmt(P_of([999] + [1] * (n - 1))) for n in ns) + " |")
unif = Fr(1 + 1000, 2) / 1000
logu = (Fr(1000 - 1) / Fr(math.log(1000))) / 1000
print("| uniform balances on [1,1000] tMIX (expected) | " + " | ".join(fmt(unif) for _ in ns) + " |")
print("| log-uniform balances on [1,1000] tMIX (expected) | " + " | ".join(fmt(logu) for _ in ns) + " |")
print("note: with every leaf live for the full interval, P = mean(balance)/1000 tMIX, independent of n")
p5 = P_of([1000, 1, 1, 1, 1])
print("whale+4 small, n=5 exact:", p5, "=", float(p5))

print("\n== Table 2: leaf-count inflation (every leaf counts in n) ==")
print("| 5 identities at b tMIX plus m extra leaves of 1 tMIX | m=0 | m=10 | m=100 | m=1000 |")
print("|---|---|---|---|---|")
for b in (100, 1000):
    row = [P_of([b] * 5 + [1] * m) for m in (0, 10, 100, 1000)]
    print(f"| b={b} | " + " | ".join(fmt(p) for p in row) + " |")
print("one identity of 1000 tMIX alone, split into s equal notes, P = 1/s:",
      [fmt(Fr(1, s)) for s in (1, 2, 10, 100, 1000)])
print("retired leaves stay in n with w=0: 5 identities at cap, c prior balance changes each, P = 1/(1+c)")
for c in (0, 1, 9, 99, 999):
    print(f"  c={c}: n={5 * (1 + c)}, P={fmt(Fr(5, 5 * (1 + c)))}")

print("\n== Table 3: rollover statistics for a single try (15-minute cadence) ==")
Ps = [Fr(1, 1000), Fr(1, 100), Fr(1, 20), Fr(1, 10), p5, Fr(1, 2), Fr(1)]
print("| P | rollover 1-P | expected intervals to first award | expected wait | P(no award in 96 intervals = 24 h) | awards per day |")
print("|---|---|---|---|---|---|")
for p in Ps:
    if p == 1:
        print("| 1 | 0 | 1 | 15 min | 0 | 96 |")
        continue
    ei = 1 / p
    mins = float(ei) * CADENCE_MIN
    wait = f"{mins:.0f} min" if mins < 120 else (f"{mins / 60:.1f} h" if mins < 2880 else f"{mins / 1440:.1f} d")
    print(f"| {fmt(p)} | {fmt(1 - p)} | {float(ei):.4g} | {wait} | {float((1 - p) ** 96):.3g} | {float(96 * p):.3g} |")

print("\n== Table 4: independent tries needed, k >= ln(1-T)/ln(1-P) ==")
targets = [Fr(1, 2), Fr(9, 10), Fr(99, 100), Fr(999, 1000)]
print("| P per try | " + " | ".join(f"target {float(t)}" for t in targets) + " |")
print("|---|" + "---|" * len(targets))


def k_needed(p, t):
    return math.ceil(math.log(1 - float(t)) / math.log(1 - float(p)) - 1e-12)


for p in [Fr(1, 1000), Fr(1, 100), Fr(1, 20), Fr(1, 10), p5, Fr(1, 2)]:
    print(f"| {fmt(p)} | " + " | ".join(str(k_needed(p, t)) for t in targets) + " |")
k999 = k_needed(Fr(1, 1000), Fr(999, 1000))
print("check: P=1/1000, T=0.999 -> k =", k999, "; 1-(1-P)^k =", 1 - (1 - 0.001) ** k999,
      "; k-1 gives", 1 - (1 - 0.001) ** (k999 - 1))

print("\n== Table 5: sequencing arithmetic ==")
print("Per draw d (T = weighting close): commit cutoff T-3 min; reveals close T+5 min; earliest finalize F=T+5 min;")
print("nominal claim window [F, F+60]; draw d+j closes at T+15j and finalizes at F+15j.")
print("| k tries | partition: window per try (min) | partition: per try (s) | back-to-back 60-min windows: span (min) | draws open at once | first later draw finalizing after the span | 2k reductions x 341 rows |")
print("|---|---|---|---|---|---|---|")
for k in (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60):
    span = CLAIM_MIN * k
    print(f"| {k} | {CLAIM_MIN / k:.4g} | {3600 / k:.4g} | {span} | {math.ceil(span / CADENCE_MIN)} | d+{span // CADENCE_MIN + 1} | {2 * k * 341:,} |")
print("partition span is always 60 min: draws open at once =", math.ceil(CLAIM_MIN / CADENCE_MIN),
      "; first later draw finalizing after the span: d+", CLAIM_MIN // CADENCE_MIN + 1)

print("\n== Table 6 (illustration, assumed model): selected owner online as a Poisson process, rate lam per hour ==")
print("q(Lmin) = 1 - exp(-lam * Lmin/60); P_eff = 1 - (1 - P*q)^k")
print("| lam per hour | P | k=1 (60 min) | k=2 partition (30 min each) | k=4 partition (15) | k=12 partition (5) | k=4 concurrent (60 each) | k=12 concurrent (60 each) |")
print("|---|---|---|---|---|---|---|---|")


def peff(p, k, Lmin, lam):
    q = 1 - math.exp(-lam * Lmin / 60)
    return 1 - (1 - float(p) * q) ** k


for lam in (0.25, 1, 4):
    for p in (Fr(1, 10), Fr(1, 100)):
        print(f"| {lam} | {fmt(p)} | {peff(p, 1, 60, lam):.4g} | {peff(p, 2, 30, lam):.4g} | "
              f"{peff(p, 4, 15, lam):.4g} | {peff(p, 12, 5, lam):.4g} | {peff(p, 4, 60, lam):.4g} | "
              f"{peff(p, 12, 60, lam):.4g} |")

print("\n== Sampling bias bound for the two public draws (#51: TV <= T/(4N), N = 2^248) ==")
for label, T in [("leaf index over n <= 2^32 leaves", 2**32), ("threshold over W_max", WMAX)]:
    print(f"{label}: T={T:,} (log2 {math.log2(T):.2f}); TV bound = 2^{math.log2(T) - 2 - 248:.1f}")

print("\n== Monte Carlo check (seed 54): 6B with k tries, balances [1000,1,1,1,1] tMIX, n=5 ==")
rng = random.Random(54)
bal = [1000, 1, 1, 1, 1]
w = [b * UNIT * L for b in bal]
n = len(w)
trials = 400_000
for k in (1, 3, 10):
    wins = 0
    byleaf = [0] * n
    for _ in range(trials):
        for _t in range(k):
            i = rng.randrange(n)
            u = rng.randrange(WMAX)
            if u < w[i]:
                wins += 1
                byleaf[i] += 1
                break
    exact = 1 - (1 - float(p5)) ** k
    print(f"k={k}: simulated award rate {wins / trials:.5f}, closed form {exact:.5f}; "
          f"winner share of the 1000-tMIX leaf {byleaf[0] / wins:.5f} vs proportional {bal[0] / sum(bal):.5f}")
```
