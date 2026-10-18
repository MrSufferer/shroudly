**Part of PRD #2's accepted technical refinement, moved from the issue body on 2026-10-18 to stay within GitHub's body limit. It is unchanged and still binding.**

## Selected participant experience

- Use **C — The draw journal**, selected 2026-10-16, as the visual direction. Prototype branch `prototype/shroudly-ui-directions`, selection `797432e`, capture `95936c7`, source `apps/web/src/prototype/README.md`. Fixtures/copy are not blanket-approved behavior or integration evidence; #15 remains open.
- Keep chronology beside the private position; position comes first on narrow layouts. In an unlocked session, put discovered claimable prizes prominently ahead of routine content, ordered by nearest enforceable deadline. Keep independent per-draw claims; no auto-claim or fresh window for late discovery.
- Distinguish unresolved draws, unchecked eligibility, verified outcomes, claimed, expired and rolled-over states. Locked/unavailable/stale state is not evidence of no prize. Display authoritative deadline and specific blockers, including prover setup; never infer expiry from a browser countdown alone.
- Block only actions with demonstrated conflicts. An unresolved deposit must not automatically block unrelated valid claims/exits. Reconcile the original request, and explain any actual dependency without promising a pause extension for ordinary setup or sponsor delays.
- Unsupported environments get a public read-only journal and supported desktop setup guidance. Private-state import/unlock and financial actions remain within the qualified desktop profile. Responsive screenshots do not qualify mobile; opening another installation is not an implicit safe handoff.
- Provide distinct hide-values and session-lock controls. Lock/disconnect clears decrypted state and keys from application memory while preserving encrypted durable state and unresolved reconciliation. Hiding values is not locking; no inactivity timeout is prescribed here.
- Disclose before contribution that offline participation continues but checking and claiming requires returning within the actual window. Preprod has no email/push prize alerts and no implied linkage of Backup Accounts to winning status. External reminders require a separate privacy/delivery design.

## Acceptance cases and ticket ownership

Every case must specify starting state, trigger, resulting state, participant message, retry/recovery rule and assertions. The full matrix is in `docs/preprod-technical-spec.md` and assigned child tickets:

- #3, #8, #9: capacity above five, cumulative cap across split notes, withdrawals restoring capacity, full withdrawal preserving historical weight, catch-up without blocking safe exits, and separate overlapping claim liabilities.
- #10–#15: delayed sponsor submission, authoritative non-submission, expired approvals, original-request recovery, crash at each submission/finality stage, storage failure, tab exclusion/device handoff, stale/older backups and insufficient witness recovery.
- #6–#9, #15, #16: timely historical reveals versus missed-threshold cancellation, fixed UTC boundaries, pause-adjusted claims and exact deadline boundaries.
- #10–#15: expiring claim combined with pending deposit, unavailable prover, stale backup or backlog; specific blockers, valid independent actions and no duplicate submissions. Lock/disconnect clears memory while encrypted pending records survive. Unsupported visitors receive public-only content.
- #12, #13, #17: deletion/re-enrollment, remaining same-email quota, provider retention and separately preserved unresolved requests.
