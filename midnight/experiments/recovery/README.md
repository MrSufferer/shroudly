# Genuine browser recovery experiment — issue #24

**Incomplete unless every acceptance item below has linked evidence; not release
qualification.** `RecoveryProbe.compact` is a valueless diagnostic contract, not
the Prize-Savings Pool or `tMIX`. Its identities and rounds are public by
design (ADR 0005 is not satisfied by this probe). Test fixtures are synthetic.

## What it proves

A participant holds private witness material (`secret`, `round`). The public
ledger holds only `commitment = hash(round, secret)` and a round count. An
action succeeds only with the **current** witness, so decryption never
establishes freshness (ADR 0029): a restored older copy fails the circuit and
`isFresh` blocks new actions.

| Module | Role |
| --- | --- |
| `journal.mjs` | Encrypted (AES-GCM, AAD = store key) versioned private state, durable journal, scope = network/deployment/participant, account binding, CAS on every write |
| `actions.mjs` | prepare (durable) -> `submitting` -> `submitted` -> observe -> fresh ledger -> complete; reconciliation without duplicate submission |
| `kit.mjs` | Recovery Kit export/restore carrying the key, sealed state and unresolved actions (including next witness state) |
| `writer-lock.mjs`, `idb-store.mjs` | Web Locks same-browser exclusion; IndexedDB strict-durability atomic commits |
| `file-store.mjs` | Node durable store (fsync + rename) used only by the Node live journey |
| `probe-runtime.mjs`, `ledger-view.mjs` | Midnight.js executor and ledger projection shared by Node and browser |
| `harness/` | Vite bundle, protected loopback relay, Lace adapter, Operator-run driver |

## Run

```sh
pnpm install --frozen-lockfile
compact compile midnight/experiments/recovery/RecoveryProbe.compact midnight/managed/recovery-probe
node --test midnight/experiments/recovery/*.test.mjs midnight/experiments/recovery/harness/*.test.mjs
pnpm exec playwright test -c midnight/experiments/recovery/playwright.config.mjs   # desktop Chrome IndexedDB/Locks/kill
```

Network steps need the participant-local proof server (see
`../custody/README.md`), the protected access file, and the shared wallet lock
(`mkdir /tmp/shroudly-wallet.lock`, removed right after each settlement):

```sh
# Node participant + protected wallet as the wallet service (not Lace). Writes results/live-preprod-node.json.
node midnight/experiments/recovery/live-journey.mjs /absolute/path/.env.preprod-access.local

# Browser (builds the bundle, serves it on http://127.0.0.1:4177 with a credential-holding relay).
pnpm exec vite build -c midnight/experiments/recovery/harness/vite.config.mjs
node midnight/experiments/recovery/harness/lace-journey.mjs /absolute/path/.env.preprod-access.local preflight <contract>
node midnight/experiments/recovery/harness/lace-journey.mjs /absolute/path/.env.preprod-access.local lace <contract>
```

`lace` mode launches the Operator's Lace Chrome profile
(`MIDNIGHT_CHROME_USER_DATA_DIR`, which must not already be open in another
Chrome) and prints `OPERATOR ACTION:` before each Lace prompt. It records only
sanitized booleans, digests, ledger rounds and outcomes. The provider credential
stays inside the relay process; it is never in page JavaScript.

## Evidence

All live runs used Preprod deployment `2ffeca1b…e7f5` and proof server
`midnightntwrk/proof-server:8.1.3` on loopback.

| Acceptance item | Evidence | Status |
| --- | --- | --- |
| AC1 Lace connection, local proving config | `results/browser-lace.json` `connected`: `io.lace.wallet` 4.0.1 on `preprod`, loopback prover, Blockfrost endpoints | Proven |
| AC1 Lace account binding, funding, submission, finality via Lace | `results/browser-lace.json` | **Unproven** (see Known limits) |
| AC1 proving, funding, submission, finality, indexer visibility, fresh ledger query | `results/live-preprod-node.json` (`deployed`, `register`, `restart-reconcile-*`), protected wallet in place of Lace | Proven without Lace |
| AC1 browser builds a real unproven call; no wallet refuses to connect | `results/browser-preflight.json` | Proven |
| AC2 Recovery Kit restore; stale kit cannot act | `live-preprod-node.json` `restore-current-kit-fresh-profile`, `advance-from-restored-kit`, `restore-older-kit-is-stale`, `stale-kit-cannot-act` | Proven |
| AC2 state and intent durable before submit; blocked on failed write | `live-preprod-node.json` `crash-before-submission`; `browser-qualification.json` `quotaFailure` (0 submitted) | Proven |
| AC2 keys only in session memory | `harness/main.mjs` (kit key never stored); `journal.test.mjs` "nothing in storage contains plaintext witness material or the session key" | Proven by construction and tests |
| AC3 crash before submit / during observation / after finality / during handoff | `live-preprod-node.json` `crash-*` and `restart-reconcile-*` steps, no duplicate submission | Proven (Node) |
| AC4 isolation | `live-preprod-node.json` `init-bob-same-deployment`, `bob-unregistered-while-alice-registered` | Proven |
| AC4 IndexedDB durability, single-writer exclusion | `browser-qualification.json` `abruptKill` (SIGKILL), `writerExclusion` | Proven (headless Chrome) |
| AC4 sanitized evidence, unresolved limitations | All `results/*.json` hold booleans, digests, rounds and outcomes only; Known limits below | Proven |

## Known limits

- **Genuine Lace funding and submission are unproven.** Lace connected live on
  Preprod with the loopback prover, but its DUST registration failed with a
  "network timeout" after the local proof server had proved it, stayed pending
  for more than two hours, NIGHT then showed 0, and a recovery-phrase re-import
  never finished syncing. The Lace run therefore stopped at the funding check
  and never reached account binding, balancing or submission. The same
  journal/actions code reached Preprod finality through the Node participant.
- `results/browser-lace.json` was transcribed from console output because a
  later aborted launch overwrote the run's own file; it has no per-step times.
- Crash-and-reconcile over a real Lace handoff was not run; the browser crash
  points are covered only by the synthetic Playwright qualification.
- `persisted` storage was also not granted in the headed Lace profile, so that
  profile would block new contributions.
- `indexer.preprod.midnight.network` is decommissioned; Lace and the relay use
  Blockfrost. `midnight/version-profile.json` still pins proof server 8.1.0
  while evidence used 8.1.3; the profile is left for its owner to update.

- Web Locks exclude only tabs of one browser profile. Copied Recovery Kits on
  several devices are unsupported and not detected (ADR 0029).
- A handoff whose outcome is unknown and whose transaction never reached the
  ledger stays `pending`: only the transaction TTL expiring against chain time
  (not implemented here) could prove non-submission, so new actions stay blocked.
- `persisted` storage was not granted in the headless temporary Chrome profile
  (see `results/browser-qualification.json`); contributions would be blocked.
- The wallet-account binding checks that the wallet's own verifying key signed a
  scope challenge; it does not verify the key hashes to the reported address.
