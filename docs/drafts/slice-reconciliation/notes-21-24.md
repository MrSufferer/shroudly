# Changes for #21–#24 (listed only; those tickets are being built)

- **#21 Prove enforceable asset custody**: no change found. If the deployer wallet is used here, it needs the DUST registration step (fund tNIGHT, `registerNightUtxosForDustGeneration`, wait for visible DUST).
- **#22 Prove private offline participation and exits**: the proof step was already amended to require 8.1.3 and the cited limits. Add to the ledger/transcript audit criterion: its result decides whether the 🔒 "How much" and 🔒 "Your balance" chips from #71 may ship; if amounts are exposed, the disclosure card must change before release.
- **#23 Prove network-enforced draw and claim clocks**: measure "finalized selection" with the new finality cadence (`watchForTxData`, then sequential probes with 2→4→8s backoff capped at 10s, within 120s), and note that selection is Operator-computed under ADR 0031, so the claim clock starts at the finalized Operator pick.
- **#24 Prove genuine browser recovery**: the finality and indexer-visibility steps use the new cadence and the wallet's `getConfiguration()` endpoints, falling back to the Chain Data Proxy; prove that no Blockfrost token is in the bundle.
