# Can a Blockfrost Midnight project key be exposed in a browser?

Research for [#64](https://github.com/MrSufferer/shroudly/issues/64), child of map [#57](https://github.com/MrSufferer/shroudly/issues/57). Tests the escape clause in decision [#60](https://github.com/MrSufferer/shroudly/issues/60): a read-only Chain Data Proxy on Render holds the token, unless a restricted browser key can be made safe.

Researched on 2026-10-17. Claims marked **unverified** could not be confirmed against a primary source.

## Short answer

No. Blockfrost has no public or browser-safe key mode. Its own docs and Midnight's docs both say a `project_id` in browser code can be copied by anyone and used against your quota. The access filters that do exist (origin, IP and endpoint allowlists) can't make a shipped key safe. Anyone outside a browser can forge the `Origin` header, and an IP allowlist rules out browser users. Keep the Chain Data Proxy.

Two findings shrink what the proxy has to do:

- **Writes never need our token.** The web app already submits through Lace's `submitTransaction`, and the DApp Connector spec calls this the wallet acting as a relayer.
- **Wallet-driven reads may not need our token either.** The connector spec says a DApp *should* use the indexer that `getConfiguration()` returns. Midnight's own browser tutorial does exactly that.

## (a) Restricting a project key

| Question | Finding | Source |
|---|---|---|
| Is `project_id` a secret? | Yes. "`project_id` is a secret … Ideally, setup your own application backend to securely store your `project_id` to prevent the leakage. Otherwise, someone else could piggyback on your token." | [blockfrost.dev getting-started](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/overview/getting-started.md) |
| Does Blockfrost recommend going without a backend? | No. "We don't recommend running an app without an app backend as this will most likely leak your `project_id`." | [blockfrost.dev tips-tricks](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building/tips-tricks.md) |
| Is there a public or browser-safe key mode? | None documented. The Midnight page names only two ways to authenticate, a `project_id` header or a `?project_id=` query parameter. | [blockfrost.dev Midnight page](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building/midnight/midnight.md), [docs.blockfrost.io/midnight](https://docs.blockfrost.io/midnight/) |
| Origin allowlist | Exists at project level. Requests from other origins get 403, and so do requests with no `Origin` header. Subdomain wildcards are supported. | [blockfrost.dev access-filters](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/overview/settings/access-filters.md) |
| IP allowlist | Exists. IPv4, IPv6 and CIDR ranges. Other IPs get 403. | same |
| Endpoint allowlist | Exists. Requests to endpoints that aren't listed get 403. | same |
| Do access filters apply to **Midnight** projects? | **Unverified.** The access-filters page predates Midnight and never mentions it. Neither Midnight API page mentions access filters. | same, plus the [Blockfrost Midnight launch post](https://blog.blockfrost.io/blockfrost-supports-midnight/) |
| Read-only scope | **None documented.** For Midnight the endpoint allowlist is coarse at best. The indexer is one GraphQL endpoint (`/api/v0`, which also takes mutations), and the node RPC is one JSON-RPC endpoint that also submits transactions. Nothing documents filtering by GraphQL operation or by JSON-RPC method (for example, blocking `author_submitExtrinsic`). | [blockfrost.dev Midnight page](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building/midnight/midnight.md) ("GraphQL queries and mutations"; RPC is for "transaction submission") |
| Per-key quota cap | **None documented.** Plan limits "are shared across projects", so one leaked key drains the quota for every project, the operators' included. | [blockfrost.dev plans-and-billing](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/overview/plans-and-billing.md) |
| Midnight's own guidance | "A token inside a browser-side URL is visible to anyone who loads the page, and anyone who copies it spends your quota. For a browser DApp, send indexer and RPC calls through a backend you control that adds the token on the server, or use a token you are prepared to treat as public. If your DApp takes its endpoints from the user's wallet through the DApp Connector API (`getConfiguration()`), the wallet decides which indexer and node it uses." | [midnight-docs networks-and-environments.mdx, "Keep the token out of browser code and logs"](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/networks-and-environments.mdx) |
| What Midnight did in its own dApp | Moved indexer queries server-side to "keep its Blockfrost key off the client". The PR also notes that an Origin check is something "non-browser clients can fake". | [midnight-cnight-to-dust-dapp PR #257](https://github.com/midnightntwrk/midnight-cnight-to-dust-dapp/pull/257) (merged 2026-10-01) |

Why an origin allowlist doesn't make the key safe: browsers set `Origin` themselves and scripts can't override it, so the allowlist stops other *websites* from using the key. It doesn't stop a `curl` or a script that sends `Origin: https://<our-app>`. This is standard HTTP behaviour; the PR above makes the same point. An IP allowlist is useless for browser users, whose IPs are arbitrary. It does fit the proxy, which can be pinned to Render's outbound IPs (Render's egress IP ranges are **unverified**).

## (b) Rate limits and daily quotas

| Item | Finding | Source |
|---|---|---|
| Free tier (STARTER) | 50,000 requests/day, no card required. Midnight is included on every plan. | [Blockfrost Midnight launch post](https://blog.blockfrost.io/blockfrost-supports-midnight/) (2026-04-16) |
| Paid tiers | Four plans: STARTER, HOBBY, DEVELOPER, ENTERPRISE. Request boosts add 300,000/day (Hobby) or 1,000,000/day (Developer/Enterprise). **Unverified:** daily quotas and prices for HOBBY and DEVELOPER. The pricing table is a JS-rendered page and an image. A competitor's page lists Developer at EUR 79/mo for 1M/day, which is not a primary source. | [plans-and-billing](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/overview/plans-and-billing.md) |
| Day boundary | Midnight to midnight UTC. | [start-building "Limits"](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building.md) |
| Rate limit | Per end user, **distinguished by IP address**: 10 req/s sustained, with a 500-request burst that refills at 10 req/s. Custom limits and IP whitelisting are ENTERPRISE only. | same, and [plans-and-billing](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/overview/plans-and-billing.md) |
| Errors | 402 when over the daily limit, 429 when rate-limited, 418 for an auto-ban after flooding past 402/429, 403 for auth or filter rejections. | [start-building "Errors"](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building.md) |
| Does Midnight share these limits? | Yes: "Midnight projects share the same rate limits as your Cardano subscription." | [launch post FAQ](https://blog.blockfrost.io/blockfrost-supports-midnight/) |
| GraphQL limits | Separate per-query caps on depth, field count, complexity and timeout. | [docs.blockfrost.io/midnight](https://docs.blockfrost.io/midnight/) |
| Do **WebSocket subscription messages** count as requests? | **Unverified.** Not documented (connection count, per-message metering, or connect-only). | none found |
| Do **RPC** calls count? | Probably, since they are Midnight requests on the same project, but per-call metering is **unverified**. | none found |

What this means for the browser lifecycle (#24) and the Sponsor quota checks:

- **The per-IP rate limit hurts the proxy, not a browser key.** Behind one Render service, every user shares the proxy's egress IP and therefore one 10 req/s budget, unless we buy ENTERPRISE IP whitelisting. The proxy must cache aggressively: chain-tip and contract-state reads are the same for every user. It must also fan out subscriptions itself instead of opening one upstream WebSocket per browser. Blockfrost recommends the caching layer and warns about this exact IP effect in [tips-tricks](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building/tips-tricks.md).
- **50,000/day is about 0.58 req/s averaged across the day.** A polling finality observer (`createPollingFinalityObserver`, 2 s poll × 3 probes) uses about 1.5 req/s per user while it waits. A few dozen concurrent waits in a busy window would use up a STARTER day. That points to a paid plan, caching, or moving finality to WS subscriptions. Whether WS subscriptions are cheaper depends on the unverified metering question above.
- **The Sponsor shares the same plan quota** (limits are shared across projects). If the Sponsor and the proxy run on one account, a leaked browser key would also starve the Sponsor.

## (c) midnight-js 4.1.1 and `?project_id=`

Checked against the installed source, `node_modules/.pnpm/@midnight-ntwrk+midnight-js-indexer-public-data-provider@4.1.1/.../dist/index.mjs`:

- `indexerPublicDataProvider(queryURL, subscriptionURL, webSocketImpl)` (line 1040) takes **two plain URL strings and no headers option**. Internally it parses them with `new URL()` only to check the scheme (`http:`/`https:` and `ws:`/`wss:`, lines 795–802). It then passes the original strings through unchanged: `new HttpLink({ fetch, uri: queryURL })` (line 806) and `createClient({ url: subscriptionURL, webSocketImpl })` (line 824).
- HTTP: Apollo Client 4.3.0's `BaseHttpLink` sends POST to `uri` as given, so a query string is kept. `rewriteURIForGET` would also append with `&` when a `?` is already present (`rewriteURIForGET.js` line 48), but this provider doesn't enable GET.
- WS: graphql-ws 6.2.1 calls `new WebSocketImpl(url, "graphql-transport-ws")` with the URL unchanged (`client.js` line 136). Browser WebSockets can't set custom headers anyway.
- **Conclusion:** the `?project_id=` form works for both HTTP and WS, and a header is impossible without wrapping the provider. Blockfrost's docs ("Use this when your client doesn't support setting custom headers (e.g. Midnight.js SDK)", [Midnight page](https://github.com/blockfrost/blockfrost.dev/blob/master/docs/start-building/midnight/midnight.md)) and Midnight's docs ("Use the query parameter with the Midnight SDK: `indexerPublicDataProvider` … take plain URLs", [networks guide](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/guides/networks-and-environments.mdx)) agree.
- The app's own `GraphqlPublicDataProvider` and `JsonRpcProvider` (`apps/web/src/lib/midnight/providers.ts`) call `fetch(this.endpoint, …)` with the URL unchanged, so a query string is kept there too.
- A related gotcha, **unverified** (seen only in a search summary of [example-bboard PR #1583](https://github.com/midnightntwrk/example-bboard/pull/1583), not read at the source): testkit-js 4.1.1 drops the query string from its health-check URLs. That would affect operator tooling, not the browser.

## (d) Does Lace submit through its own node?

- **Yes, per the DApp Connector spec.** `submitTransaction` is "use wallet as a relayer to submit transaction to the network". The transaction must already be balanced, sealed and proven. Sources: [SPECIFICATION.md](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/dapp-connector/_media/SPECIFICATION.md) and [WalletConnectedAPI](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/dapp-connector/type-aliases/WalletConnectedAPI.md).
- **Shroudly already does this.** `submitPlan` in `apps/web/src/lib/midnight/preprod-adapter.ts` calls `operations.submitTransaction`. Browser RPC (`JsonRpcProvider`) is used only for read probes such as `networkFinalized`. The browser never needs RPC *write* access through our token.
- **Reads can come from the wallet too.** The spec (§ "Initialization and configuration") says: "The DApp should connect to indexer and proving server indicated by configuration … the wallet must point to service deployments, which are compatible with network id present … and preferably are the same that the wallet itself uses." The [leaderboard browser tutorial](https://github.com/midnightntwrk/midnight-docs/blob/main/docs/tutorials/leaderboard/browser-dapp.mdx) builds `indexerPublicDataProvider(config.indexerUri, config.indexerWsUri)` from `getConfiguration()` and submits through `connectedAPI.submitTransaction`. `getConfiguration()` also returns `substrateNodeUri` ([dapp-connector README](https://github.com/midnightntwrk/midnight-docs/blob/main/api-reference/dapp-connector/README.md)).
- **Unverified:** which indexer and node Lace is configured with on Preprod after the 9 Oct shutdown, whether those URLs carry Lace's own Blockfrost token, and whether users can change them. No Lace release note or setting was found. This needs a hands-on check: connect Lace on Preprod, log `getConfiguration()` with the query string redacted, and run one query against `indexerUri`.

## Recommendation

**Keep the read-only Chain Data Proxy (#60) as the default, and don't ship a Blockfrost key in the Vercel bundle.** There is no public key mode. No read-only scope is documented. Quota is shared across every project on the account, and the only browser-side control (the Origin allowlist) is forgeable. Both Blockfrost and Midnight tell browser DApps to use a backend.

Shape the proxy around what these findings show:

1. **Wallet-scoped reads go to the wallet's endpoints.** Use `getConfiguration().indexerUri/indexerWsUri` for reads tied to the connected wallet, as the Midnight tutorial does. These cost us no quota. This depends on the unverified Lace check above.
2. **The proxy serves only what the wallet's endpoints can't**, or what must be pinned to a known deployment: contract-state reads for the four Shroudly contracts, finality probes (`networkFinalized` and `ledgerConfirmed` over RPC), and pre-connect reads before a wallet is attached. Allowlist the GraphQL operations and JSON-RPC methods, reject mutations and `author_submit*`, cache shared reads, and send the token as a header with the query string stripped from logs (Midnight's [cnight-to-dust PR #257](https://github.com/midnightntwrk/midnight-cnight-to-dust-dapp/pull/257) is a working template).
3. **No browser write path through our token.** Lace already relays submissions.
4. **Budget for the per-IP limit.** All proxy traffic shares one 10 req/s budget. Cache, coalesce subscriptions, and plan for a paid tier if finality polling grows.
5. **Use separate Blockfrost accounts, or at least projects, for the proxy and the Sponsor**, and turn on the IP allowlist for the proxy's Render egress. Limits are per account, so only separate accounts isolate the Sponsor's quota.

Also note: `apps/web/vercel.json` sets `connect-src 'self' https://*.midnight.network https://*.vercel.app`, and `config.ts` still defaults to the shut-down `indexer.preprod.midnight.network/api/v4/graphql` and `rpc.preprod.midnight.network`. Whichever path is chosen, the CSP must allow the proxy origin. Wallet-supplied endpoints would also need their (Blockfrost) origins and `wss:`, and the defaults must change.

## Open questions (unverified)

- Do Blockfrost access filters (origin, IP, endpoint) apply to Midnight projects?
- How are WebSocket subscriptions and node RPC calls metered against the daily quota?
- What are the exact HOBBY and DEVELOPER daily quotas and prices?
- What does Lace's `getConfiguration()` return on Preprod after the shutdown, and does it embed Lace's own token?
- What are Render's outbound IP ranges, for the proxy's IP allowlist?
