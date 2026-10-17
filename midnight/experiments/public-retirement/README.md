# Owner-side acceptance sampling with public retirement: decision required

Issue [#22](https://github.com/MrSufferer/shroudly/issues/22) (re-scoped by
[ADR 0031](../../../docs/adr/0031-no-viable-unattended-selection-on-preprod.md)).
Result: **mechanics measured, award probability below the viability floor,
not release-qualified.** `PublicRetirement.compact` is an experiment contract,
not a production contract. Custody is synthetic and draw randomness is
caller-chosen. Production contracts are unchanged.

## Reproduce

Run proof server 8.1.0 on `127.0.0.1:6300`, then:

```sh
pnpm midnight:experiment:public-retirement --record
pnpm test:midnight:public-retirement
```

The runner compiles the contract with keys into ignored `midnight/managed`,
proves every circuit on the proof server, and writes `results.json`. It fails
rather than recording a substitute when the proof server is not 8.1.0. The
record holds measurements, key sizes and hashes, the Git revision and source
hashes. It never holds keys, participant openings, witness transcripts or
proof-server request bodies. The proof tests skip without the proof server;
they are never mocked.

## Measured

* **Mechanics** (`pool.test.mjs`): identity cap across successor notes, stale
  and replayed private state rejected, weight carried forward without
  check-ins, full-exit weight kept for its interval, compaction gated on
  unresolved intervals, withdrawal over an unresolved backlog with constant
  catch-up work, ADR 0030 claim windows, durable single-writer private state
  (ADR 0029) and the five-identity Disclosure Cohort (ADR 0027).
* **Disclosure** (`disclosure.test.mjs`): balances, amounts, weights and
  secrets are absent from every public byte; lineage is public by design.
  Counting live identity tags for the cohort adds no disclosure, but it counts
  credentials, not people (ADR 0028).
* **Real proofs** (`prove.test.mjs`): all six circuits prove on proof server
  8.1.0 into transactions within block limits. See `results.json` for timings,
  sizes and fees.
* **Award probability** (`award.test.mjs`): P = Σ w_k / (n · W_max), checked
  against the contract (u = w − 1 awards, u = w rolls over).

  | Scenario | P | Expected wait |
  | --- | --- | --- |
  | Five steady 1 tMIX identities | 0.001 | 1000 draws, about 10.4 days |
  | One capped 1000 tMIX identity, four at 1 tMIX | 0.2008 | about 5 draws |
  | Five identities at the cap | 1 | every draw |
  | Mid-interval top-up (six slots), then after compaction | 0.000967, then 0.0012 | |

  Public retirement confines churn dilution to the interval it happens in,
  but typical award probability is unchanged from design record 4.1.

## Verification finding

`Transaction.wellFormed` in ledger-v8 8.1.0 JS, with `verifyContractProofs`
set, accepts a proof with a flipped body byte and a proof checked against
another circuit's verifier key. "Well-formed" here is therefore not proof
verification. Both are pinned in `prove.test.mjs`; if they start failing, the
ledger has begun verifying locally.

## Decision required

At P = 0.001 a typical pool awards about once in ten days, and most draws roll
over by rejection. Probabilistic rejection as a third Prize Rollover cause is
undecided and not adopted (ADR 0031), so this design is not viable as
recorded. The remaining changes in the design record (public per-participant
cohort events, a lower effective bound with routine rollover, a compiler-level
absence proof, independent committee parties) need maintainer approval. None
is adopted here.

## Remaining live-network gates

Node-side contract proof verification, draw randomness, asset custody,
network time, and transaction inclusion within the Draw Interval. None was
exercised: no node was run and nothing was submitted to preprod.
