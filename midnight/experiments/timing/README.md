# #23 — Network-enforced draw and claim clocks

`TimingProbe.compact` puts every clock rule behind `blockTimeGreaterThan`/`blockTimeLessThan`, so the Preprod node judges each rule against the block time, not against a time the caller supplies. `run-experiment.mjs` deploys a fresh probe and submits honest and dishonest calls at chosen moments. It records what the node did with each one. `results.json` is the condensed record of the final run (11), produced by `summarize.mjs`. Raw evidence stays local and is gitignored.

## Versions

Measured, not taken from a table:

| Component | Version |
| --- | --- |
| Proof server (local, `127.0.0.1:6300/version`) | 8.1.3 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| `@midnight-ntwrk/wallet-sdk` / facade / dust-wallet / shielded / unshielded | 1.2.0 / 4.1.0 / 4.2.0 / 3.0.2 / 3.1.0 |
| Compact language | 0.23 (`pragma >= 0.22 && <= 0.23`) |
| Network | Preprod through Blockfrost (RPC + indexer) |

These match the profile in `917b470` (`proofServer` 8.1.3, ledger npm 8.1.0). `midnight/version-profile.json` on this ticket's integration base still says 8.1.0. Merging #67 corrects it.

## Commands

```sh
# one live run at a time; reuse the #23 wallet cache copy, never sync from genesis
export SHROUDLY_TIMING_WALLET_CACHE=~/Library/Caches/shroudly/wallet-cache-23
caffeinate -is node midnight/experiments/timing/run-experiment.mjs <env-file> smoke network-smoke-8.1.3.json
caffeinate -is node midnight/experiments/timing/run-experiment.mjs <env-file> full  network-full-8.1.3.json   # ~2 h
node midnight/experiments/timing/summarize.mjs evidence/network-full-8.1.3.json evidence/network-smoke-8.1.3.json results.json [earlier-run.json ...]
node --test midnight/experiments/timing/*.test.mjs
```

Keep the lid open during a full run. `caffeinate` cannot stop clamshell sleep, and run 5 was lost to it. A run now stops once a step starts more than 120 s late, measured after it acquires the wallet lock. It also stops, keeping the wallet lock, when the indexer has not resolved a submitted transaction 24 minutes after submission.

## Schedule under test

Times are UTC seconds. S is the start of a 15-minute interval (S mod 900 = 0).

- Commit window: `[S, S+720)`. The commit cutoff is 3 minutes before the interval ends.
- Reveal window: `[S+900, S+1200)`. These are the 5 minutes after the interval.
- Finalize: at or after S+1200. The caller names the 60 s bucket containing the network time, and the contract asserts it.
- Claim deadline: `selected + 60 + 120 + 3600`, plus any claims pauses for the draw.

## Results (run 11: contract `b9b886a5…6f39`, S = 1792422900, 2026-10-19T15:15Z, source `6d610f2`)

Zero mismatches across 25 steps, plus the 2-step smoke run. "Node 104" means the node refused the submission with `1010: Invalid Transaction: Custom error: 104`.

| Rule | Step | Submitted / block (s from interval start) | Verdict |
| --- | --- | --- | --- |
| Honest commits | `D.commit.slot0`, `slot2` | 45 / 54, 90 / 96 | included |
| Forged clock (circuit evaluated at the previous interval) | `Dprev.commit.slot0.forged` | 120 | node 104 |
| Commit 60 s inside the cutoff | `D.commit.slot1.boundary` | 660 / 666 | included |
| Late commit (circuit evaluated inside the window) | `D.commit.slot3.late`, `late2` | 724, 809 | node 104 |
| Early reveal | `D.reveal.slot0.early` | 860 | node 104 |
| Honest reveals | `D.reveal.slot0`, `slot1` | 945 / 948, 990 / 996 | included |
| Early finalization (circuit evaluated after the window) | `D.finalize.early` | 1050 | node 104 |
| Late reveal | `D.reveal.slot2.late` | 1215 | node 104 |
| Forged selection bucket | `D.finalize.forgedBucket` | 1250 | node 104 |
| Honest finalization | `D.finalize` | 1290 / 1296 | included |
| Second draw D2 | commits, cutoff probes, reveals and finalize | 1370–2136 | all included |
| Scoped claims pause for D | `D.pause.claims` (240 s) | 1470 / 1476 | included |
| Claim while paused | `D.claim.duringPause` | 1540 | node 104 |
| Unrelated deposits pause | `D.pause.deposits` | 1770 / 1776 | included |
| Pause extends D's claim | `D.claim.afterBaseDeadline` | block 1792428126 = base deadline + 186 s, 54 s before the extended deadline | included |
| No grace for D2 (arbitrary or unrelated pause) | `D2.claim.pastBaseDeadline`, at base deadline + 12 s with the circuit evaluated at base deadline − 200 s | — | node 104 |

Each accepted step's block time also replays offline to the same verdict (`replayMatchesNetwork`). Earlier runs differ from their plan only at the timing edges studied below. In run 1 the boundary commit was submitted 9 s before the cutoff and refused. In run 2 the early reveal was submitted 8 s before the window but included after it opened. In run 4 the 15 s cutoff probe was submitted 9.4 s before the cutoff and refused. Each of these led to a schedule change. Run 6 matched its plan on all 25 steps with the contract before the review fixes. Runs 3, 5 and 7–10 stopped on harness or host faults (see hazards) and match their plans on every step they reached. Transaction hashes for every included step are in `results.json`.

### Pause-history accounting

The contract stores pause history in `pauses`. Only pauses of kind `claims` scoped to the draw (or to all draws) extend a claim deadline. The extension is `end − max(start, selected)`. A pause starts at the end of the bucket its transaction names, which is never before the pause's block time, and ends `duration` later. A pause that starts after selection therefore extends the deadline by exactly its duration, and a pause that lands after a deadline cannot reach back and extend it. A claims pause must not overlap the latest claims pause. Deposits pauses are not checked, so they never block one. The probe stops at four pauses because `extendFor` folds a fixed four records. A production contract must not cap the lifetime number of pauses. In run 11 the 240 s claims pause gave D an extended deadline of 1792428180, and a claim landed 186 s past D's base deadline. D2 was selected after both pauses and got no extension: its claim 12 s past the base deadline was refused, even with a forged earlier clock. The deposits pause extended nothing. There is no input that names a grace period, and pauses are capped at `MAX_PAUSE` (86400 s).

## Usable claim window

The window runs from finalization to the base deadline:

| Draw | Finalize block | Finality observed | Base deadline | Usable from block | Usable from observed finality |
| --- | --- | --- | --- | --- | --- |
| D | 1792424196 | 1792424210.3 | 1792427940 | 62.40 min | 62.16 min |
| D2 | 1792425036 | 1792425056.3 | 1792428780 | 62.40 min | 62.06 min |

Both windows stay above 60 minutes. The floor holds by construction, because `selected` is the start of the bucket that contains the block time. Usable time is therefore more than `120 + 3600 − 60` s = 61 min after the block. The FINALITY_ALLOWANCE (120 s) absorbs the 14–23 s seen across runs 6 and 11 between inclusion and observed finality. `timing.test.mjs` checks the same floor offline.

## Margin proposal

Commit submissions near the cutoff, from every run in which the node judged the submission:

| Submitted before cutoff | Runs | Outcome |
| --- | --- | --- |
| 60 s | 4, 6, 11 (and 2, 3, 5) | included, block 54 s before |
| 40 s | 4, 6, 11 | included, block 36 s before |
| 15 s, 14.3 s | 11, 6 | included, block 12 s before |
| 9.4 s, 9 s | 4, 1 | node rejected |
| after the cutoff | 1, 4, 6, 11 | node rejected |

Inclusion latency was 2–7 s in run 6 (median 4, n = 16) and 2–9 s in run 11 (median 6, n = 16). Run 2 saw one 20 s inclusion. The node's refusal edge lies between 9.4 and 14.3 s before a `blockTimeLessThan` bound.

**Proposal:** clients and automation must stop submitting **60 s (one selection bucket) before any closing bound**: the commit cutoff, the reveal close, and the claim deadline. They should start no earlier than **25 s after an opening bound**. This margin is 4× the widest refusal edge seen (14.3 s) and 3× the worst inclusion seen (20 s). Every submission at ≥ 40 s was included. The 60 s figure needs no new contract constant, since it equals `BUCKET`. The usable claim window stays above 60 minutes even after giving up that final minute (62.06 − 1 = 61.06 min from observed finality in run 11). Run 2 showed that opening bounds are judged on block time: a reveal submitted 8 s before the window opened was included at 12 s after. So the opening-side margin protects only the client's own local evaluation. The harness now applies the closing margin to its own claim: `D.claim.afterBaseDeadline` targets 60 s before the extended deadline. Run 6 targeted 14 s before it; run 11's claim landed 54 s before it.

## Known harness hazards

- Use `caffeinate -is` and keep the lid open. Run 4 lost a step to idle sleep, and run 5 to clamshell sleep.
- Run 3: the in-memory DUST view dropped to 0 coins after rejections, while on-chain DUST was intact. `network-session.mjs` reopens from the cache when this happens.
- Honest bucket targets must not straddle a 60 s boundary between local evaluation (target − 25 s) and inclusion (up to target + 25 s). Targets therefore sit 25–34 s into their bucket. `honestBucket` in `plan.mjs` throws if a target straddles a boundary. It checks from the actual start time when a step starts late.
- The wallet lock (`/tmp/shroudly-wallet.lock`) records its owner's PID. It is reclaimed only when that process is dead. A lock with no owner file is waited for.
- `SHROUDLY_TIMING_WALLET_CACHE` must name an existing cache containing all three wallet files. `wallet.mjs` refuses to start otherwise, and never syncs from genesis.
- A provider response without a parseable `Date` header stops the run, rather than letting a NaN clock fire every step at once.
- Run 7 hung for over an hour holding the wallet lock: its first transaction landed at S+48, but the wallet facade's `submitTransaction` never returned because the node's Finalized subscription stalled. Submissions are now bounded at 180 s (`boundedSubmit`). A stalled one is not reverted. Its identifier goes to the indexer watch, and the step records `submitStalled`.
- In run 8, `D.reveal.slot1` landed at E+96 (block 3045535), 6 s after submission. The wallet then threw `ParseError: Failed to parse result provided by node` (no `blockNumber`), and the harness logged it as a rejection. That error now goes to the indexer as an unknown outcome (`submitStalled: 'unparsed-reply'`).
- Run 8 also stopped at `D.pause.claims` because its honest bucket was chosen when the step was scheduled (E+553.8, right after the previous step finalized), not when it started, so an on-time step looked 9 s late. Honest-bucket arguments are now computed once the step holds the wallet lock.
- Run 10 lost its DUST view again after `D.finalize.early` was refused. The reopen from the cache ran while `D.reveal.slot2.late` was balancing and took 164 s (run 9's took 90 s), so `D.finalize.forgedBucket` started 134 s late and the stall guard stopped the run. After every rejection the step now checks the DUST view and reopens if needed (`dustAfterRejection`), while it still holds the lock and before the next step is due.
