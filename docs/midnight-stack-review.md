# Midnight stack review — second grilling round

Status: all seventeen recommendations accepted by the user on 2026-10-16, including reconciliation of selected prototype C. Consolidated shared understanding confirmed by the user on 2026-10-16; canonical PRD/ticket publication completed and verified on 2026-10-16. The stack remains unqualified; this review is not a successful feasibility result.

Read with [the accepted technical specification](preprod-technical-spec.md),
[the context map](../CONTEXT-MAP.md), and ADRs 0001, 0005, 0011, and 0013.
Earlier accepted requirements remain binding. This review does not certify a
deployment or change GitHub acceptance criteria before shared understanding.

## Evidence collected

- `midnight/version-profile.json` and root `package.json` pin split
  `@midnight-ntwrk/midnight-js-*` packages at 4.1.1, Compact runtime 0.16.0,
  Wallet SDK 1.2.0, and `@midnight-ntwrk/ledger-v8` 8.1.0. The profile's
  `node: 1.0.2` denotes the Midnight node; root `engines.node: >=22` denotes
  Node.js. These are distinct components.
- The supplied Midnight skills provide review topics, but their umbrella SDK
  imports and version tables are not the repository's compatibility evidence.
  Current documentation is likewise not proof that examples work with these
  exact pins. Verify pinned declarations and a genuine compiled/network path.
- `midnight/PrizePool.compact` labels non-exported ledger fields private while
  storing participant balances and weights in them. Official Compact reference
  documentation describes `ledger` as public state; `export` changes external
  accessibility, not confidentiality. This conflicts with ADR 0005 and requires
  a contract privacy redesign, not merely hiding fields in the UI.
- `PrizePool.compact`'s `finalize` accepts a nonzero caller-supplied
  `randomnessAggregate`. Pinning `randomnessComponent` does not itself bind
  that value to an accepted finalized dependency result. Its source comments
  acknowledge the missing cross-contract invocation. The exact supported
  authenticated composition mechanism is still unverified. ADRs 0001 and 0013
  prohibit making the off-chain caller financially authoritative.
- Contribution, weighting, selection, and claim paths compare caller-supplied
  `now` values. Official standard-library documentation supplies block-time
  predicates. The exact pinned implementation must bind economic deadlines
  to network-enforced time constraints; a caller comparison alone is not
  evidence that a cutoff is enforced.
- `apps/web/src/App.tsx` constructs the production `MidnightPreprodAdapter`
  without a concrete runtime or state reader. The adapter provides explicit
  integration seams and fails closed. This is not a completed browser SDK
  composition. Official provider documentation separates private state,
  public data, ZK artifacts, proof, wallet, and submission providers.
- Existing accepted local-proving and durable-private-state requirements need
  a genuine supported-browser implementation. Node filesystem ZK providers
  and a Node-oriented private-state example do not establish browser support.
  Whether local proving requires a participant-operated local service remains
  a qualification question; do not silently introduce hosted proving.

## Primary documentation retrieved

Context7 resolved `Midnight` to `/midnightntwrk/midnight-docs`; fetched separate
Compact privacy/time and SDK-provider queries. These are current indexed
references, not a version-specific compatibility attestation:

- [Compact language reference](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/compact/reference/compact-reference.mdx)
- [Compact security guidance](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/compact/smart-contract-security.mdx)
- [Standard-library exports](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/compact/standard-library/exports.md)
- [Block-time introduction and semantics](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/relnotes/compact/compact-0-17-25-0.mdx)
- [Provider configuration](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/configure-providers.mdx)
- [Midnight.js provider reference](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/midnight-js/README.md)

## Round-one decision frontier

All six recommendations below were accepted by the user ("yes to all") on 2026-10-16:

1. Retain the pinned profile as the candidate baseline; qualify it rather than
   copying skill examples or automatically upgrading packages. Upgrade only
   where a demonstrated requirement needs it, with a replacement profile.
2. Preserve ADR 0005's privacy contract; require an adversarial public-ledger
   disclosure audit and a genuine private-state design before qualification.
3. Require contract-enforced dependency authenticity. First prove a supported
   composition mechanism on the candidate profile. If unavailable, bring an
   explicit topology/profile change back for decision rather than trusting a
   backend's reported result. A topology change may require revisiting ADR 0013.
4. Require network-enforced deadlines and test early, late, stale, and forged
   caller times against the pinned runtime. The fifteen-minute UTC schedule
   and finalized-selection claim-window policy remain the product requirements.
5. Require one genuine supported-browser vertical slice before broad integration:
   connect, unlock, durable prepare, prove, authorize/fund, submit, observe
   finality, reload, and recover. Determine the actual local-proving setup and
   participant instructions through this experiment, without adding hosted
   proving or promising an installation-free journey.
6. Permit the separate UI prototype to proceed with clearly simulated state
   while stack verification continues. Use the historical screenshot as a
   starting point; show three structural variations and critical recovery and
   pending-action states. Do not claim simulated success qualifies the stack.

Dependency authenticity also applies to yield: `YieldAdapter.compact` advances
an accounting reserve while the pool receives shielded reserve funding through
a separate path. Verification must bind actual custody and exactly-once yield
allocation, rather than treating a checkpoint counter as funded Prize value.

Dependent questions for later rounds include the supported wallet/proving
installation journey, bounded timestamp tolerance, concrete private-state and
dependency-proof designs, measured cohort capacity, and any necessary profile
or ADR changes. Their prerequisite investigations remain open; they are not
silently delegated to implementers as product choices.


## Second-round evidence and accepted decisions

Official indexed documentation retrieved on 2026-10-16 identifies the following
constraints. They still need confirmation against exact pinned artifacts and
live network support before implementation is qualified:

- [Contract-call semantics](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/concepts/how-midnight-works/building-blocks.mdx)
  explicitly states cross-contract calls require ledger v9, 0.31.x targets
  ledger v8, and deployed networks described by that document run ledger v8.
  Multi-call SDK batching and importing a module are not substitutes for
  contract-enforced authentication between separately deployed components.
- [Wallet integration](https://github.com/midnightntwrk/midnight-docs/blob/main/sdks/community/wallets/integration.mdx)
  and [wallet overview](https://github.com/midnightntwrk/midnight-docs/blob/main/sdks/community/wallets/wallets-overview.mdx)
  describe Lace as requiring a local proof server; its `getProvingProvider`
  forwards requests there. The generic connector abstraction does not itself
  establish proving locality. Qualify the actual supported Lace version,
  provider implementation, endpoint, and deployment configuration. These
  primary-repository wallet guides cover community integrations; do not treat
  their latest version descriptions as attestation of our pinned release.
- `PrizePool.compact` derives ownership from secret plus salt. Fresh credentials
  produce new identities. `connector.ts` uses wallet-extension discovery keys
  such as `lace` as `walletId`; that key is not a participant account identity.
  `preprod-adapter.ts` recovery scoping must not conflate the two. Installed
  package declarations are unavailable in this checkout (no node_modules), so
  the local structural adapter types have not been verified against them.

All four recommendations below were accepted by the user ("yes to all") on 2026-10-16:

7. Prefer one contract containing the pool, randomness verification, and
   simulated-yield accounting as separate source modules where necessary on
   the supported profile. Keep asset separation only where custody is genuinely
   enforceable. Prototype this boundary before replacing ADR 0013; do not wait
   for an unqualified ledger-v9 migration or accept backend-reported results.
   Reassess the shared upgrade/security boundary explicitly.
8. Support participant-operated local proving for the initial Lace/Chrome
   Preprod release, with setup instructions, readiness checks, and useful
   unavailable-prover messaging. No automatic hosted fallback. Prove that the
   configured provider preserves the accepted locality before contributions.
9. Define the cap identity as a deployment-scoped cryptographic participant
   credential, preserved across its notes, recovery, reloads, and transfers.
   A fresh independent credential can bypass the cap under the accepted Sybil
   limitation. Do not promise a per-wallet or per-person limit, or use extension
   discovery IDs to scope financial private state.
10. Begin the privacy redesign with committed state and private transition
    proofs, auditing actual public transcripts and state for linkage. Treat
    this as a feasibility experiment, not a selected, proven protocol. Do not
    restore public participant balances or weights merely to meet performance
    goals; bring demonstrated feasibility trade-offs back to the user.


## Third-round evidence and accepted decisions

The existing pool's public balance/weight maps make permissionless selection
possible without participant secrets. Hiding these fields removes the prover's
input access; commitments alone do not give automation their openings. The
accepted automatic carry and catch-up requirements must be demonstrated by a
new construction, not assumed to follow from zero-knowledge verification.
The randomness contributors are operational signers, not ordinary savers;
requiring a participant contribution every draw would be a product change.
See `PrizePool.compact`'s `drawWeight` and `finalize`, ADR 0003, and the
technical specification's Principal and draw lifecycle sections.

[Official witness documentation](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/private-state-witnesses.mdx)
describes witnesses as locally supplied, untrusted private inputs that need
circuit constraints. [Official time guidance](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/security-best-practices.mdx)
describes block-time comparison predicates, no raw block-time accessor, and
block-scale timing accuracy. Neither proves an exact finalized-selection clock
for the pinned profile. The current finality adapter records three booleans
and the browser supplies receipt time; these are not an authenticated contract
clock. A follow-up activation transaction would also need authenticated timing,
anti-delay rules, and bounded behavior; it is not automatically a solution.

All three recommendations below were accepted by the user ("yes to all") on 2026-10-16:

11. Preserve automatic draw participation while ordinary participants are
    offline. Require a feasibility demonstration of private weighted settlement
    and catch-up without collecting participant secrets or requiring per-draw
    participant transactions. Do not silently change to recurring check-ins,
    equal-weight selection, or trusted operator computation if it fails.
    **Superseded by ADR 0031 (2026-10-18):** no viable Unattended Selection
    exists on Preprod; interim selection is Operator-computed with the privacy
    loss disclosed. Kept for the record.
12. Permit a conservative, explicitly bounded block-time margin in the claim
    deadline if needed to ensure the promised sixty usable minutes after
    finalized selection. Determine and document the actual bound through the
    pinned-runtime experiment before accepting it as a release constant.
    Unbounded operator extensions and browser-clock authority remain forbidden.
    If this cannot be enforced, return the clock design for an explicit decision.
13. Preserve withdrawals during unresolved historical draws whenever private
    state and safety checks permit them, carrying all affected historical
    weights and segregated liabilities forward. Do not require settlement of
    the backlog as an additional exit condition. Demonstrate this in the
    privacy feasibility experiment rather than promising recovery without
    witness material or during a legitimately enforced withdrawal pause.

Clarified already accepted ADR 0028's contribution/identity semantics and ADR
0029's browser/device exclusion scope to match prior resolved requirements.
Added Participant Identity to the Prize Pool context. These are documentation
clarifications, not evidence the implementation enforces them. Final topology
ADRs, canonical spec changes, and GitHub publication wait for the completed
interview and shared-understanding confirmation.


## Selected prototype reconciliation — 2026-10-16

The user selected **C — The draw journal** in a separate prototype session.
Selection approves the visual direction, not fixture copy, values, technical
claims, product policies, or qualification. Source: local branch
`prototype/shroudly-ui-directions`, selection commit `797432e`, prototype capture
`95936c7`; `apps/web/src/prototype/README.md` documents scenarios and limits.
The worktree is `/private/tmp/shroudly-ui-prototype`. Review used its README,
`PrototypeApp.tsx`, and selected desktop/narrow screenshots. The incoming handoff
is the temporary `shroudly-selected-design-prd-grilling-handoff.md` in the
session's OS temporary directory. No new prototype or GitHub mutation was made.

C places current draw chronology beside the private position and moves the
position first on narrow screens. Its single-claim fixture and independent
scenario switches do not establish combined-state behavior. Existing policy
already requires multiple per-draw liabilities, affected-action blocking,
safe claims/exits, local-prover readiness, and distinguishing unknown outcomes
from failure. Apply those requirements to combinations such as an expiring
claim plus an unresolved deposit, unavailable prover, stale backup, or backlog.
Do not inherit the fixture's blanket `pending` claim disablement without proving
the actual state conflict. Draw history must distinguish unresolved selection,
unchecked private eligibility, verified outcomes, claims, expiry, and rollover;
unavailable or locked state cannot establish that no prize exists. Verify final
privacy copy against real public transcripts; screenshot text is not evidence.
Responsive screenshots do not qualify mobile financial actions.

The user accepted all four recommendations below on 2026-10-16. Together with
decisions 1–13, these complete the current interview frontier. Consolidated
shared understanding was confirmed on 2026-10-16; canonical publication completed and was verified on 2026-10-16.

14. Prioritize discovered claimable prizes with a prominent unlocked-session
    shortcut before routine journal content, ordered by nearest enforceable
    deadline. Keep the chronological journal and separate claims; do not
    auto-claim or promise a new window because the participant checked late.
15. Give unsupported environments a public read-only journal and clear supported
    desktop setup guidance. Keep private-state import/unlock and financial
    actions within the qualified profile; do not imply that opening the same
    credential concurrently on a desktop is a safe handoff.
16. Offer an explicit hide-values control and session lock. Lock/disconnect clears
    decrypted state and keys from application memory while preserving encrypted
    durable state and pending reconciliation. Define no arbitrary inactivity
    timeout in this round. Hidden values alone are not a security lock.
17. Keep Preprod claim checking in the unlocked application, with a clear advance
    disclosure that offline participation does not claim prizes or notify the
    participant. No email/push prize alerts or linkage of a Backup Account to
    winning status is assumed. External reminders require a separate privacy
    and delivery design if requested.

The selected prototype reconciliation introduces no further unresolved product
choices. Actual action-conflict detection, clearing sensitive memory, deadline
enforcement, and transcript privacy remain implementation/evidence obligations.

## Consolidated shared understanding — confirmed 2026-10-16

Retain React/Vite/TypeScript and the existing hosting/service responsibilities.
Use the exact Midnight package profile as a candidate to qualify, not as a
certified stack or an instruction to adopt the examples in the supplied skills.
Mainnet stays gated. No genuine runtime or contract changes were made by this
interview, and no fresh compile, proof, or network transaction was performed.

The preferred topology experiment combines pool accounting, randomness
verification, and simulated-yield accounting within one contract, using source
modules for separation. Asset separation remains conditional on demonstrated
custody enforcement. ADR 0013 still records the current accepted topology;
record the conditional experiment explicitly and supersede that topology only
after a viable result and review of its authority/upgrade boundary. The change
cannot silently expand governance or weaken the existing opt-in migration rule.

Private balances, weights, and ownership relationships must be protected by
real state commitments and constrained proofs. The protocol experiment must
support automatic participation while savers are offline, exact weighted
selection, historical catch-up, and withdrawals without first clearing the
settlement backlog. Commitments alone do not establish those capabilities.
Failure of this experiment blocks qualification and returns a documented
trade-off for decision; it does not authorize public weights, required per-draw
participant check-ins, or operator-held participant secrets.

Participant Identity is a deployment-scoped cryptographic credential. Preserve
it across its actions and recovery; separate it from wallet-extension names
and wallet accounts in state storage. Fresh credentials can bypass its cap.
Existing durable state, reconciliation, optional backup, and safe sponsorship
requirements continue to apply.

The initial supported Lace/Chrome journey may require a participant-operated
local proof service. Verify the actual provider execution path, local setup,
keys, browser storage, and account binding before contributions. Offer useful
setup/recovery messages without automatically switching to hosted proving.
A claim clock must guarantee sixty usable minutes after finalized selection,
with only an explicitly measured and accepted bounded network-time margin and
the already agreed actual-pause extensions. No raw timestamp accessor or future
finality timestamp is presumed available. Failure to demonstrate a valid clock
returns its design for decision.

The separate UI session completed three simulated prototypes from the old
screenshot. The user selected C — The draw journal. Preserve that direction,
with prominent nearest-deadline claim shortcuts in unlocked sessions. Unsupported
devices get a public read-only journal and supported desktop setup guidance,
without private-state import/unlock or financial actions. Add explicit hide-values
and session-lock controls; lock/disconnect clears decrypted state and keys from
application memory while preserving encrypted durable state and reconciliation.
Preprod has no email/push prize alerts: disclose before contribution that offline
participation does not discover or claim prizes for the participant. Earlier
claims remain separate from current participation, and only proven conflicts
block affected actions. UI screenshots do not qualify financial behavior.

## Required feasibility evidence

These are investigation deliverables, not additional unresolved product choices.
Record exact source revision, tool/package versions, circuit/artifact hashes,
reproducer, observed outputs, limitations, and pass/fail status. Never include
secrets, witness openings, or full participant transaction payloads.

| Experiment | Minimum evidence | Consequence of failure |
| --- | --- | --- |
| Contract boundary and custody | Compile and genuinely execute the proposed modules; enforce registered contributor/draw bindings, reject forged randomness and repeated yield allocation, and reconcile reserve accounting with actual shielded custody | Keep release blocked; revisit topology/profile without trusting backend results |
| Private settlement and exits | Adversarial state/transcript disclosure review; cap across split notes; stale-state and nullifier replay rejection; exact weighted winner; offline participants; more than five eligible credentials; catch-up and withdrawal with unresolved intervals | Report protocol/performance trade-off before any product relaxation |
| Network-enforced clocks | Early/late/forged caller times rejected; weighting closes before required reveal; fixed UTC boundaries survive delayed processing; selection/claim timing and pauses are enforceable; actual conservative margin documented | Return clock design and proposed bound for decision |
| Genuine browser lifecycle | Exact supported Lace and Chrome versions; verified local proving; recovery/account isolation; encrypted durable pre-submit state; submit/finality/indexer/fresh query; crash/reload reconciliation and recovery from genuine witness material | No browser or production-operation qualification |

Privacy and topology experiments precede broad financial implementation. A
small browser integration experiment may run independently but cannot qualify
the full product before the contract protocol works. Evidence from compilation,
deterministic models, SDK structure, browser simulation, and finalized network
journeys must remain distinguishable.

## Verified canonical publication scope

The user confirmed this scope on 2026-10-16. Fold these decisions into the existing specification and
matching PRD sections rather than appending duplicate specifications. Preserve
all story numbers, unrelated issue content, issue states/labels, and completed
prior-round work. Read current GitHub bodies before mutation; parent #2 is
already near the body-size limit, so replacement must remain below that limit.

| Tickets | Required refinement |
| --- | --- |
| #2 parent, #3 feasibility | Candidate-stack verdict and four evidence experiments; conditional topology with explicit ADR follow-up; no compile-only qualification |
| #5 asset, #6 randomness, #7 yield, #8 pool, #9 settlement | Co-location experiment and genuine custody; private offline weighted settlement; scoped identity; safe exits with backlog; authenticated deadlines and claim-clock margin |
| #10 facade, #11 private state, #12 backup | Distinct extension/account/credential scopes, preserved identity and witness completeness, crash-safe recovery; existing backup policy retained |
| #14 genuine adapter, #15 UI | Real provider assembly and local-prover readiness; account isolation and genuine browser lifecycle; selected C journal with deadline-prioritized claim shortcuts, explicit lock/hide controls, public-only unsupported-device view, no assumed prize alerts, and combined-state acceptance cases; clearly isolated simulated prototype |
| #16 automation, #17 operations, #18 release | No participant-secret requirement for draw automation; conditional deployment topology and source identifiers; measured qualified profile and explicit proof/privacy/timing evidence |

#4 hosting and #13 sponsorship retain their existing responsibilities; update
only a genuine cross-reference if necessary. The local manifest must match
published bodies. Do not close implementation tickets or turn release flags on.

## Publication verification — 2026-10-16

Published parent #2 and fourteen affected children (#3, #5–#12, #14–#18).
Read back all seventeen issue bodies (#2–#18): every changed body matches its
prepared input and all sixteen child bodies match the local manifest. #4 and
#13 are unchanged. Titles, states and labels are preserved. All 110 parent
story numbers are retained. The parent is 65,213 characters, below the body
limit; its repeated case matrix/component table is condensed while the full
repository specification retains the detail. ADR 0013 remains accepted with
a conditional experiment note; ADR 0030 records the bounded-margin refinement.

`git diff --check` passed. No runtime tests, compilation, proofs, deployment,
commits or network financial actions were performed for this documentation
publication. The stack remains unqualified. The original temporary UI handoff
now points to selected C and the confirmed requirements instead of requesting
a new exploration.
