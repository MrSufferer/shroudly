# Shroudly

**Private savings. Provable chances.**

Shroudly is a Midnight Preprod proving ground for a shielded `tMIX` prize pool. Contributions, Time-Weighted Principal, threshold randomness, winner ownership, and claims are implemented behind a single `ParticipantApplication` facade. `tMIX` is six-decimal integer test currency with no monetary value.

> Preprod is valueless test infrastructure. It can be reset, is not a Mainnet trust claim, and is qualified only for the supported desktop Chrome/Lace profile. Mainnet transactional entrypoints are absent from this release.

## Fixed Preprod profile

| Constant | Value |
| --- | --- |
| Supply cap | 10,000,000 `tMIX` |
| Faucet | 1,000 `tMIX` per 24-hour epoch |
| Initial Prize Reserve | 1,000,000 `tMIX` |
| Simulated Yield | At most 100 `tMIX` per completed 15-minute draw |
| Contribution | 1–1,000 `tMIX` |
| Disclosure Cohort | Five wallets |
| Randomness | Three contributors, two-of-three reveals, no fallback |
| Full settlement pause | At most 24 hours without renewal |
| Sponsor timeout | Eight seconds |

The accepted compatibility profile is Compact CLI/devtools 0.5.2, Compact language 0.23.0, compiler 0.31.1, runtime 0.16.0, Midnight.js 4.1.1, Wallet SDK 1.2.0, DApp Connector 4.0.1, node 1.0.400, indexer 4.3.302 (Blockfrost-hosted, version unverified), on-chain runtime 3.0.0, and proof server 8.1.3 run locally. See [`midnight/version-profile.json`](midnight/version-profile.json).

## Repository map

```text
apps/web/               Shroudly participant application and Playwright journeys
packages/contracts/     Compact component metadata and reference tests
packages/sponsor/       Stateless DUST Sponsor Service HTTP boundary
packages/randomness-signer/  Contributor-scoped Preprod randomness boundary
midnight/               Four Compact contracts and generated build inputs
scripts/                Compile, profile, health, reset, and evidence commands
docs/operations/        Runbook, incident templates, and evidence conventions
docs/legacy/            Noncanonical historical preview and narrative only
```

## Local development

Requirements: Node.js 22+, pnpm 8.15.9, and the pinned Compact toolchain.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm midnight:compile
pnpm midnight:profile
pnpm build
pnpm dev
```

Copy [`.env.example`](.env.example) to a local ignored environment file. Only the `VITE_SHROUDLY_*` names are browser-safe; credentials remain in provider secret stores. There is no runtime network switch.

Run deterministic unit and browser journeys:

```bash
pnpm test:web
pnpm test:sponsor
pnpm test:e2e
```

Development builds use the deterministic adapter for repeatable local journeys. A production build composes the genuine DApp Connector boundary and requires a Lace wallet discovered at `window.midnight[walletId]`.

## Operations and evidence

The [release runbook](docs/operations/runbook.md) starts from empty provider accounts and documents MFA, permissions, safe variable names, key rotation, migrations, handoff, outage response, and evidence validation. Automation commands are idempotent:

```bash
node scripts/preprod-health.mjs
# Run each command in the isolated contributor runner that owns its seed.
node scripts/preprod-randomness.mjs commit --draw <draw-id> --deployment <deployment-id> --contributor <render|github-actions|offline-maintainer>
node scripts/preprod-randomness.mjs reveal --draw <draw-id> --deployment <deployment-id> --contributor <render|github-actions|offline-maintainer>
node scripts/preprod-evidence.mjs --out evidence/preprod
node scripts/reset-preprod.mjs --deployment <deployment-id>
# Provision the isolated Stage 7 Render services (RENDER_API_KEY is read from
# the process environment; no credential is printed).
node scripts/deploy-render-stage7.mjs
```

Evidence is sanitized, hashed, and tied to the immutable source revision. A transaction is successful only after network finality, indexer visibility, and a fresh ledger-state query. Qualified evidence additionally requires an externally signed attestation from the verifier fingerprint pinned in the reviewed Compatibility Profile; a caller-supplied key alone can never qualify a bundle. Five isolated wallets and the supported Lace gate are human-operated release checks; no automated wallet bridge is bundled.

Every build exposes the non-secret profile at [`/build-profile.json`](apps/web/public/build-profile.json). It includes the contract IDs, source/artifact fingerprints, endpoints, compatibility versions, fixed constants, governance/deployer status, and a SHA-256 snapshot. Provider credentials and wallet material are never emitted.

## Mainnet status

The repository encodes Mainnet interfaces and timings for future review, but disables all transactional Mainnet entrypoints. Legal/name clearance, independent security review, a real shielded asset and audited yield strategy, independent randomness and governance, paid service validation, deployer removal, and canary approval remain `ready-for-human` gates.

## Security

Read [`SECURITY.md`](SECURITY.md) and the accepted ADRs in [`docs/adr`](docs/adr). Do not commit keys, recovery material, decrypted balances, provider tokens, or raw evidence.

## License

[MIT](LICENSE)
