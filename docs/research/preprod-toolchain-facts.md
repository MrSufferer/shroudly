# Live Preprod toolchain facts the version profile depends on

Research for [#65](https://github.com/MrSufferer/shroudly/issues/65), child of map [#57](https://github.com/MrSufferer/shroudly/issues/57).
Gathered 2026-10-17 (UTC). Every claim cites its source. The `.claude/skills/midnight-*` skills were not used as evidence.

Sources used:

- **[SM]** Support matrix, `docs/relnotes/support-matrix.mdx` in [midnightntwrk/midnight-docs@main](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/relnotes/support-matrix.mdx) (fetched raw, and via Context7 `/midnightntwrk/midnight-docs`).
- **[NE]** `docs/guides/networks-and-environments.mdx` in [midnight-docs@main](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/networks-and-environments.mdx).
- **[UL]** `api-reference/overview/usage-limits.mdx` in [midnight-docs@main](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/overview/usage-limits.mdx).
- **[LEDGER]** [midnightntwrk/midnight-ledger](https://github.com/midnightntwrk/midnight-ledger) at tag `ledger-8.1.3`.
- **[NODE]** [midnightntwrk/midnight-node](https://github.com/midnightntwrk/midnight-node) at tag `node-1.0.400` (commit `3acfd2ede`), and its [release notes](https://github.com/midnightntwrk/midnight-node/releases/tag/node-1.0.400).
- **[NPM]** `npm view` on 2026-10-17.
- **[CMD]** Commands run locally or against public endpoints on 2026-10-17.

## 1. Compiler target ledger vs `ledger-v8@8.1.0` and proof server 8.1.3

| Fact | Value | Source |
|---|---|---|
| `compact --version` | `compact 0.5.2` | [CMD] |
| Selected compiler (`compact list`, `compact compile --version`) | `0.31.1` | [CMD] |
| `compact compile --ledger-version` | `ledger-8.0.2` | [CMD] |
| `compact compile --language-version` | `0.23.0` | [CMD] |
| Preprod matrix: Compact toolchain / runtime / on-chain runtime | 0.31.1 / 0.16.0 / 3.0.0 | [SM] |
| Preprod matrix: Compact devtools | **0.5.1** (installed is 0.5.2) | [SM], [CMD] |
| Preprod matrix: proof server | 8.1.3 | [SM] |
| `@midnight-ntwrk/ledger-v8` versions | 8.0.0 … 8.1.0, 8.1.1, 8.1.2, 8.1.3; `latest` = 8.1.3 | [NPM] |
| `@midnight-ntwrk/midnight-js-protocol@4.1.1` exact pins | `ledger-v8` **8.1.0**, `compact-runtime` 0.16.0, `onchain-runtime-v3` 3.0.0, `compact-js` 2.5.1, `platform-js` 2.2.4 | [NPM] |
| Proof server image `midnightntwrk/proof-server:8.1.3` | published 2026-10-02; `latest` tag points at the same date | Docker Hub tags API [CMD] |
| Node 1.0.400 links ledger | 8.1.3 (v8 host functions), already running on Preview, Preprod, Mainnet | [NODE] release notes |
| Live Preprod RPC `midnight_ledgerVersion` | `"=8.1.2"`; `system_version` = `1.0.400-c338b9ac`; `state_getRuntimeVersion.specVersion` = 1000300 | [CMD] against `https://rpc.preprod.midnight.network` |

**Answer.**

- The compiler reports `ledger-8.0.2`. That is the ledger-8 minor it was built against, not the npm package version. The matrix tests compiler 0.31.1 against ledger-8 networks whose nodes run 8.1.3 [SM][NODE]. The same major is what matters: 0.31.1 output deploys on ledger 8, while 0.34/0.35 output does not [SM].
- `ledger-v8@8.1.0` is not a free choice. Midnight.js 4.1.1 pins it exactly through `midnight-js-protocol` [NPM]. The matrix does not list a ledger npm version at all [SM]. So 8.1.0 on the client, the 8.1.3 proof server, and 8.1.3 nodes is the tested combination implied by the matrix. It is not stated row by row.
- Ledger 8.1.2 and 8.1.3 are security patches that narrow well-formedness: "an 8.1.3 node rejects contract calls an 8.1.2 node accepts" (non-canonical `field` atoms, `noop 0`) [LEDGER `CHANGELOG.md`]. Node 1.0.400 release notes say "Supported compactc and midnight-js output never produces these encodings, so dApp developers have nothing to change" [NODE]. That is owner-confirmed, not something we tested. #22's re-run on proof server 8.1.3 is the empirical check.
- **Known-incompatible combinations** (all ledger-9 mixes) [SM]:
  - Compact runtime 0.19.0/0.20.0 with Midnight.js 4.1.1 → `deployContract` throws `Failed to configure constructor context with coin public key`.
  - Toolchain 0.34.0/0.35.0 with runtime 0.16.0 → `Version mismatch: compiled code expects 0.19.0 (0.20.0), runtime is 0.16.0`.
  - Toolchain 0.31.1 with runtime 0.19.0/0.20.0 → `Version mismatch: compiled code expects 0.16.0, runtime is 0.20.0`.
  - Any contract compiled with 0.34.0/0.35.0 cannot be deployed to Preview, Preprod or Mainnet, because ledger 8 can't read its initial state.
  - `compact update` with no version moves to the newest toolchain (0.35.0, ledger 9) [SM]. `compact list` shows 0.34.0 and 0.35.0 available locally [CMD].
- No listed incompatibility covers 0.31.1 + runtime 0.16.0 + ledger-v8 8.1.0 + proof server 8.1.3 + node 1.0.400.

**Unexplained (unverified):** the live Preprod RPC reports `midnight_ledgerVersion = "=8.1.2"` while the node binary is 1.0.400, which the release notes say links ledger 8.1.3 [CMD][NODE]. A plausible reading is that the method reports the on-chain runtime's ledger (the runtime at `spec_version` 1_000_300 is unchanged by the binary-only 1.0.400 patch) rather than the host-function ledger. This was not confirmed in source. That endpoint is also the Midnight-hosted Preprod RPC, which [NE] says shut down on 9 October 2026, yet it still answered on 2026-10-17. Do not depend on it.

## 2. Live Preprod limits #22's proof work must fit

### Transaction size

| Limit | Value | Source |
|---|---|---|
| Ledger `transaction_byte_limit` | 1,048,576 bytes (1 MiB), enforced in well-formedness (`MalformedTransaction::TransactionTooLarge`) | [LEDGER] `ledger/src/structure.rs` `INITIAL_LIMITS`, `ledger/src/verify.rs:578`; Preprod genesis config `res/preprod/ledger-parameters-config.json` [NODE]; [UL] |
| Substrate block length | 1 MiB, of which 75% (786,432 bytes) is for normal extrinsics | [NODE] `runtime/src/lib.rs:308-321` (`max_with_normal_ratio(1024 * 1024, NORMAL_DISPATCH_RATIO = 75%)`); [UL] |
| Per-account throttle | up to 10 MB of tx data per day (rolling 14,400 blocks at 6 s) | [UL] only; not traced to source (**unverified**) |

**Effective ceiling:** a single transaction must also fit one block's normal-dispatch space. In practice the binding byte cap is about **786 KB, less extrinsic overhead**, not 1 MiB. This is an inference from the two limits above and has not been tested on chain.

### Block limits (multi-dimensional cost model)

The docs and the Preprod genesis config **disagree**:

| Dimension | [UL] docs and ledger `INITIAL_LIMITS` [LEDGER] | Preprod genesis `ledger-parameters-config.json` at node-1.0.400 [NODE] |
|---|---|---|
| `block_usage` (broadcast bytes) | 200,000 | **1,000,000** |
| `bytes_written` | 50,000 | 50,000 |
| `bytes_churned` | 1,000,000 | **50,000,000** |
| `read_time` | 1 s | **2 s** (2,000,000,000,000 ps) |
| `compute_time` | 1 s | **2 s** |
| Block time | 6 s | — ([UL]) |
| `global_ttl` | 3,600 s | **1,209,600 s (14 days)** |

The Preprod file is the network-specific genesis input. The docs page appears to restate the ledger crate's `INITIAL_LIMITS` defaults. Both are governance-adjustable [UL]. **The current on-chain values were not read** (no RPC method exposes ledger parameters, and the Blockfrost indexer needs a token). Treat the Preprod column as the best available evidence and the current live values as **unverified**. #22 should budget against the stricter column (200 KB block usage, 50 KB persistent writes per block, 1 s compute) until the live values are read.

Per-transaction costs relevant to proofs, from the Preprod cost model [NODE]: `proof_verify_constant` ≈ 3.27 ms plus `proof_verify_coeff_size` ≈ 4.6 µs per public input, and `verifier_key_load` ≈ 1.53 ms. Compute time therefore caps at a few hundred proof verifications per block. The 50,000-byte `bytes_written` budget per block is the dimension most likely to bind on state-heavy calls.

### Circuit size (k / rows) and key sizes

| Limit | Value | Source |
|---|---|---|
| Max `k` the proof server will fetch public parameters for | 0 ≤ k ≤ 25 (`/fetch-params/{k}` rejects anything else) | [LEDGER] `proof-server/src/endpoints.rs:82` |
| Verifier max degree (public inputs) | `VERIFIER_MAX_DEGREE = 14`: "This limits the number of public inputs usable" (embedded `bls_midnight_2p14` params) | [LEDGER] `transient-crypto/src/proofs.rs:104-120` |
| Verifier key size on deserialization | ≤ 50,000 bytes (`MAX_EXPECTED_SIZE`); oversize keys error, and the ledger has a `VerifierKeyTooLarge` error | [LEDGER] `transient-crypto/src/proofs.rs:426`, `ledger/src/error.rs:440` |
| Prover key size guidance | "often 10MB-20MB, sometimes even 80MB and more" | DApp Connector spec in midnight-docs (`api-reference/dapp-connector/_media/SPECIFICATION.md`) |
| Typical k for compiler 0.31.1 circuits | 13–14 in official examples | midnight-docs `sdks/community/openzeppelin-compact-contracts.mdx`, `docs/tutorials/battleship/smart-contract.mdx` |

No explicit ledger rule caps rows or k on chain beyond the above. The hard ceiling is k = 25 at the proof server, plus the per-block compute and byte budgets for verification. Shroudly's own circuit k values were not measured here: `compact compile --skip-zk` prints none, and full key generation is #22's job.

## 3. Indexer API that Blockfrost serves for Preprod

| Fact | Value | Source |
|---|---|---|
| Preprod indexer GraphQL | `https://midnight-preprod.blockfrost.io/api/v0?project_id=<token>` | [NE] |
| Preprod indexer WebSocket | `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=<token>` | [NE] |
| Preprod node RPC | `https://` / `wss://rpc.midnight-preprod.blockfrost.io?project_id=<token>` | [NE] |
| API compatibility | "It runs the same indexer API that the Midnight-hosted endpoints served … changing its endpoint URLs and adding a token, not … changing code." The old URL was `/api/v4/graphql`. | [NE] |
| Schema deviation | `Subscription.dustGenerations` takes `(dustAddress, blockHash, dtimeCutoffHeight)` instead of `(dustAddress, startIndex, endIndex)`. "No `@midnight-ntwrk` package uses this subscription … The rest of the schema is unchanged, and Blockfrost adds extra fields." | [NE] |
| Saved wallet sync state | Not portable from the old indexer (event/tx ids differ); resync from genesis, which takes over an hour on Preprod | [NE] |
| Indexer version | **4.3.302**, "has no public tag, release, or image yet" | [SM] |
| Public indexer images | `midnightntwrk/indexer-standalone` has 4.3.5, 4.3.7, 4.3.800-rc.x, 4.4.0-rc.2, and no 4.3.302 | Docker Hub tags API [CMD] |
| Probe without token | `403 {"message":"Missing project token. Please include project_id in your request."}` | [CMD] |
| Old Midnight-hosted Preprod indexer `/api/v4/graphql` | HTTP **410** | [CMD] |

**Answer:** Blockfrost serves the Midnight indexer's v4 GraphQL schema (the one midnight-js 4.1.1 targets) at a different path (`/api/v0`). The one changed subscription is unused by `@midnight-ntwrk` packages. The version is 4.3.302 according to the matrix. **Unverified:** we did not query Blockfrost with a token, and 4.3.302 cannot be checked against any public artifact. Note also that the profile's `network.indexerGraphql` (`https://indexer.preprod.midnight.network/api/v4/graphql`) now returns 410.

## 4. npm `latest` vs the Preprod matrix / repo pins

| Package | Repo pin (`package.json`) | Matrix | npm `latest` | Trap? | Source |
|---|---|---|---|---|---|
| `@midnight-ntwrk/compact-runtime` | 0.16.0 | 0.16.0 | **0.20.0** | **Yes.** 0.20.0 depends on `@midnightntwrk/onchain-runtime-v4` (ledger 9, different npm scope); see the incompatible combinations above | [NPM], [SM] |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 | — | 8.1.3 | Mild. Midnight.js 4.1.1 pins exactly 8.1.0, so bumping alone creates a duplicate ledger copy | [NPM] |
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 | 4.1.1 | 4.1.1 | No (`rc` is 5.0.0-rc.5) | [NPM] |
| `@midnight-ntwrk/testkit-js` | — | 4.1.1 | 4.1.1 | No | [NPM] |
| `@midnight-ntwrk/wallet-sdk` | 1.2.0 | 1.2.0 | **1.1.0** | **Yes, inverted.** `latest` lags the matrix, so a bare install gets an older SDK than the matrix (1.2.0 was published 2026-06-22) | [NPM] |
| `@midnight-ntwrk/onchain-runtime-v3` | (transitive) | 3.0.0 | 3.1.2 | Mild. Midnight.js pins 3.0.0 | [NPM] |
| `@midnight-ntwrk/compact-js` | (transitive) | 2.5.1 | 2.5.3 | Mild | [NPM] |
| `@midnight-ntwrk/platform-js` | (transitive) | 2.2.4 | **3.0.0** | **Yes.** A major bump; a direct bare install leaves the matrix | [NPM] |
| `@midnight-ntwrk/dapp-connector-api` | (profile 4.0.1) | 4.0.1 | 4.0.1 | No | [NPM] |
| `@midnight-ntwrk/ledger-v9` | — | not deployed | 1.0.0-rc.3 (`rc` 1.0.0-rc.6) | Ledger 9 is not on any public network [SM] | [NPM] |

Other drift:

- From ledger 8.1.1, npm packages are also published under the **`@midnightntwrk`** scope (`@midnightntwrk/ledger-v8` has 8.1.1 to 8.1.3) [LEDGER `CHANGELOG.md`][NPM]. The `@midnight-ntwrk/ledger-v8` scope also still carries 8.1.3 [NPM].
- Compact devtools: matrix 0.5.1, installed 0.5.2 [SM][CMD].
- `midnight/version-profile.json` still lists node `1.0.2` (matrix 1.0.400), indexer `4.3.3-hotfix` (matrix 4.3.302), proof server `8.1.0` (matrix 8.1.3), and the shut-down Midnight-hosted RPC and indexer URLs [SM][NE].

## Unverified items

- The current on-chain ledger parameters (block limits, TTL) on Preprod. Only the genesis config and the docs were read.
- The indexer version Blockfrost actually runs (4.3.302 per the matrix; no token was used and no public artifact exists).
- Why `midnight_ledgerVersion` returns `=8.1.2` on a 1.0.400 node.
- The 10 MB/day per-account throttle (docs only).
- That Midnight.js 4.1.1 / ledger-v8 8.1.0 output passes 8.1.3 well-formedness (release notes assert it; #22's re-run would confirm it).
