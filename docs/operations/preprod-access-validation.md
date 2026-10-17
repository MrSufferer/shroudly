# Preprod access validation — 2026-10-17

Access-preparation record for [issue #20](https://github.com/MrSufferer/shroudly/issues/20).
The Operator is the repository maintainer and owner of the protected macOS
session. The experiment runner uses that session only with the Operator's
authorization. No wallet identifiers or usable credentials are recorded here.

## Observed setup

The candidate pins remain those in [the access runbook](preprod-access.md#candidate-compatibility-and-browser-evidence)
and `midnight/version-profile.json`. The selected browser pair is Chrome
**155.0.8059.84** with Lace **2.4.2**. Extension manifests were detected in the
dedicated persistent `shroudly/playwright-preprod` Chrome user-data directory.
The Operator completed wallet setup there and explicitly confirmed that both
Lace and the separate deployment signer have Preprod test funds. This is an
Operator attestation, not an independently measured balance. The Operator
authorized continuation with these protected credentials. Browser lifecycle and compatibility qualification
remain outstanding.

The sanitized CLI run at **2026-10-17T05:20:16.486Z** and separate protected
Keychain metadata checks observed:

| Check | Result |
| --- | --- |
| Deployment signer Keychain metadata | Present; seed not read or validated |
| Private-state password Keychain metadata | Present; password not read |
| Blockfrost authorization | Private Keychain read succeeded; authenticated requests accepted |
| Indexer HTTP | HTTP 200; valid GraphQL response |
| Indexer WebSocket | Valid `graphql-transport-ws` connection acknowledgement |
| Node RPC | HTTP 200; `system_chain` confirmed Midnight Preprod |
| Local proof service | HTTP 200 and exact `/version` response **8.1.0** |
| GitHub repository access | Pull, push, maintain and admin permissions observed |
| Separate Vercel project | `shroudly-preprod` created; authenticated team membership confirmed as `OWNER` |
| Vercel default domain | `shroudly-preprod.vercel.app` is verified |

The prover runs in `shroudly-preprod-proof-server`, published on loopback port
6300 only. The pinned image digest and recovery commands are in the runbook.
Readiness does not establish successful proving.

## Custody and repeatable access

The Operator's macOS Keychain account reference is `shroudly-preprod`.
The deployment signer service is
`com.shroudly.preprod.wallet.shroudly-preprod-deployer`; the private-state
password service is
`com.shroudly.preprod.private-state.shroudly-preprod-private-state-password`;
the provider token service is `com.shroudly.preprod.blockfrost`.
Lace wallet material stays inside its protected extension profile. These
references do not confer signing consent or establish common wallet identity.

Machine-local reference configuration is saved in ignored, mode-0600
`.env.preprod-access.local`. It contains token-free endpoints and reference
names only. Repeat the check from the repository root using Node's data-file
loader, without shell-sourcing the file:

```sh
node --env-file=.env.preprod-access.local scripts/preprod-access.mjs --timeout 10000
```

The CLI reads the provider token privately only for exact approved Blockfrost
Preprod endpoints. macOS may require the Operator to allow Keychain access.
No seed or private-state password is read by the CLI. Rotate or recover
credentials through their respective owners using the runbook.

## Access gate outcome and downstream work

Issue #20's human access-preparation gate is complete. Required secret and
endpoint references are documented and the protected runner's references have
been exercised. This does not assert a qualified or deployed application.

[Issue #24](https://github.com/MrSufferer/shroudly/issues/24) owns genuine browser
integration, including its authenticated network route, and
[issue #26](https://github.com/MrSufferer/shroudly/issues/26) owns canonical,
environment-locked public build configuration. At that stage, populate
`VITE_SHROUDLY_DEPLOYMENT_ID` with the actual immutable deployment label and
configure usable browser-safe endpoints. Blockfrost's authenticated routing
URLs must not distribute the private token through `VITE_*` values. The
documented token-free routing URLs alone do not establish browser access.
Contract IDs and artifact hashes follow genuine deployment.

Vercel account access is verified, not a remaining human gate. A subsequent
authenticated API check confirmed `OWNER` membership in the linked project's
team. That role includes production deployment and environment-variable
management permissions under [Vercel's role model](https://vercel.com/docs/rbac/access-roles).
The project already has the verified default domain
`shroudly-preprod.vercel.app`; no custom domain or external DNS is required for
that route. No deployment has been attempted. Build settings, Git integration
and environment variables are currently unset; completing these is agent
implementation work with the existing authorization, not missing account access.

No placeholder deployment or public credential-bearing build was created.
Mainnet transactional entrypoints remain disabled. The CLI reports
`accessReady: false`, exits 1, and leaves qualification outstanding. These
broader runtime checks remain conservative after closing the access-preparation
gate; genuine browser lifecycle, successful proving and full stack qualification
belong to subsequent experiments.

Earlier credential reads timed out while the login-Keychain prompt was stuck.
After the Operator accepted access and requested a retry, the private read and
all three authenticated network probes passed. The credential value was never
printed or persisted by these checks.
