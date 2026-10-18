# Slice-ticket reconciliation with the PRD amendment of 2026-10-18 and the disclosure copy (#71).
# Each entry: ticket -> list of (old, new). Every old must match exactly once.
FIN = ("(`watchForTxData`, then sequential probes with 2→4→8s backoff capped at 10s, within 120s, "
       "using the wallet's `getConfiguration()` endpoints after connect)")
E = {
25: [
("  the twenty-four-hour deployer-removal requirement; document common-control Preprod risks.",
 "  the twenty-four-hour deployer-removal requirement; document common-control Preprod risks.\n"
 "- [ ] Accept interim Operator-computed selection (ADR 0031, PRD amendment 2026-10-18) as a named\n"
 "  authority: the Operator reads weights and balances and computes the weighted pick from the\n"
 "  contract's combined randomness; the contract enforces the randomness threshold, records the\n"
 "  Winning Commitment and checks the private claim. Record it as a trusted-operator risk and name\n"
 "  the condition that retires it (#22 or a successor qualifies an alternative)."),
("Parent PRD stories: 29, 42, 66–74,", "Parent PRD stories: 29, 33, 42, 66–74,"),
],
26: [
("  on narrow layouts, clear Preprod/test-value and public-timing disclosures.",
 "  on narrow layouts, clear Preprod/test-value and public-timing disclosures. Use the accepted copy\n"
 "  from #71: hero \"Save privately. Draw in the open.\", eyebrow \"Private savings, public draws\",\n"
 "  trust chip \"Operator-selected draws (Preprod)\", cohort copy \"five commitments are not five\n"
 "  people\", and the \"What Preprod does not keep private\" section."),
("  wallet bridges and retired EVM dependencies from the active release.",
 "  wallet bridges and retired EVM dependencies from the active release. Pre-connect public reads use\n"
 "  the read-only Chain Data Proxy; after connect, reads use the wallet's `getConfiguration()`\n"
 "  endpoints with proxy fallback. No Blockfrost token reaches the bundle. Show stale data with its\n"
 "  age, or the typed \"chain data unavailable\" error."),
],
27: [
("finality/indexer/fresh-ledger confirmation and\n  safe error messages.",
 "finality/indexer/fresh-ledger confirmation " + FIN + "\n  and safe error messages."),
],
28: [
("  return-to-check/claim requirements and no Preprod email/push prize alerts before consent.",
 "  return-to-check/claim requirements and no Preprod email/push prize alerts before consent.\n"
 "- [ ] Show the two disclosure cards from #71 (withdrawing links back to your deposit; the Operator\n"
 "  picks the winner) before the first contribution. Contribute stays disabled until both separate\n"
 "  acknowledgements are given. Key them by deployment and notice version, ask again when either\n"
 "  changes, and store them only in local encrypted private state."),
("Parent PRD stories: 13, 16, 18, 20–22, 45, 48–51,", "Parent PRD stories: 13, 16, 18, 20–22, 33, 45, 47–51,"),
],
29: [
("- [ ] Carry durable prepare/reconcile and privacy guarantees through the withdrawal; preserve\n  unrelated valid claims and safe exits when another action is unknown.",
 "- [ ] Carry durable prepare/reconcile and privacy guarantees through the withdrawal; preserve\n  unrelated valid claims and safe exits when another action is unknown. The withdraw step states\n"
 "  that it publicly links back to the deposit (public retirement, ADR 0031); the disclosure\n  acknowledgements never block a withdrawal."),
("Parent PRD stories: 14–18, 20–22, 48, 80.", "Parent PRD stories: 14–18, 20–22, 47–48, 80."),
],
31: [
("- [ ] Use the accepted fixed UTC intervals and exact private weights, with at least five\n  positive-weight commitments and the separate accepted maximum. Disclose commitments are not\n  distinct people or an anonymity guarantee.",
 "- [ ] Use the accepted fixed UTC intervals and exact private weights, with at least five\n  positive-weight commitments and the separate accepted maximum. Disclose commitments are not\n  distinct people or an anonymity guarantee.\n"
 "- [ ] Until #22 or a successor qualifies an alternative, the Operator reads weights and computes the\n"
 "  weighted pick from the contract's combined randomness (ADR 0031); the contract enforces the\n"
 "  randomness threshold, records the Winning Commitment and checks the claim. Disclose that no one\n"
 "  checks the pick was fair."),
("  control and isolated key locations. Another valid caller must reach the same result.",
 "  control and isolated key locations. Another valid caller must reach the same randomness and\n  finalization result; selection itself remains Operator-computed."),
("  private identity/weights. Verify selection, at-most-once yield and finality; mocks do not\n  establish network success.",
 "  private identity/weights, with the #71 draw panel hint (Operator-picked winner, 2-of-3 reveals,\n"
 "  one person holds all keys, cohort met/pending). Verify the Operator's pick applies the combined\n"
 "  randomness to the recorded weights, at-most-once yield and finality " + FIN + "; mocks do\n  not establish network success."),
("Parent PRD stories: 16–17, 19–25, 27, 29–36,", "Parent PRD stories: 16–17, 19–25, 27, 29–36,"),
],
43: [
("Provision the Render Sponsor Service environment and bounded DUST credential,",
 "Provision the Render Sponsor Service and read-only Chain Data Proxy environments, the Blockfrost\naccounts, and the bounded DUST credential,"),
("This gate provisions access only.",
 "- [ ] Authorize two Blockfrost Midnight Preprod accounts.\n"
 "  - Public: Chain Data Proxy only. Operator: Sponsor Service, Automation Service and Operator CLI.\n"
 "  - Record plan tier, 50,000 req/day, 10 req/s per IP with a 500 burst, and the 80% Better Stack\n"
 "    quota alert. Record that proxy and Sponsor may share a Render egress IP (unverified).\n"
 "  - Token values live only in provider secret stores; never in the web bundle or evidence.\n"
 "- [ ] Register every operator wallet (Sponsor, deployer, randomness, evidence) for DUST.\n"
 "  - Fund tNIGHT, call `registerNightUtxosForDustGeneration`, and wait until DUST is visible.\n"
 "  - Record the registration-to-DUST delay as `faucetTiming`.\n"
 "- [ ] Record in the runbook (story 33): all three Preprod randomness keys are held by the same\n"
 "  maintainer, who also computes interim selection as Operator (ADR 0031). Two-of-three reveals\n"
 "  protect against one lost key, not against that maintainer. Do not describe provider isolation,\n"
 "  randomness or selection as independent custody.\n\n"
 "This gate provisions access only."),
("Parent PRD stories: 62, 98–100, 102, 104–105", "Parent PRD stories: 33, 62, 98–100, 102, 104–105"),
],
44: [
("  Confirm financial success through finality, indexer visibility and fresh ledger state.",
 "  Confirm financial success through finality, indexer visibility and fresh ledger state\n  " + FIN + "."),
],
45: [
("- [ ] Show the rejection/reason and expected participant-funded cost; require fresh approval if\n  authorization expired or funding changes require it.",
 "- [ ] Show the rejection/reason and expected participant-funded cost; require fresh approval if\n  authorization expired or funding changes require it. If the participant has no DUST, explain\n"
 "  registering their own tNIGHT for DUST generation and the measured wait (`faucetTiming`)."),
],
47: [
("  banners; check Preprod contract/indexer health every five minutes and disable unsafe new\n  submissions after detected failure.",
 "  banners; check Preprod contract/indexer health every five minutes and disable unsafe new\n  submissions after detected failure. Monitor Chain Data Proxy health, Blockfrost quota (alert at\n"
 "  80%) and 429s; the proxy serves stale data with its age or a typed \"chain data unavailable\" error."),
("  GitHub/Vercel/Render/Supabase/Resend/Better Stack/DNS/Midnight, variables, roles, validation,\n  rotation, recovery, reset and access transfer.",
 "  GitHub/Vercel/Render/Supabase/Resend/Better Stack/Blockfrost/DNS/Midnight, the Chain Data Proxy,\n"
 "  operator-wallet DUST registration, variables, roles, validation, rotation, recovery, reset and\n"
 "  access transfer, and the story 33 same-maintainer key and selection disclosure."),
("Parent PRD stories: 63–65, 69–70, 90–104", "Parent PRD stories: 33, 63–65, 69–70, 90–104"),
],
48: [
("  - [ ] ↳ Same page → Confirm clear Preprod, valueless tMIX and supported-version disclosures.",
 "  - [ ] ↳ Same page → Confirm clear Preprod, valueless tMIX and supported-version disclosures.\n"
 "  - [ ] ↳ Same page, amendment copy → Confirm the #71 hero, trust-chip, cohort and \"What Preprod\n"
 "    does not keep private\" copy.\n"
 "  - [ ] ↳ Before first contribution → Confirm both disclosure cards and that Contribute stays\n"
 "    disabled until both acknowledgements are given; a changed notice version asks again.\n"
 "  - [ ] ↳ Public reads → Confirm no Blockfrost token in the bundle, proxy allowlist and rate limit,\n"
 "    wallet-endpoint reads after connect, and stale-data age or a typed unavailable error."),
("  - [ ] ↳ After valid reveals → Verify canonical combination, permissionless finalization and\n    at-most-once yield.",
 "  - [ ] ↳ After valid reveals → Verify canonical combination, permissionless finalization and\n    at-most-once yield.\n"
 "  - [ ] ↳ Same draw, Operator selection → Confirm the Operator's pick applies the combined randomness\n"
 "    to the recorded weights, and the journal discloses that the pick is not independently checked."),
("  - [ ] ↳ Same review, public financial data → Exclude private balances, amounts, weights and winning\n    identity from public records.",
 "  - [ ] ↳ Same review, public financial data → Exclude private balances, amounts, weights and winning\n    identity from public records.\n"
 "  - [ ] ↳ Same review, accepted losses → Confirm note lineage at withdrawal is the only public\n"
 "    disclosure, and that Operator visibility of weights and balances is disclosed."),
("  - [ ] ↳ Across these operations → Confirm the runbook covers access, variables, validation, rotation\n    and recovery.",
 "  - [ ] ↳ Operator wallets → Confirm DUST registration for every operator wallet and recorded\n    `faucetTiming`.\n"
 "  - [ ] ↳ Across these operations → Confirm the runbook covers access, variables, validation, rotation\n    and recovery."),
],
}
# drop no-op entries
E[31] = [p for p in E[31] if p[0] != p[1]]

if __name__ == "__main__":
    import json, sys, os
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for n, pairs in E.items():
        b = json.load(open(f"{src}/{n}.json"))["body"]
        for old, new in pairs:
            c = b.count(old); assert c == 1, (n, c, old[:60])
            b = b.replace(old, new)
        open(f"{out}/{n}.md", "w").write(b)
        print(n, "ok", len(pairs), "edits")
