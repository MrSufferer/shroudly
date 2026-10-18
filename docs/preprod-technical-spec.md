# Shroudly Preprod technical specification

**Status:** Accepted specification, refined and reconfirmed 2026-10-16. The maintainer confirmed the consolidated shared understanding and authorized publication to the parent PRD and child tickets. This document specifies required behavior, not current implementation capabilities.

## Release boundary

Deliver the Midnight-native public Preprod release described in [PRD #2](https://github.com/MrSufferer/shroudly/issues/2). Mainnet transactional entrypoints remain disabled under ADR 0026. Existing governance, solvency, privacy, randomness, and release-evidence ADRs remain binding.

## Stack and responsibilities

| Component | Selected technology | Responsibility and authority |
| --- | --- | --- |
| Participant interface | React 18.3.1, Vite 7.3.5, TypeScript 5.9.3, Tailwind 4.2.2 | Present journeys through `ParticipantApplication`; never establish financial truth from cached balances |
| Financial authority | Compact on Midnight; conditional co-location experiment | Contracts enforce custody, weights, randomness and liabilities; ADR 0013 remains accepted until the experiment and authority review justify superseding it |
| Compatibility | CLI 0.5.2, language 0.23.0, compiler 0.31.1, runtime 0.16.0; remaining exact pins in `midnight/version-profile.json` | Qualify compiler, keys, wallet, node, proof, and indexer together; version changes require fresh qualification |
| Wallet and proving | Pinned Lace/desktop Chrome profile; DApp Connector boundary; local proving | Participant-operated local proof service, verified setup/readiness, participant authorization and genuine proofs; no silent hosted fallback |
| Local private state | Encrypted IndexedDB and transaction journal | Participant-held witnesses and recoverable action lifecycle; keys stay in session memory |
| Web hosting | Separate environment-locked Vercel project | Static interface and sanitized build configuration; no runtime network switch |
| Sponsorship | Render Sponsor Service | Validate authorized action, cap DUST expenditure, track submission status; no Principal or Prize authority |
| Operational persistence | Supabase | Backup Accounts, encrypted blobs, sponsor quotas and reconciliation; never a participant financial ledger |
| Preprod automation | Scheduled/manual GitHub Actions, isolated randomness contributors | Permissionless deadline-driven calls; outages do not redefine results |
| Authentication mail | Resend | Verification, recovery, and security notices for Backup Accounts; no recovery of encryption keys |
| Monitoring | Better Stack | Redacted availability and incident signals; no witness or participant transaction analytics |
| Verification | Vitest/property checks, Playwright, genuine supported-wallet evidence | Deterministic tests plus qualified finalized network journeys; mock success never qualifies a release |

Package pins above describe the repository inspected during this interview. This refinement does not independently certify provider provisioning, contract deployment, or passing release evidence.

## Principal and eligibility

- One stable contract-proven participant identity within a deployment has at most 1,000 `tMIX` outstanding Principal. Deposits, reloads, recovery, and note splitting must preserve that identity. Identity is a deployment-scoped cryptographic credential, distinct from a wallet account or extension discovery ID. Fresh credentials can bypass the cap; this is not a per-wallet, unique-person, or Sybil-resistance guarantee.
- A new contribution is at least 1 `tMIX`, uses integer micro-units, and must fit remaining Principal capacity. Withdrawals accept any positive representable amount up to outstanding Principal, including full withdrawal or a remainder below 1 `tMIX`.
- Principal remains withdrawable regardless of prize outcome. Confirmed contribution and withdrawal boundaries determine weight; client-clock guesses do not establish inclusion.
- Calculate weight independently for each fixed UTC draw interval. Remaining Principal carries forward automatically while ordinary savers are offline, without per-draw check-ins or operator-held participant secrets. A fully withdrawn identity retains historical accrued weight for its previous interval and has zero future weight unless it contributes again.
- Five positive-weight commitments are the minimum Disclosure Cohort. Set a separate maximum capacity from measured compiler/proving/settlement results, and require support for more than five before qualification. Historical claims do not permanently occupy admission slots.

## Private-state lifecycle

- Scope encrypted state and the durable action journal by network, deployment, and participant identity, with verified wallet-account binding and isolation; an extension ID such as `lace` is not an account or participant identity. Recovery Kit export must include the complete material verified to restore genuine private actions, not just deployment or wallet identifiers.
- Unlock saved state using the participant-held Recovery Kit. Keep the decryption key in memory only. Email login, password reset, and TOTP restore access to remote ciphertext only.
- Before submission, atomically persist the recovery material and intent needed to reconcile the action after a crash. A failed durable write prevents submission. Exact serialization and generated-runtime integration require verification with genuine witness state.
- Observe the action through submission, finality, indexer visibility, and a fresh ledger-state query. Persist reconciled private state and the action outcome without losing the pending journal entry if final persistence fails.
- Restart enters reconciliation for unresolved actions. Do not infer failure from an observation timeout or successful decryption. If state cannot be established, explain the uncertainty and block affected new actions.
- Request browser storage persistence and qualify durability in supported Chrome. If storage cannot meet the requirement, block new contributions while preserving demonstrably safe exits. Do not promise recovery after explicit storage deletion or missing secret material.
- Use same-browser writer exclusion together with the persistent journal: release of a tab lock does not erase an unresolved action. Preprod supports one active browser installation and explicit transfer. Simultaneous copied-kit use across devices is unsupported; do not claim browser locking prevents it globally.

## Backup lifecycle

- Remote backup is optional. Generations advance through compare-and-swap updates; stale uploads do not overwrite current ciphertext or merge private state.
- Show an outdated remote backup warning while allowing actions from verified durable local state. Retry uploads when available and offer an updated local export.
- Restore older ciphertext into a reconciliation flow before affected actions. A successful decrypt does not prove freshness, and missing newer secrets are not assumed reconstructable from the ledger.
- Deletion removes the live Backup Account and ciphertext. Disclose actual verified provider-copy retention and the impossibility of deleting public ledger activity.
- Preserve the remaining rolling twenty-four-hour sponsorship quota on same-email re-enrollment through a minimal keyed email-derived marker until quota expiry. It remains personal data and must be disclosed. Retain unresolved sponsor reconciliation records separately. Avoid retaining raw email or transaction payloads in the quota marker; another email can still bypass a per-email limit.

## Sponsor API and action outcomes

- Submission binds an idempotency key to the original account, deployment, and authorized action. A repeated key with a different action is rejected. Secrets and complete transaction payloads never enter logs or evidence.
- Authenticated status lookup distinguishes `confirmed-not-submitted`, `pending-or-unknown`, `submitted`, and `finalized`. It returns only the information authorized for that request; the exact versioned wire schema remains an implementation deliverable.
- The eight-second request timeout is a UI observation boundary, not evidence of failure. Preserve the action across reload and resume lookup of its original request.
- Only authoritative confirmed non-submission permits a participant-funded fallback. Preserve the intended action; obtain fresh approval when authorization has expired or funding changes require it. Never silently modify an approved financial action.
- Missing/expired records and absence from a lagging indexer mean unknown. If submitted, observe the original transaction. Financial success requires network finality, indexer visibility, and fresh ledger confirmation.
- Retain minimal reconciliation records for unresolved requests. Operators may investigate but cannot override ledger truth or declare a retry safe without authoritative evidence. Show the pending status and support route.

## Draw and claim lifecycle

- Draw boundaries stay on the fixed UTC fifteen-minute schedule; late callers do not shift them. A draw closes weighting before required randomness reveal and selection.
- Each settled draw has its own Winning Commitment, Prize liability, claim nullifier, and published claim deadline. Earlier unclaimed Prizes do not prevent subsequent draws or become available to pay another Prize.
- Preserve existing two-of-three randomness, canonical contributor ordering, no fallback, cohort rollover, reserve segregation, and one-shot private claim requirements.
- Guarantee sixty usable minutes after finalized selection. Permit only a conservative, explicitly bounded network-time margin measured in the pinned-runtime experiment and separately accepted as a release constant; no bound is assumed. Extend the deadline only by the actual duration of an enforced settlement pause that prevents the affected claim. Unrelated pauses do not extend it; operators cannot grant arbitrary grace periods. Record and prove the relevant pause intervals under the existing bounded authority rules.
- Historical draws remain finalizable after an outage if original interval eligibility and timely randomness commitments/reveals are valid. Process them in chronological order while preserving UTC boundaries, segregated liabilities, and at-most-once yield allocation. The bounded catch-up implementation must support resumable work rather than require one unbounded transaction.
- Missing the original reveal threshold cancels that draw and rolls its Prize forward. Late processing cannot admit late reveals or alternate randomness. Contributions during an earlier draw's reveal/claim period accrue only in the currently open interval; they cannot change closed historical weights.

## Contract feasibility and authority

- Treat current exact package/tool pins as a candidate profile, not a qualified stack. Current docs and skill examples do not establish compatibility with pinned declarations, generated artifacts, or the deployed network. No blind upgrades.
- Prefer an experiment co-locating pool accounting, randomness verification, and Simulated Yield accounting in one contract with source modules. Asset separation requires demonstrated custody enforcement. SDK batching and source imports do not authenticate cross-contract results. ADR 0013 remains accepted; supersede it only after a viable result and explicit authority/upgrade review preserving opt-in migration.
- Enforce registered contributor/draw bindings, randomness thresholds, one-shot yield allocation and actual shielded custody in contract constraints. Backend claims or arbitrary caller-supplied results cannot establish financial truth.
- Ledger state is public even without `export`. Use genuine commitments and constrained private proofs for balances, amounts, weights and ownership. Audit public ledger, circuit inputs/outputs, proof transcripts and linkages; do not publish weights to meet performance targets.
- Demonstrate exact weighted settlement with offline savers, more than five eligible credentials, historical catch-up and safe withdrawals while historical draws remain unresolved. Preserve every affected historical weight and segregated liability; backlog alone cannot be an exit condition. Commitments alone do not supply automation witness openings. If infeasible, return an evidenced trade-off for decision before weakening privacy or requiring check-ins.
- Enforce fixed UTC boundaries, weighting/reveal order, claims and scoped pauses against network time. Reject early, late and forged caller times. Neither browser/operator timestamps nor an assumed raw block-time accessor/future finality timestamp are authority.

## Selected participant experience

- Use **C — The draw journal**, selected 2026-10-16, as the visual direction. Prototype branch `prototype/shroudly-ui-directions`, selection `797432e`, capture `95936c7`, source `apps/web/src/prototype/README.md`. Fixtures/copy are not blanket-approved behavior or integration evidence; #15 remains open.
- Keep chronology beside the private position; position comes first on narrow layouts. In an unlocked session, put discovered claimable prizes prominently ahead of routine content, ordered by nearest enforceable deadline. Keep independent per-draw claims; no auto-claim or fresh window for late discovery.
- Distinguish unresolved draws, unchecked eligibility, verified outcomes, claimed, expired and rolled-over states. Locked/unavailable/stale state is not evidence of no prize. Display authoritative deadline and specific blockers, including prover setup; never infer expiry from a browser countdown alone.
- Block only actions with demonstrated conflicts. An unresolved deposit must not automatically block unrelated valid claims/exits. Reconcile the original request, and explain any actual dependency without promising a pause extension for ordinary setup or sponsor delays.
- Unsupported environments get a public read-only journal and supported desktop setup guidance. Private-state import/unlock and financial actions remain within the qualified desktop profile. Responsive screenshots do not qualify mobile; opening another installation is not an implicit safe handoff.
- Provide distinct hide-values and session-lock controls. Lock/disconnect clears decrypted state and keys from application memory while preserving encrypted durable state and unresolved reconciliation. Hiding values is not locking; no inactivity timeout is prescribed here.
- Disclose before contribution that offline participation continues but checking and claiming requires returning within the actual window. Preprod has no email/push prize alerts and no implied linkage of Backup Accounts to winning status. External reminders require a separate privacy/delivery design.

## Acceptance cases and ticket ownership

Each case must specify starting state, trigger, resulting state, participant message, retry/recovery behavior, and assertions. The table assigns responsibility; the final ticket update must link the actual PRD story IDs and GitHub dependencies.

| Case | Required result | Primary tickets |
| --- | --- | --- |
| Repeated deposits exceed 1,000 total | Reject without transfer or state mutation | #8 pool, #10 facade, #15 web |
| Withdraw then deposit; six-decimal remainder | Restore capacity; honor minimum deposit and exact withdrawal accounting | #8, #15 |
| Sixth participant and measured maximum admission | Accept sixth within qualified capacity; enforce separate maximum without changing threshold | #3 feasibility, #8, #9 settlement |
| Full withdrawal partway through interval | Preserve previous accrued weight; no undeserved future weight | #8, #9 |
| Sponsor times out but submits later | No duplicate submission; reload observes original request | #13 sponsor, #14 genuine adapter, #15 web |
| Confirmed non-submission or expired approval | Offer safe fallback; obtain fresh approval where required | #13–#15 |
| Crash before submit, during observation, or after finality | Reconcile from durable journal without losing required witness material | #10 facade, #11 recovery, #14 |
| Local durable write fails | No submission; clear storage error and safe-exit behavior | #11, #14, #15 |
| Two tabs and explicit device transfer | One supported writer; unresolved action survives session closure | #11, #12 backups, #15 |
| Remote outage, stale upload, older restore | Local state can remain usable; no stale overwrite; restore reconciles first | #11, #12, #15 |
| Browser data cleared with insufficient backup | No invented state or support-recovery promise | #11, #15 |
| Earlier prize unclaimed while next draw closes | Separate liabilities and fixed boundaries; no duplicate yield or claim | #7 yield, #8, #9, #16 automation |
| Claim paused for an actual settlement defect | Extend only affected claim by blocked duration; enforce pause expiry and preserve unrelated safe exits | #9, #15, #16 |
| Missed automation or reveal deadline | Finalize valid historical draws in order; cancel missed-threshold draws; preserve current admissions | #6–#9, #15, #16 |
| Expiring earlier claim + unknown deposit/prover outage/stale backup/backlog | Show actual deadline and blockers; preserve independent safe actions and original request; no duplicate claim | #10–#15 |
| Lock/disconnect with unresolved action | Clear decrypted memory; preserve encrypted journal; unlock resumes reconciliation | #10, #11, #14, #15 |
| Unsupported visitor | Public read-only content and setup guidance; no private unlock/import or financial action | #15 |
| Account deletion and re-enrollment | Remove live account/ciphertext; preserve remaining same-email quota until expiry; disclose residual records | #12, #13, #17 operations |

## Four required qualification experiments

Record exact source revision, tool/package versions, circuit/artifact hashes, reproducible commands, observed outputs, limits and pass/fail. Exclude secrets, witness openings and complete participant payloads.

| Experiment | Required evidence |
| --- | --- |
| Contract boundary/custody | Genuinely execute proposed modules; reject forged randomness, contributor/draw mismatches and repeated yield; reconcile liabilities with shielded custody |
| Private settlement/exits | Transcript disclosure review, cap across split notes, stale-state/nullifier rejection, exact offline weighted winner, capacity above five, catch-up and withdrawal with unresolved intervals |
| Network clocks | Reject forged/early/late time; enforce weighting/reveal sequence, UTC boundaries, claim start and pause scope; document measured proposed margin for acceptance |
| Browser lifecycle | Exact Lace/Chrome profile and participant-operated local prover; genuine connect/unlock/durable prepare/prove/authorize/fund/submit/finality/indexer/fresh query; crash/reload and complete witness recovery with account isolation |

Privacy and topology experiments precede broad financial implementation. A small browser experiment may proceed independently. Compilation, deterministic simulation and screenshots do not substitute for genuine proofs or finalized network evidence. Failed feasibility blocks qualification and returns an evidenced design trade-off for decision.

## Implementation and qualification requirements

- Measure supported capacity and actual browser/provider guarantees. Verify genuine witness recovery, authoritative sponsor non-submission evidence, and exact provider retention.
- Define versioned journal, backup, and service schemas, transaction boundaries, migration behavior, bounded polling/catch-up, and pause-history representation against the qualified runtime. These implementation deliverables must preserve the agreed policies rather than introduce new product assumptions.
- Qualify contract privacy against ADR 0005 as well as accounting: public participant balances, individual amounts, or weights cannot be justified by a passing deterministic journey. Every genuine contract property remains a release gate.
- Correct issue dependency numbers, story references, accidental trailing headings, and manifest/issue divergence in the authorized publication. Publish no claim that documentation changes alone close implementation or release gates.

## PRD story traceability

The source PRD has 110 numbered stories. Use the actual numeric stories below when revising tickets, rather than the old sixteen-section manifest's `US-01` through `US-16` references.

| Area | Source PRD story numbers | Native tickets |
| --- | --- | --- |
| Principal cap and withdrawal | 13–18 | #8, #10, #15 |
| Durable state, recovery, and transfer | 48–55, 57, 80 | #10, #11, #12, #14, #15 |
| Sponsor reconciliation | 58–62, 80, 96 | #10, #13, #14, #15, #16 |
| Fixed draws and overlapping claims | 24–25, 27–44 | #6, #7, #8, #9, #15, #16 |
| Interval weight and cohort | 16–17, 29–31 | #8, #9, #15 |
| Privacy and local proving | 8, 45, 48, 77–78 | #3, #11, #14 |

Existing PRD defaults remain binding: missed reveal threshold cancels the draw and rolls its Prize forward without fallback randomness; empty and sub-threshold draws roll over; expired or unclaimed Prizes never become operator property. Late processing cannot authorize a reveal after its original deadline.
