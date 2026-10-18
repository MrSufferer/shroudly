# Custody and boundary experiment — issue #21

**Incomplete; not release qualification.** This isolated synthetic probe is not
`tMIX`, a production Prize-Savings Pool, or an implementation of ADR 0013.
It never changes active deployment configuration or Mainnet gates.

The public behavior seams are the generated Compact circuits and actual network
transactions required by #21. Tests use generated circuits, not a JavaScript
accounting substitute. Synthetic credentials and coin fixtures are public test
values and cannot establish network custody. The local prover creates genuine
proof bytes, but these proofs do not establish finalized ledger acceptance.

Local proving requires Docker and the participant-operated proof server at
`http://127.0.0.1:6300`. Inspect an existing container before creating another:

```sh
docker inspect shroudly-preprod-proof-server
```

If absent, create it with the [#20 runbook's pinned image](../../../docs/operations/preprod-access.md):

```sh
docker run -d --name shroudly-preprod-proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server@sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c
```

If stopped, use `docker start shroudly-preprod-proof-server`. Before running
the proof command, check readiness and require the exact response `8.1.3`:

```sh
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6300/version
```

Stop if readiness or version differs; keep proving local. The proof script
uses this exact loopback URL. Readiness alone does not establish successful proving.

```sh
pnpm install --frozen-lockfile
compact compile midnight/experiments/custody/CustodyProbe.compact midnight/managed/custody-probe
node --test midnight/experiments/custody/custody.test.mjs
node --test midnight/experiments/custody/provider-proxy.test.mjs
node --test midnight/experiments/custody/protected-wallet.test.mjs
node midnight/experiments/custody/prove-local.mjs
```

The seed circuit mints an isolated valueless shielded asset to its own contract,
requires receipt, and tracks synthetic Principal liability separately from
unallocated Prize Reserve and allocated Prize liability. Allocation verifies two
distinct registered contributor/draw openings and cannot repeat. Withdrawal
checks ownership, the exact tracked coin, Principal liability, and shielded change.
The current local release fixture supplies a synthetic Merkle index; it is never
network-spend evidence. Opening bindings use one fixed draw with three registered
contributors; this is not production randomness or time enforcement.

`custody` and synthetic amounts are deliberately public for diagnosis. This does
not satisfy ADR 0005, and must never be represented as participant-private
accounting. The synthetic Principal is minted, not a real saver deposit.

## Protected network bootstrap

`sync-wallet.mjs /absolute/path/to/.env.preprod-access.local` reads the existing
#20-authorized references privately, derives the standard account-0 HD roles,
and tries actual wallet synchronization and funding inspection. It has no
submission path. Credentials remain in memory. The SDK receives only ephemeral
loopback routes; a local HTTP/WebSocket proxy attaches provider authentication
only to the exact validated official Preprod endpoints. Child stdout/stderr are
discarded; the parent projects only sanitized booleans and category codes.

The Operator rotated the exposed provider credential before the 2026-10-17
network runs. The replacement remains private in Keychain. Use only the protected
bootstrap, which attaches authentication outside the SDK and discards dependency
stdout/stderr. Errors in the journey are projected to fixed categories.

Run the serialized journey with the protected reference file (never pass secrets
on the command line):

```sh
SHROUDLY_CUSTODY_WALLET_CACHE=/tmp/shroudly-timing-wallet-cache node midnight/experiments/custody/journey.mjs /absolute/path/to/.env.preprod-access.local
node midnight/experiments/custody/evidence-manifest.mjs
node midnight/experiments/custody/separated/probe-call.mjs
node --test midnight/experiments/custody/*.test.mjs midnight/experiments/custody/separated/*.test.mjs
```

Only one process may use the shared wallet. The runner serializes submissions
with `/tmp/shroudly-wallet.lock` and waits for wallet synchronization under the
lock. It never re-registers NIGHT for DUST. The cache contains wallet sync state
and is kept outside Git with owner-only permissions. Remove it to sync afresh.
Finality and indexer availability are observed through SDK submission results and
fresh indexer queries; elapsed waits alone never establish acceptance.

## Topology comparison and decision boundary

`separated/authenticated-call-result.json` records a genuine compile test of the
strong separated boundary. Its external target first compiles successfully;
then Compact compiler 0.31.1 (ledger-8.0.2 target) rejects the pool's authenticated
call with `cross-contract calls are not yet supported`. Missing dependencies are
not counted as this result. `probe-call.mjs` reproduces both phases in a temporary
directory and records both source hashes.

The deployed separated counterexample deliberately accepts caller-supplied claims.
It is not an enforceable substitute for the rejected authenticated call. Neither
source imports nor SDK batching bind a pool claim to another contract's custody.
A successful forged claim is evidence against this fallback, not a passing design.

`network-checkpoint-2026-10-17.json` preserves the previous deploy-only run and its
runtime-instance failures. `network-journey-result.json` is the latest live run;
its `complete` field requires finalized co-located and separated steps, all six
matched rejection reasons, indexed custody commitments/input/output events,
exact wallet receipt, fresh reconciliation, and the separated counterexample.
The rejection cases execute generated constraints against network-fetched state
before proving/submitting: they are not finalized failed transactions.

The first seeded run is preserved separately in
`network-checkpoint-2026-10-17-first-seed.json`. It ran the earlier runner, so
its revision does not identify the revised script hashes. Its zero DUST deltas
used stale wallet snapshots and are not reliable cost measurements. The
interrupted separated claim has an unknown outcome pending a fresh indexer read.

| Measurement | Co-located | Separated |
| --- | --- | --- |
| Finalized deploy | block 3021818, 24,002 ms, 11,056 bytes | asset block 3021827, 23,921 ms; pool block 3021836, 24,183 ms |
| Finalized seed | block 3021823, 29,274 ms, 13,991 bytes; one contract output | asset block 3021832, 29,653 ms |
| Allocation / withdrawal | not reached: ledger reader failure | forged claim interrupted; outcome unknown |
| Authenticated boundary | same-contract constraints available | compiler 0.31.1 rejects cross-contract calls on ledger-8.0.2 |
| Qualification | incomplete; no verified wallet receipt yet | caller claims cannot establish authenticated separation |

The revised runner checkpoints each submitted hash before waiting, caps node
finality and transaction-indexer waits at 180 seconds each, and aborts further
submissions on timeout with `outcome-unknown`. It queries the interrupted pool
through the indexer and synchronizes the wallet before making new submissions.
A timeout is never recorded as a rejected transaction.

The runtime regression exercises actual generated reserve seeding and allocation
through the SDK runner up to the proof-provider boundary. The existing exact
`@midnight-ntwrk/onchain-runtime-v3` 3.0.0 override aligns Compact runtime 0.16.0
with Midnight.js 4.1.1; restart the process after dependency changes. The prior
`StateValue` failure does not reproduce in a fresh process with those pins. A
second live run finalized seed, then exposed a separate reader error: generated
`ledger()` requires `ContractState.data` (a ChargedState), rather than the SDK
ContractState wrapper. The regression now reproduces that failure before the
fix and exercises the corrected generated-ledger read.
Fifteen offline tests pass, including generated custody/rejection constraints,
separated forgery, runtime compatibility, protected configuration/proxy and cache.
Proxy tests require local loopback listening outside the restricted sandbox.

`network-artifact-manifest.json` records compiler-generated contract/key/ZKIR
hashes for both network topologies, sources, execution scripts, exact package
versions, lockfile hash, source revision and dirty flag. The revised journey also
captures its own manifest at process startup. A dirty flag means the execution
script hashes, rather than revision alone, identify the exact runner.

Local proof evidence remains in `local-proof-result.json`: 4,508-byte proofs for
seed (2,302 ms) and allocation (1,184 ms), re-run on proof server 8.1.3, not
finalized network acceptance.
The execution profile is Node 24.10.0, Compact CLI 0.5.2/compiler 0.31.1,
Compact runtime 0.16.0, Midnight.js 4.1.1, wallet SDK 1.2.0, ledger-v8 8.1.0,
and participant-local proof server 8.1.3.

ADR 0013 remains accepted. These synthetic, publicly diagnosable minted assets
are not real saver deposits or participant-private accounting. Conditional
co-location still requires explicit authority, upgrade and opt-in migration
review. The design decision is whether to authorize that review, defer until an
authenticated separated boundary is supported, or provide a different enforceable
separation design. This experiment cannot silently weaken that requirement.
