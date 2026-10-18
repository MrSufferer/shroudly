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
the proof command, check readiness and require the exact response `8.1.0`:

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

**Do not run authenticated requests until the exposed provider credential has
been revoked/rotated by the Operator and replaced privately in Keychain.** The
initial direct SDK bootstrap emitted a token-bearing RPC URL in a dependency
error. That process was stopped; no further authenticated request was made.
No installed Blockfrost management connector/CLI is available to rotate it.
See the runbook's existing Operator-owned provider rotation procedure.

## Topology comparison and remaining work

| Topology | Observed result | Missing guarantee |
| --- | --- | --- |
| Existing separated contracts | Source pins dependency IDs, but pool accepts `randomnessAggregate` as caller input; yield initializes an unbacked reserve counter. | Authenticated result provenance and reconciled enforceable shielded custody; source imports and batching cannot supply either. |
| Isolated co-located probe | Generated constraints and local proofs exercise mint/receive, registered openings, segregation, one-shot allocation; generated withdrawal constraints preserve change. | Genuine finalized mint/receive/spend, fresh indexer reconciliation, external issuer separation, production randomness, private accounting. |

The separated topology has not been network tested in this experiment. Its
feasibility and costs remain unmeasured; the source observations do not prove
that enforceable separation is impossible. Neither topology has network custody
evidence here.

## Recorded checkpoint

`local-proof-result.json` records the source revision, source/artifact hashes,
proof hashes and measured local proof times. The recorded run produced 4,508-byte
proofs for seed (1,595 ms) and allocation (858 ms). Withdrawal has generated
constraint tests but no recorded local proof or finalized spend. Seven offline
tests cover the generated constraints and provider boundary, including rejection
of HTTP redirects, authenticated HTTP/WebSocket forwarding through token-free
SDK URLs, sanitized subprocess failures, and rejection of insecure provider
schemes and nondefault ports before credential access.

The execution profile was Node 24.10.0, Compact CLI 0.5.2/compiler 0.31.1,
Compact runtime 0.16.0, Midnight JS 4.1.1, wallet SDK 1.2.0, ledger-v8 8.1.0,
and local proof server 8.1.0, with dependencies from the repository lockfile.
Provider access initially timed out at 10 seconds; a bounded 55-second retry
recovered the protected credential after 39.590 seconds. The subsequent SDK
disconnect exposed its authenticated URL, so execution stopped pending Operator
rotation. No successful wallet synchronization, funding observation, finalized
network transaction, or network timing was obtained.

ADR 0013 remains accepted. Conditional co-location requires explicit authority,
upgrade and opt-in migration review after viable network evidence. These results
cannot authorize supersession or broad financial implementation. Resume #21 with
rotated access; implement and execute the complete network custody journey and
its separation comparison, then record finalized transactions and fresh ledger
queries. If either topology cannot preserve the accepted guarantees, return a
specific evidenced design trade-off for decision. #21 must remain open meanwhile.
