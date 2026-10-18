## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a multi-context layout rooted at `CONTEXT-MAP.md`. See `docs/agents/domain.md`.

## Midnight version authority

`midnight/version-profile.json` is the only source for Midnight versions and endpoints. The installed `midnight-*` skills (from `mzf11125/midnight_agent_skills`) have stale tables (proof server 8.0.3, wallet-sdk-facade 3.0.0, `*.preprod.midnight.network` endpoints). Use them as background only, and verify APIs with `npx ctx7@latest docs /midnightntwrk/midnight-docs "<question>"`. Evidence must come from the profile's pins, including proof server 8.1.3.

Live Preprod runs share one DUST-funded wallet. Run one at a time, sync from the wallet cache (never from genesis inside a ticket session), and push branches at every checkpoint.
