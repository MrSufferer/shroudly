# Genuine Preprod experiment access

Issue [#20](https://github.com/MrSufferer/shroudly/issues/20) prepares access for
genuine experiments. The Operator owns the wallet, signing authorization,
funding, local prover and provider permissions. An experiment runner receives
only explicitly authorized access in the Operator's protected session. Never
send wallet material, passwords, browser account data or credential values to
an agent, issue, terminal transcript or evidence bundle.

Run `pnpm midnight:access` using an already configured protected environment.
The command emits sanitized JSON to stdout and exits **1 while evidence is
missing**. It never qualifies the release: wallet funding, the supported
browser pair, provider authorization and compatibility remain explicit human
or genuine-experiment gates. `--offline` skips network/provider probes;
`--timeout 3000` sets each probe's bound (100–10000 milliseconds). Redirect
stdout to a locally protected file if retaining a report. No files, credentials,
services, transactions, provider settings or gates are changed by the command.

The command does not load, source or evaluate environment files. Inject the
listed names using your approved protected launcher. `.env.production.local`
is an optional ignored, account-restricted local credential file under ADR
0023; it must never be committed, pasted, or shell-sourced as executable code.
Reports contain variable presence, fixed descriptions, allowlisted version
numbers and permission booleans. Raw provider output, HTTP bodies, URLs supplied
through environment variables, account names and secret reference values are
suppressed. Endpoint credentials, query strings and fragments are rejected.
Indexer HTTP and local proving require HTTP(S); indexer WebSocket requires
WS(S), and RPC accepts either transport. Remote endpoints require TLS.
Plain HTTP/WS is allowed only for loopback services.

The official [network migration notice](https://docs.midnight.network/guides/networks-and-environments)
retires the previous public Preprod endpoints on **9 October 2026**. The current
token-free protected-runner endpoints are:

| Transport | Base endpoint |
| --- | --- |
| Indexer HTTPS | `https://midnight-preprod.blockfrost.io/api/v0` |
| Indexer WSS | `wss://midnight-preprod.blockfrost.io/api/v0/ws` |
| RPC HTTPS or WSS | `https://rpc.midnight-preprod.blockfrost.io` or `wss://rpc.midnight-preprod.blockfrost.io` |

Set `MIDNIGHT_BLOCKFROST_SECRET_NAME` to the full Keychain service reference
`com.shroudly.preprod.blockfrost` and `MIDNIGHT_KEYCHAIN_ACCOUNT` to the local
account reference `shroudly-preprod`. The Operator enters the provider token
directly into Keychain, never an environment value or URL. For an approved
online probe the CLI reads this one token privately, keeps it in process
memory, and authenticates HTTPS via the `project_id` header and WSS via an
internally constructed `project_id` query. Only the exact official Preprod
hosts, paths and transports above receive it; configured URL credentials,
queries, fragments and nonstandard ports are rejected. Redirects are rejected.
Offline runs never read this token. No token appears in reports, arguments,
Vercel variables, logs or browser-visible configuration. Raw child output and
network errors remain suppressed. Rotate/revoke the token through Blockfrost
and replace its Keychain value privately after expiry or suspected exposure.

These endpoints require provider authentication. Browser-safe endpoint names
in `.env.example` contain routing only; they do not implement authenticated
browser access. Never solve that integration gate by embedding the Operator's
token into a `VITE_` value or distributing it to participants. This access CLI
does not change provider policy or the reviewed candidate version pins.

## Candidate compatibility and browser evidence

The exact candidate remains [midnight/version-profile.json](../../midnight/version-profile.json):
Compact CLI **0.5.2**, language **0.23.0**, compiler **0.31.1**, runtime
**0.16.0**, Midnight.js **4.1.1**, Wallet SDK **1.2.0**, DApp Connector
**4.0.1**, node **1.0.2**, indexer **4.3.3-hotfix** (network versions unverified), proof server **8.1.3**.
The ledger library is `@midnight-ntwrk/ledger-v8` **8.1.0**, derived from its
exact root `package.json` dependency pin in the CLI report.
These are candidate pins; qualification remains outstanding. Do not upgrade
pins or endpoints to turn a failed check green.

The browser check reads Chrome application version metadata and extension
`manifest.json` files in standard macOS Chrome profiles or an explicitly
selected `MIDNIGHT_CHROME_USER_DATA_DIR`. Set that variable to an absolute
user-data directory (for example the Operator's dedicated
`~/Library/Application Support/shroudly/playwright-preprod`, expanding `~`
locally before passing it). Only profile extension manifests are inspected;
the path is not printed. The check never reads
browser accounts, wallet identities, cookies, preferences or extension storage.
Detected versions are observations, not an approved supported pair. The
Operator must record the exact selected Chrome/Lace versions and approval in
the sanitized experiment record. A missing or unrecognized manifest needs
private manual inspection (including custom browser profiles). Desktop Chrome
and Lace must pass the genuine browser lifecycle experiment before support is
claimed; no mobile or alternate-browser qualification is inferred.

## Inputs, roles and custody

| Required name | Owner, storage and least privilege | Validation and recovery |
| --- | --- | --- |
| `MIDNIGHT_DEPLOYER_SECRET_NAME` | Operator; macOS Keychain wallet service; isolated Preprod deployment signer | CLI checks metadata only; Operator explicitly authorizes protected signing. Replace/revoke compromised signer and recheck authority. |
| `MIDNIGHT_KEYCHAIN_ACCOUNT` | Operator; protected runner configuration, reference only | Match the Keychain account privately; repair access through the local OS owner. |
| `MIDNIGHT_BLOCKFROST_SECRET_NAME` | Operator; full macOS Keychain service reference only | Online CLI reads the provider token only for exact allowlisted official Preprod endpoints; rotate/revoke at Blockfrost and replace privately. |
| `MIDNIGHT_PRIVATE_STATE_PASSWORD_NAME` | Operator; separate Keychain private-state service | Metadata only; preserve password and encrypted private-state backups. A new password does not recover old state. |
| `MIDNIGHT_PROOF_SERVER_URL` | Participant; local runtime configuration | HTTP(S) loopback only, no hosted fallback; start the pinned prover and recheck `/version`. |
| `MIDNIGHT_INDEXER_HTTP_URL` | Operator; protected runner configuration | Bounded GraphQL `__typename` query; repair unavailable or retired endpoint through reviewed configuration. |
| `MIDNIGHT_INDEXER_WS_URL` | Operator; protected runner configuration | `graphql-transport-ws` connection acknowledgement, then close; HTTP reachability alone does not pass. |
| `MIDNIGHT_RPC_URL` | Operator; protected runner configuration | JSON-RPC `system_chain` must report Midnight Preprod; HTTP and WebSocket transports are supported. |
| `VITE_SHROUDLY_DEPLOYMENT_ID` | Operator; separate Preprod Vercel project | Unique immutable deployment label; no usable credentials. |
| `VITE_SHROUDLY_RPC_URL`, `VITE_SHROUDLY_INDEXER_URL`, `VITE_SHROUDLY_ZK_CONFIG_URL`, `VITE_SHROUDLY_SPONSOR_URL` | Operator; browser-safe Vercel build configuration only | Validate the build snapshot before release. These checks record presence only; changing canonical values requires redeployment and fresh evidence. |

Wallet and private-state credential metadata lookup uses `security find-generic-password` without
`-w` or `-g`; all output is discarded. Service prefixes are
`MIDNIGHT_WALLET_SERVICE_PREFIX` (default `com.shroudly.preprod.wallet.`) and
`MIDNIGHT_PRIVATE_STATE_SERVICE_PREFIX` (default
`com.shroudly.preprod.private-state.`). A metadata hit proves neither valid
wallet material nor consent to use it. The runner never reads seed values or
private-state passwords. The separately authorized Blockfrost read uses `-w`
only for the selected provider token and discards all raw output after private
validation; it never uses `-g` or prints credential values.

Keep governance, emergency, reserve, randomness and Sponsor DUST credentials
separate; this access command does not provision them or grant authority.
Contract identifiers and artifact hashes are populated after genuine deployment.

## Genuine validation and recovery

1. The Operator authorizes a dedicated Preprod wallet and signer in the
   protected local/provider store. Confirm synchronized test NIGHT/DUST funding
   with an authorized genuine wallet adapter privately. Record only a sanitized
   validation outcome and timestamp. The CLI intentionally reports funding
   **unverified**; metadata or a faucet request never proves balance.
2. Start the participant-operated proof server pinned to **8.1.3**, binding its
   port to `127.0.0.1` (or IPv6 loopback), then set the local URL. The
   [official proof-service example](https://docs.midnight.network/tutorials/bship/test-suite)
   uses `/version` for readiness; its example image tag is not permission to
   replace the candidate pin. Inspect the pinned image/version privately.
   The CLI checks a bounded `/version` response; only an exact version response
   establishes its version check. Unknown response formats stay unverified.
   Restore the local service after failure; never redirect proving to a hosted
   service. Readiness does not prove successful genuine proving.

   For a Docker installation, inspect any existing container before starting a
   duplicate. The pinned image observed for this setup is
   `midnightntwrk/proof-server:8.1.3` at digest
   `sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c`.
   Start a new instance only when needed:

   ```sh
   docker run -d --name shroudly-preprod-proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server@sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c
   ```

   Recover a stopped instance with
   `docker start shroudly-preprod-proof-server`; stop it with
   `docker stop shroudly-preprod-proof-server`. Start Docker Desktop first if
   its daemon is unavailable. Recheck readiness/version after every restart;
   do not treat an image tag or container state as successful proving.
3. Validate both indexer transports and the RPC chain. An HTTP error, timeout,
   HTML body, GraphQL error, missing WS acknowledgement or wrong chain blocks
   readiness. A passing response does not establish the exact indexer/node
   versions, freshness, funding, compatibility or finalized state. Escalate
   retired endpoints for a reviewed correction instead of silently switching.
4. Authenticate `gh` to the intended account. The CLI reads repository
   permission booleans only. Give the runner the narrow repository/Actions
   permissions needed for its approved task; protected environment approval
   and workflow authorization remain separate. Recover access through the
   personal account owner and stored offline recovery codes.
5. The Operator creates or selects the **separate Preprod Vercel project** and
   links the repository in their protected session. With `.vercel/project.json`
   present, the CLI may read project metadata through `vercel project inspect`;
   it never creates, links, deploys or reads environment values. Confirm the
   intended personal owner, deploy role, domain/DNS control and environment
   isolation privately. Readable metadata does not prove these permissions.
   Recover through the owner/DNS registrar; export protected configuration
   through approved provider procedures. Mainnet transactions remain disabled.
6. Run the access check again and attach only its sanitized report plus explicit
   remaining human gates to #20. Genuine wallet authorization/funding,
   Chrome/Lace support, successful proving and compatibility experiments remain
   outstanding until observed. Missing evidence blocks access readiness and
   does not authorize mock evidence or unrelated cloud provisioning.

Issue #20 records access preparation and its actual limitations. Its review may
accept separately recorded Operator authorization and funding observations;
the CLI does not convert such statements into machine-verified funding. The
report intentionally retains `accessReady: false`, `qualification: outstanding`
and exit status 1 while genuine experiment evidence is incomplete. Full stack
qualification, successful private proving and browser lifecycle guarantees
belong to subsequent experiments and must not be represented as complete when
closing the access-preparation issue.
