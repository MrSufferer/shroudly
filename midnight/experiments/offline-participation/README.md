# Offline participation qualification: decision required

Issue [#22](https://github.com/MrSufferer/shroudly/issues/22), parent
[#2](https://github.com/MrSufferer/shroudly/issues/2). Result: **not qualified**.
This directory contains executable Compact evidence and a rejected protocol
probe. It does not implement an accepted private offline selection protocol.
The existing production contracts remain unchanged. No application or interface
adapter should promote these results to a supported participant journey.

## Reproduce

Use the pinned versions in `midnight/version-profile.json`, Node >=22, and:

```sh
pnpm install --frozen-lockfile
pnpm midnight:experiment:offline
pnpm test:midnight:offline
```

The runner compiles the actual `PrizePool.compact` and the isolated probe, then
executes their generated interfaces. It does not execute a TypeScript financial
model. Generated artifacts stay under ignored `midnight/managed`.

To generate keys and a real proof, first run the qualified local proof-server
configured for 8.1.0 on `127.0.0.1:6300`, then:

```sh
pnpm midnight:experiment:offline --prove --record
pnpm test:midnight:offline
```

Runtime-only runs record the proof server as `not-used`. Proving runs record
the configured version as unverified; the runner does not identify or attest the
actual service responding at the endpoint.

`results.json` is the recorded run, containing only synthetic-fixture results,
measurements, artifact hashes, Git revision/working-tree status, and exact hashes
of the Compact and JavaScript experiment sources. No keys, participant openings, private proof
preimages or wallet state are written. Tests characterize the measured failures
through generated contract calls; they are diagnostic checks, not assertions
that the production behavior is correct. Compile before running these tests.

## Measured baseline

Eight independent fresh synthetic credentials were submitted to the real
constructor state. All failed their first contribution with `expected a cell,
received null`. `recordCurrentTwab` looks up a missing account's TWAB before
inserting it; consequently the observed reachable contribution capacity is
zero. This is a concrete baseline initialization defect, not evidence that the
required protocol is impossible.

To isolate subsequent defects, a separate, explicitly **unreachable genesis
fixture** initializes the public balance/TWAB/update maps with zeroes for eight
credentials. It uses compiler-specific raw ledger paths and synthetic coins;
its results cannot qualify genesis, asset custody, or live transactions:

* Five credentials are admitted; the sixth, seventh and eighth are rejected by
  the five-member cohort ceiling. Five is a hard baseline capacity, not merely
  a minimum disclosure threshold.
* Repeating exactly the same owner/note contribution twice with 1,000 `tMIX`
  reaches a public balance of 2,000 `tMIX`. There is no spent account-note
  nullifier or current-state note version check. This proves replay of the
  account-note argument, not replay of a finalized shielded coin transaction.
* The second call's public transcript includes both the participant owner
  commitment and the exact 1,000 `tMIX` amount encoding (99 operations).
  The unexported balance map can be decoded from public consensus state and
  reveals 2,000 `tMIX` directly. Removing `export` is not encryption.
* A one-micro-unit withdrawal at time 10,000 succeeds in generated execution
  while draw 1 remains unresolved. The custody coin is synthetic and has no
  network-finality evidence. This tests a local exit with an old active draw;
  it does not prove retention/settlement of every missed fixed interval.

## Rejected eight-slot commitment probe

`WitnessAvailability.compact` isolates a narrower architectural question:
can commitments alone supply a later caller with the private operands needed
for weighted comparisons? It accepts eight committed positive integer weights,
then constrains every opening and performs cumulative-weight ticket selection.
The worked example is weights 1 through 8, total 36, ticket 35, selecting slot 7.
All eight commitments participate in this circuit; its measured capacity is
eight operands. These are **not eight qualified pool credentials**.

With participant witnesses unavailable, the settlement call fails before any
proof can be built. Supplying all eight weights and openings as a positive
control makes the generated circuit succeed and permits real proof generation.
The recorded run's exact size/timing lives in `results.json` (approximately
4.5 KB proof and seconds of proving on this workstation). The proof server's
`/check` accepts the preimage; `/prove` returns proof bytes. An independent
verifier invocation and a ledger transaction were **not** performed, so proof
generation must not be called independent proof verification or network
acceptance. The successful control violates the no-operator-openings requirement
and is rejected as a release design.

This probe intentionally has no custody, dynamic balance changes, identity cap,
time weighting, interval history, authorization or secure randomness. Its
caller-selected ticket only tests the selection relation. Eight is its fixed
compiled operand capacity, not a measured production capacity or scalability
claim. Increasing vector length, changing names, or substituting a witness
callback that quietly holds participant secrets would not resolve the gate.

## Privacy and authority audit

| Boundary | Baseline | Isolated probe |
| --- | --- | --- |
| Public ledger | Plain Principal reserve, balances, owner-keyed TWAB/update/snapshot maps; exports do not affect visibility | Eight slot/commitment pairs and selected slot |
| Circuit inputs | Private by default; explicit `disclose` publishes action amounts, owners and times to ledger/transcript | Register deliberately discloses slot/commitment; ticket is a private input |
| Circuit outputs | Empty action outputs; owner, amounts and weights still reach public state/operations | Empty action outputs; selected slot disclosed |
| Public transcript | Observed owner and amount encodings; source also discloses selection comparisons | Commitment reads and selected slot write; no explicit plaintext-weight disclosure |
| Private proving material | Witness secrets and coin information; a remote prover must not be assumed private | Both complete vectors of weights/openings are private witness outputs; local prover sees them |
| Linkages | Persistent owner joins deposits, withdrawals and weights; winning hash depends on that owner/draw | Registration slot links commitment to selected slot; no identity anonymity claim |
| Proof bytes | Baseline keys generated during investigation, no baseline call proof claimed | One real positive-control proof; no independent verification or cryptographic privacy audit |

Private inputs, private witness transcripts and proof-server request bodies
must never be copied into public evidence or telemetry. The recorded report
contains counts and hashes only. A proof alone does not establish privacy:
public ledger writes and disclosed comparisons are already observable.

## Unresolved guarantees and decision request

| Required guarantee | Finding |
| --- | --- |
| Fixed UTC intervals and offline carry-forward | Not established. Baseline uses lifetime accumulated TWAB and moves cutoff to caller `now+900`; it does not reset each fixed interval. |
| Full withdrawal retains past and zeroes future weight | Not established. Balance can decrease, but old membership and cumulative TWAB remain; no complete historical interval protocol is qualified. |
| Deployment-stable identity cap across notes | Failed. Owner is `hash(secret,salt)` without deployment binding; mutable salt changes identity. Same-owner cap also fails in measured fixture. |
| Stale account state/nullifier rejection | Failed at account-note boundary; repeated identical note accepted. Shielded coin replay/finality is a separate untested boundary. |
| Sixth eligible credential and capacity >5 | Baseline fails sixth. Probe proves eight committed operands only; production credential capacity remains unqualified. |
| Bounded unresolved history and safe exits | One local old-draw exit observed; arbitrary missed intervals, complete weight retention and bounded processing not demonstrated. |
| Private exact weighted selection without check-ins/operator secrets | Neither baseline nor probe qualifies. Baseline discloses data; probe needs openings unavailable to offline caller. |

The issue permits an explicit decision request when the accepted guarantees
cannot be demonstrated. **Requested decision: keep protocol-dependent release
work gated and authorize a separately reviewed cryptographic design investigation
for unattended private selection**, preserving the accepted no-check-in,
no-operator-secrets and no-disclosure guarantees. This result establishes failure
of the baseline and the conventional commitment/opening candidate; it does not
prove impossibility of all cryptographic constructions.

Participant-present committed transitions can prove caps, ownership, nullifiers
and closed historical segments. Hash commitments and those earlier proofs do
not supply hidden operands for a future random comparison. Homomorphic sums
alone do not supply private comparison/winner extraction. FHE, MPC/threshold
computation, functional encryption or proof-carrying encrypted computation may
change the design, but require explicit output/decryption authority, availability,
privacy, bounded-history and measured cost analysis on the pinned toolchain.
No such construction was implemented here. Returning participants, giving an
operator the openings, or revealing weights are not accepted fallbacks.

Exact arithmetic selection also needs a reviewed random-ticket distribution.
The baseline's 64-bit hash modulo total has modulo bias unless total divides
2^64, even assuming uniformly distributed source bits. The probe does not
resolve this: it accepts a supplied ticket. A later protocol must demonstrate
unbiased sampling and its bounded failure behavior rather than silently equate
modulo reduction with exact probabilities.

## Remaining live-network gate

After an accepted protocol exists: independently verify generated proofs;
exercise actual shielded custody and note/nullifier replay on Preprod; measure
sixth-credential and maximum-capacity proofs/transactions; use ledger time for
fixed UTC boundaries; demonstrate full and partial exits while multiple older
intervals remain unresolved; inspect finalized transaction transcripts/indexer
state for disclosure; qualify randomness bindings, unbiased selection and usable
claim windows; confirm finality plus fresh state queries; then run supported
wallet and deployed browser journeys. There are zero network transactions in
this report. No release/profile gates are changed.

Documentation consulted through Context7:
[generated contract/private witness guide](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/private-state-witnesses.mdx),
[public ledger and disclosure](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/build-a-private-smart-contract.mdx),
[queryLedgerState transcript behavior](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/compact-runtime/functions/queryLedgerState.md),
[persistentCommit API](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/compact-runtime/functions/persistentCommit.md).
Current docs may describe newer compiler capabilities; actual execution above
uses the pinned 0.31.1 compiler and 0.16.0 runtime.
