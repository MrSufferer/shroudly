# Custody and boundary experiment — issue #21

**Incomplete; not release qualification.** This isolated synthetic probe is not
`tMIX`, a production Prize-Savings Pool, or an implementation of ADR 0013.
It never changes active deployment configuration or Mainnet gates.

The public behavior seams are the generated Compact circuits and actual network
transactions required by #21. Tests use generated circuits, not a JavaScript
accounting substitute. Synthetic credentials and coin fixtures are public test
values and cannot establish network custody. The local prover creates genuine
proof bytes, but these proofs do not establish finalized ledger acceptance.

```sh
pnpm install --frozen-lockfile
compact compile midnight/experiments/custody/CustodyProbe.compact midnight/managed/custody-probe
node --test midnight/experiments/custody/custody.test.mjs
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

ADR 0013 remains accepted. Conditional co-location requires explicit authority,
upgrade and opt-in migration review after viable network evidence. These results
cannot authorize supersession or broad financial implementation. Resume #21 with
rotated access; implement and execute the complete network custody journey and
its separation comparison, then record finalized transactions and fresh ledger
queries. If either topology cannot preserve the accepted guarantees, return a
specific evidenced design trade-off for decision. #21 must remain open meanwhile.
