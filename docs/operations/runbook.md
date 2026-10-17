# Shroudly Preprod operations runbook

This runbook is written for an empty-account setup and the pinned Shroudly
Preprod profile. It is intentionally explicit about the boundary between
agent-executable work and actions that require the accountable maintainer.
Never paste credentials, Recovery Kit keys, private witness material, or full
transaction payloads into issues, logs, screenshots, or evidence.

## 0. Release invariants

- The environment is `preprod`; the deployment ID and four contract IDs are
  immutable for a release. There is no browser network switch.
- `tMIX` is valueless test currency. Amounts are six-decimal integer
  micro-units. The fixed constants are recorded in ADR 0027 and
  `/build-profile.json`.
- Mainnet transactional entrypoints are absent and
  `mainnetTransactionsEnabled` is always `false`.
- A command is successful only after network finality, indexer visibility, and
  a fresh ledger-state query. A submitted transaction ID is not evidence.
- The temporary deployer must be removed within 24 hours. The contract locks
  submissions automatically when that deadline is missed.

## 1. Empty-account provisioning (Human Gate)

For the genuine-experiment access slice (#20), start with the narrower
[Preprod access procedure](preprod-access.md). It checks existing access and
the participant-operated local prover without provisioning unrelated services.

1. Create a personal GitHub repository access path, a Vercel Preprod project,
   a Render web service for the Sponsor Service and an on-demand randomness
   signer, a Supabase project, a Resend domain, and a Better Stack workspace.
2. Enable phishing-resistant MFA where the provider supports it; otherwise use
   a unique authenticator-app TOTP and store recovery codes offline. Do not use
   a shared mailbox or shared browser profile.
3. Fund five isolated Preprod wallets plus separate deployer, two-of-three
   governance, emergency, randomness, and DUST accounts. Record only labels and
   public addresses in the release worksheet.
4. Recheck current limits, pricing, retention, and authentication requirements
   in the providers' official documentation at provisioning time. The pinned
   compatibility references are [Midnight's support matrix](https://docs.midnight.network/relnotes/support-matrix),
   [DApp Connector](https://docs.midnight.network/api-reference/dapp-connector),
   and [DUST sponsorship](https://docs.midnight.network/guides/dust-sponsorship).
   Do not encode a free-tier assumption in code or an alert objective.

## 2. Safe configuration names

Browser-visible Vercel variables may contain only non-secret deployment
configuration:

| Name | Purpose | Secret? |
| --- | --- | --- |
| `VITE_SHROUDLY_DEPLOYMENT_ID` | immutable deployment label | no |
| `VITE_SHROUDLY_RPC_URL` | Preprod RPC endpoint | no |
| `VITE_SHROUDLY_INDEXER_URL` | Preprod GraphQL indexer endpoint | no |
| `VITE_SHROUDLY_ZK_CONFIG_URL` | pinned ZK configuration endpoint | no |
| `VITE_SHROUDLY_SPONSOR_URL` | Sponsor Service endpoint | no |
| `VITE_SHROUDLY_{ASSET,RANDOMNESS,YIELD,POOL}_CONTRACT_ID` | deployed public IDs | no |
| `VITE_SHROUDLY_{ASSET,RANDOMNESS,YIELD,POOL}_ARTIFACT_HASH` | source/artifact fingerprints | no |

Keep these names in provider secret stores and inject them only on the server
or workflow runner: `MIDNIGHT_DEPLOYER_SECRET_NAME`,
`MIDNIGHT_GOVERNANCE_SECRET_NAME`, `MIDNIGHT_RESERVE_SECRET_NAME`,
`MIDNIGHT_RANDOMNESS_SECRET_NAME`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RESEND_FROM`,
`BETTER_STACK_HEARTBEAT_URL`, and the Render signer credentials. For the
contributor-scoped Preprod Render boundary, the server-side names are
`SHROUDLY_RANDOMNESS_DEPLOYMENT_ID`, `SHROUDLY_RANDOMNESS_CONTRACT_ID`,
`SHROUDLY_RANDOMNESS_UPSTREAM_URL`, `SHROUDLY_RANDOMNESS_UPSTREAM_TOKEN`, and
`SHROUDLY_RENDER_AUTOMATION_TOKEN`; the contributor runner receives only its
matching endpoint and token. A `VITE_` prefix is never a safe place for a
usable credential.

Vercel variables are the canonical configuration for a deployed build. Run the
profile generator at build time and publish only its sanitized output. A value
change requires a new deployment and new evidence; do not edit a live build.

## 3. Permissions and key custody

- GitHub Actions gets read-only repository access plus narrowly scoped Preprod
  automation credentials. The Render randomness signer can submit only the
  registered contributor action for its deployment and draw domain.
- Render Sponsor Service gets only its Backup Account verifier, bounded DUST
  signer, quota store, and logging destination. It cannot call Principal,
  Prize, governance, emergency, or randomness circuits.
- Supabase service-role access is server-side only. RLS denies public access to
  quota and automation rows. Backup reads/deletes require AAL2.
- Resend is limited to authentication mail from the verified domain. Better
  Stack receives aggregate health and redacted logs.
- Governance and emergency keys are held separately from deployer and
  randomness keys. Record rotation dates, not secret values.

## 4. Deployment sequence

1. Start from `cb4633c` plus reviewed commits. Run `pnpm install --frozen-lockfile`,
   `pnpm check`, `pnpm midnight:compile`, `pnpm midnight:profile`, and
   `pnpm build`. Store the generated source hashes in the release worksheet.
2. Apply the Supabase migration before enabling Backup Accounts. Verify RLS
   with an anonymous client, a normal authenticated client, and an AAL2 client.
3. In the provider's protected workspace, run the read-only gate first:
   `pnpm midnight:deploy:preprod -- --check`. Inspect every check and stop if
   any gate is red; `--check` creates no secrets, state, receipt, or
   transactions. Only after it passes, run
   `pnpm midnight:deploy:preprod -- --submit`. The command runs the
   `pnpm midnight:compile:keys` and `pnpm midnight:profile` preflight, reads
   the deployer and distinct contract authorities from macOS Keychain, checks
   synchronized Preprod NIGHT/DUST balances, and writes only the mode-0600
   `evidence/preprod-stage4.json` receipt. If interrupted after a verified
   transaction, resume with `pnpm midnight:deploy:preprod -- --submit
   --resume`; never edit a receipt. Deploy `TmixAsset`,
   `RandomnessThreshold`, `YieldAdapter`, then `PrizePool`, pinning each
   dependency ID in the next deployment transaction.
   The protected release assembly must bind the generated Compact artifacts to
   the pinned Midnight.js providers, wallet-owned proving API, durable private
   state, and the Keychain-backed deployer. Contract IDs and endpoints alone
   are not sufficient.
4. Using the separately held reserve authority, call the one-shot
   `TmixAsset.seedPrizeReserve(PrizePool)` circuit, then make the one-shot
   isolated evidence fixture allocation through its bounded circuit. There is
   no deployer mint and the asset contract rejects faucet/fixture issuance
   until the reserve has been seeded.
5. Deploy the Sponsor Service and the contributor-scoped randomness boundary;
   configure both health checks at `/healthz`. A service without its complete
   provider-backed configuration fails closed. The Stage 7 provisioning
   command is `node scripts/deploy-render-stage7.mjs`; it creates no provider
   secret values and is safe to rerun against the same service names.
6. Deploy the Vercel Preprod project with the sanitized variables. Verify the
   public `/build-profile.json` matches the release worksheet and contains no
   secret names or values.
7. Enable scheduled GitHub Actions only after endpoint health passes. Use
   `scripts/preprod-randomness.mjs` with isolated contributor secrets; never
   persist an ephemeral seed or retry to prefer a winner.

## 5. Qualification journey

Use five isolated wallets. Four setup wallets make documented qualifying
contributions; the fifth is the primary browser journey. Complete the Recovery
Kit export/restore drill before the first contribution. Advance through the
real commit, reveal, finalization, and claim deadlines. The selected owner is
determined by the contract; claim with that wallet only. Capture one minimal
Lace transaction from the deployed public Vercel build in qualified desktop
Chrome/Lace.

For each transaction record only:

```json
{
  "kind": "contribution | draw | claim | lace-smoke",
  "transactionId": "0x…",
  "networkFinalized": true,
  "indexerVisible": true,
  "ledgerConfirmed": true,
  "deploymentId": "shroudly-preprod-…",
  "sourceRevision": "…"
}
```

The evidence collector rejects a record missing any of the three confirmation
flags. A qualified bundle contains exactly five contribution records, one
contract-selected draw, one claim by that selected owner, and one finalized
Lace transaction, plus at least one scrubbed browser artifact. Browser
artifacts are scrubbed of wallet addresses, commitments, nullifiers, backup
identifiers, and private state before upload. Qualified
evidence also requires an external attestation signed by the verifier whose
public-key fingerprint is pinned in the reviewed Compatibility Profile. A CLI
flag or environment variable supplies public-key material for verification
only; it is not a trust anchor and cannot qualify evidence when the checked-in
fingerprint is absent.

## 6. Monitoring and incident handling

Run the five-minute health check from GitHub Actions and a Better Stack monitor.
An unhealthy RPC, indexer, Sponsor Service, or stale heartbeat produces a
redacted alert and disables automation submissions; participant withdrawals
remain a contract decision. Follow [the incident template](incident-template.md),
record UTC timestamps, and post status updates without transaction payloads.

If deployer removal is not finalized by the 24-hour deadline, submissions lock
automatically. Do not bypass the lock. Escalate to the maintainer and renew
only through the two-of-three governance procedure.

## 7. Rotation, recovery, and billing

- Rotate deployer, randomness, governance/emergency, Sponsor DUST, Supabase,
  Resend, Better Stack, and Vercel credentials on their provider schedule or
  immediately after suspected exposure. Verify the old credential is revoked.
- A Recovery Kit is participant-held. Supabase can restore ciphertext access,
  never plaintext state; a password reset cannot replace the Recovery Kit.
- Retired deployment state is exportable/read-only and rejected by active
  deployment restore. A reset invalidates local archives and starts a new
  deployment generation.
- Monitor provider quotas and billing. A billing failure is an outage, not a
  reason to weaken sponsorship, retention, or finality checks. Keep the
  participant-funded DUST fallback available.
- Schema changes require a reviewed migration, backup/restore drill, and a
  new evidence bundle. Supabase provider copies expire according to the current
  plan's documented retention; public ledger activity cannot be deleted.

## 8. Handoff and release closure

The maintainer performs governance handoff, validates offline keys, removes the
deployer, performs the Lace and Recovery/Backup drills, reviews the sanitized
bundle, and confirms the Actions artifact retention is at least 90 days. Only
then create the immutable tag and GitHub Release. Close child issues with their
evidence links; leave future Mainnet human gates open.
