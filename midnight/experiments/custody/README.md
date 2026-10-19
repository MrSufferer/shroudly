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
SHROUDLY_CUSTODY_WALLET_CACHE=$HOME/Library/Caches/shroudly/wallet-cache-21 node midnight/experiments/custody/journey.mjs /absolute/path/to/.env.preprod-access.local
node midnight/experiments/custody/evidence-manifest.mjs
node midnight/experiments/custody/limits.mjs
node midnight/experiments/custody/separated/probe-call.mjs
node --test midnight/experiments/custody/*.test.mjs midnight/experiments/custody/separated/*.test.mjs
```

Only one process may use the shared wallet. The runner serializes submissions
with `/tmp/shroudly-wallet.lock` and waits for wallet synchronization under the
lock. It never re-registers NIGHT for DUST. The cache contains wallet sync state
and is kept outside Git with owner-only permissions. Copy the shared cache into a
per-ticket directory first so peer sessions never overwrite each other's saves;
removing it forces a slow sync from genesis.
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

The 2026-10-19 run (started 01:28:42Z, 376 s, `complete: true`) supersedes the
earlier checkpoints. It ran committed revision 0cad3f9 with a clean working tree;
its embedded manifest records the script hashes.

| Measurement | Co-located | Separated |
| --- | --- | --- |
| Finalized deploy | block 3042345, 37,348 ms, 11,059 bytes | asset block 3042366, 24,401 ms; pool block 3042376, 32,171 ms |
| Finalized seed | block 3042350, 27,699 ms, 13,994 bytes; one contract output matching the block-pinned custody commitment | asset block 3042371, 33,497 ms |
| Allocation | block 3042355, 31,212 ms; repeated allocation rejected | forged claim finalized at block 3042380, forged randomness at 3042385 |
| Withdrawal | block 3042361, 54,496 ms, 24,258 bytes; one contract input and output, the output matching the custody commitment; wallet received 400,000 of the custody color | no authenticated release path |
| Fresh indexer reconciliation | custody 1,600,000 = principal 600,000 + reserve 999,900 + prize 100; color derived from contract address | custody 2,000,000 against claimed liabilities 5,000,100: not reconciled |
| Rejections (generated constraints on fetched state) | forged draw, contributor binding, duplicate contributor, unauthorized release, principal over liability, repeated allocation: 6/6 rejected with matched reasons | caller claims accepted |
| Authenticated boundary | same-contract constraints available | compiler 0.31.1 rejects cross-contract calls on ledger-8.0.2 |
| Qualification | enforceable custody and reconciliation on Preprod | caller claims cannot establish authenticated separation |

All nine submissions report `finalizedVia: node`. The wallet also holds 400,000
of three earlier runs' custody colors; only this run's color is checked.

Preprod fee prices sat at their floor, so DUST fees round to zero. That exposed
a wallet SDK fault. In dust-wallet 4.2.0, `computeBalancingRecipe` selects no
DUST for a 0 fee and then re-prices the empty DUST intent (fee 1) indefinitely,
until wasm reports `unreachable` after about 19 minutes. `protected-wallet.mjs`
sets `costParameters.additionalFeeOverhead`, so balancing always selects a coin
and converges.

Failed and partial runs (not committed as evidence unless named):

- 16:08Z, 17:21Z and 19:35Z on 2026-10-18 failed the first CustodyProbe deploy
  with `operation-failed` within seconds and captured no detail; the cause
  remains unknown. Failures now record a redacted cause chain (`error-detail.mjs`).
- `network-checkpoint-2026-10-18-seed-commitment-read.json` (18:41Z) finalized
  all nine submissions but compared the seed output against a latest-state read,
  so `seed` was false. Commitment checks now read state at the submission block.
- 21:49Z reported deploy `outcome-unknown` after a 2h11m cache sync. A fresh
  indexer read showed that transaction finalized (SUCCESS, block 3041524) 7 s
  after submission: the node Finalized subscription stalled. On that timeout the
  runner now reads that exact transaction from the indexer and records
  `finalizedVia: indexer`; the qualifying run did not need it.

`limits.mjs` writes `limits-result.json`. It records k from proof server 8.1.3's
`/k` for every deployed circuit (largest 15; limit 25) and the verifier key sizes
(largest 2,119 bytes; limit 50,000 bytes). It measures every one of the nine
submitted transactions as serialized at submission: largest 24,258 bytes against
a limit of 786,432.

The revised runner checkpoints each submitted hash before waiting, caps node
finality and transaction-indexer waits at 180 seconds each, and aborts further
submissions with `outcome-unknown` when neither confirms. A pending spend of
unknown outcome is never saved into the wallet cache. A timeout is never
recorded as a rejected transaction.

The runtime regression exercises actual generated reserve seeding and allocation
through the SDK runner up to the proof-provider boundary. The existing exact
`@midnight-ntwrk/onchain-runtime-v3` 3.0.0 override aligns Compact runtime 0.16.0
with Midnight.js 4.1.1; restart the process after dependency changes. The prior
`StateValue` failure does not reproduce in a fresh process with those pins. A
second live run finalized seed, then exposed a separate reader error: generated
`ledger()` requires `ContractState.data` (a ChargedState), rather than the SDK
ContractState wrapper. The regression now reproduces that failure before the
fix and exercises the corrected generated-ledger read.
Twenty-one offline tests pass, including redacted error detail, generated custody/rejection constraints,
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
