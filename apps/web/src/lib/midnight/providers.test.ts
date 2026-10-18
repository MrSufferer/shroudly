import { describe, expect, test } from "vitest";
import { browserChainEndpoint } from "./config";
import { MemoryPrivateStateStore } from "./private-state";
import { createConfiguredOfficialProviders, createGraphqlPublicDataProvider, createJsonRpcProvider, createJsonZkConfigProvider, createMidnightProviderBoundaries, createPollingFinalityObserver, createWalletProofProvider } from "./providers";

const baseConfig = {
  network: "preprod" as const,
  rpcUrl: "https://chain-data-proxy.test/rpc",
  indexerGraphqlUrl: "https://chain-data-proxy.test/indexer",
};

describe("Midnight provider boundaries", () => {
  test("keeps the chain data provider token out of browser endpoints", () => {
    expect(browserChainEndpoint("VITE_SHROUDLY_INDEXER_URL", baseConfig.indexerGraphqlUrl)).toBe(baseConfig.indexerGraphqlUrl);
    expect(() => browserChainEndpoint("VITE_SHROUDLY_INDEXER_URL", "https://midnight-preprod.blockfrost.io/api/v0")).toThrow("Chain Data Proxy route");
    expect(() => browserChainEndpoint("VITE_SHROUDLY_RPC_URL", "https://rpc.midnight-preprod.blockfrost.io")).toThrow("Chain Data Proxy route");
    expect(() => browserChainEndpoint("VITE_SHROUDLY_RPC_URL", "https://chain-data-proxy.test/rpc?project_id=x")).toThrow("Chain Data Proxy route");
  });

  test("defaults to local proving and keeps disconnected adapters explicit", async () => {
    const boundaries = createMidnightProviderBoundaries(baseConfig, {
      privateState: new MemoryPrivateStateStore<unknown>(),
    });

    expect(boundaries.status).toEqual({
      proofMode: "local",
      privateState: "local",
      publicData: "indexer",
      connector: "dapp-connector-boundary",
      dust: "explicit-approval-boundary",
    });
    await expect(boundaries.proof.prove({})).rejects.toThrow(
      "proof provider is not connected",
    );
    await expect(boundaries.wallet.connect()).rejects.toThrow(
      "wallet provider is not connected",
    );
  });

  test("requires explicit opt-in before remote proving can be selected", () => {
    expect(() =>
      createMidnightProviderBoundaries(
        { ...baseConfig, proofMode: "remote-opt-in" },
        { privateState: new MemoryPrivateStateStore<unknown>() },
      ),
    ).toThrow("remote proving requires explicit opt-in");

    const remote = createMidnightProviderBoundaries(
      { ...baseConfig, proofMode: "remote-opt-in", allowRemoteProof: true },
      { privateState: new MemoryPrivateStateStore<unknown>() },
    );
    expect(remote.status.proofMode).toBe("remote-opt-in");
  });

  test("uses the pinned indexer GraphQL and RPC transport without accepting insecure endpoints", async () => {
    const requests: RequestInit[] = [];
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.jsonrpc ? { jsonrpc: "2.0", id: body.id, result: { height: 42 } } : { data: { ledger: { height: 42 } } }), { status: 200 });
    };
    const indexer = createGraphqlPublicDataProvider(baseConfig.indexerGraphqlUrl, { fetch: fetchImpl });
    const rpc = createJsonRpcProvider(baseConfig.rpcUrl, { fetch: fetchImpl });

    await expect(indexer.query("query Ledger($id: ID!) { ledger(id: $id) { height } }", { id: "tx-1" })).resolves.toEqual({ ledger: { height: 42 } });
    await expect(rpc.request("chain_getHeader", ["0x1"])).resolves.toEqual({ height: 42 });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0].body))).toMatchObject({ query: expect.stringContaining("Ledger"), variables: { id: "tx-1" } });
    expect(JSON.parse(String(requests[1].body))).toMatchObject({ jsonrpc: "2.0", method: "chain_getHeader", params: ["0x1"] });
    expect(() => createGraphqlPublicDataProvider("http://indexer.example")).toThrow("HTTPS");
    expect(() => createJsonRpcProvider("http://rpc.example")).toThrow("HTTPS");
  });

  test("loads pinned ZK configuration over HTTPS", async () => {
    const requests: RequestInit[] = [];
    const zk = createJsonZkConfigProvider("https://web.shroudly.test/zk/config.json", {
      fetch: async (_input, init) => { requests.push(init ?? {}); return new Response(JSON.stringify({ contract: "pool", revision: "pinned" }), { status: 200 }); },
    });
    await expect(zk.load()).resolves.toEqual({ contract: "pool", revision: "pinned" });
    expect(requests[0]).toMatchObject({ method: "GET" });
    expect(() => createJsonZkConfigProvider("http://zk.example")).toThrow("HTTPS");
  });

  test("anchors official composition to configured network transports", () => {
    const composition = createConfiguredOfficialProviders({
      rpcUrl: baseConfig.rpcUrl,
      indexerGraphqlUrl: baseConfig.indexerGraphqlUrl,
      zkConfigUrl: "https://web.shroudly.test/zk/config.json",
    });
    expect(composition.network).toBe("preprod");
    expect(composition.publicData).toMatchObject({ kind: "indexer", endpointUrl: baseConfig.indexerGraphqlUrl });
    expect(composition.rpc).toMatchObject({ endpointUrl: baseConfig.rpcUrl });
    expect(composition.zkConfig).toMatchObject({ endpointUrl: "https://web.shroudly.test/zk/config.json" });
  });

  test("requires all three independent finality observations", async () => {
    let round = 0;
    const observer = createPollingFinalityObserver({
      networkFinalized: async () => { round += 1; return round > 1; },
      indexerVisible: async () => round > 1,
      ledgerConfirmed: async () => round > 1,
    }, { timeoutMs: 100, pollMs: 1 });

    await expect(observer.wait("0xtransaction")).resolves.toEqual({ transactionId: "0xtransaction", networkFinalized: true, indexerVisible: true, ledgerConfirmed: true });
  });

  test("calls a wallet-owned proof provider with its receiver intact", async () => {
    const provider: { calls: number; prove(this: { calls: number }, request: unknown): unknown } = {
      calls: 0,
      prove(this: { calls: number }, request: unknown) { this.calls += request === "proof-request" ? 1 : 0; return { ok: true }; },
    };
    const proof = createWalletProofProvider(provider);
    await expect(proof.prove("proof-request")).resolves.toEqual({ ok: true });
    expect(provider.calls).toBe(1);
  });
});
