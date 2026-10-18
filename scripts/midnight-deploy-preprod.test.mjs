import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  artifactManifest,
  assertPreprodProfile,
  automationEncryptionMapping,
  contractPlan,
  createProtectedAssembly,
  createWitnessMap,
  finalizedTransactionId,
  immutableDeploymentId,
  normalizeFinalizedResult,
  parseArgs,
  runCheck,
  runDeployment,
  validateReceipt,
  withProviderToken,
  withTimeout,
} from "./midnight-deploy-preprod.mjs";

const PROFILE = {
  profile: "shroudly-midnight-preprod-v1",
  network: { name: "preprod" },
  compactCli: "0.5.2",
  compactCompiler: "0.31.1",
  proofServer: "8.1.3",
  compactLanguage: "0.23.0",
  compactRuntime: "0.16.0",
  midnightJs: "4.1.1",
  walletSdk: "1.2.0",
};

const MANIFEST = {
  artifacts: {
    asset: `0x${"a".repeat(64)}`,
    randomness: `0x${"b".repeat(64)}`,
    yield: `0x${"c".repeat(64)}`,
    pool: `0x${"d".repeat(64)}`,
  },
  bundleHash: `0x${"e".repeat(64)}`,
};

const AUTHORITIES = Object.fromEntries([
  "assetLocal",
  "assetReserve",
  "assetAutomation",
  "assetParticipant",
  "randomnessRender",
  "randomnessGithubActions",
  "randomnessOfflineMaintainer",
  "yieldOperator",
  "yieldGovernance",
  "poolDeployer",
  "poolGovernanceOne",
  "poolGovernanceTwo",
  "poolGovernanceThree",
].map((name, index) => [name, `${(index + 1).toString(16).padStart(2, "0").repeat(32)}`]));

function publicEvidence(number) {
  const nibble = (number % 16).toString(16);
  return {
    public: {
      txId: `tx-${number}`,
      status: "SucceedEntirely",
      txHash: `0x${nibble.repeat(64)}`,
      blockHash: `0x${((number + 1) % 16).toString(16).repeat(64)}`,
      blockHeight: number,
      blockTimestamp: 1_700_000_000 + number,
    },
    private: { secret: "do-not-copy-to-receipt" },
  };
}

test("deployment ID is immutable and includes UTC timestamp plus bundle prefix", () => {
  const id = immutableDeploymentId(new Date("2026-09-16T01:02:03.000Z"), "0xabcdef0123456789");
  assert.equal(id, "shroudly-preprod-20260916T010203Z-abcdef01");
});

test("CLI requires explicit submit and supports safe resume", () => {
  assert.deepEqual(parseArgs(["--submit", "--resume"]), { submit: true, resume: true, validate: false, receipt: parseArgs([]).receipt });
  assert.throws(() => parseArgs(["--resume"]), /requires --submit/);
  assert.equal(parseArgs(["--check"]).check, true);
  assert.throws(() => parseArgs(["--check", "--submit"]), /cannot be combined/);
});

test("artifact bundle is deterministic and all four contracts are represented", () => {
  const manifest = artifactManifest();
  assert.deepEqual(Object.keys(manifest.artifacts), ["asset", "randomness", "yield", "pool"]);
  for (const hash of Object.values(manifest.artifacts)) assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.match(manifest.bundleHash, /^0x[0-9a-f]{64}$/);
});

test("profile gate refuses a non-Preprod profile", () => {
  assert.throws(() => assertPreprodProfile({ ...PROFILE, network: { name: "mainnet" } }), /not Midnight Preprod/);
  assert.throws(() => assertPreprodProfile(PROFILE, { midnightJs: "4.0.0" }), /installed pin midnightJs/);
  assert.equal(assertPreprodProfile(PROFILE), true);
});

test("contract plan is dependency ordered and pins PrizePool constructor IDs", () => {
  const adapter = {
    contracts: {
      asset: { id: "a".repeat(64) },
      randomness: { id: "b".repeat(64) },
      yield: { id: "c".repeat(64) },
    },
    tokenColor: Uint8Array.from({ length: 32 }, (_, index) => index),
  };
  const plan = contractPlan(adapter, Object.fromEntries(["assetLocal", "assetReserve", "assetAutomation", "assetParticipant", "randomnessRender", "randomnessGithubActions", "randomnessOfflineMaintainer", "yieldOperator", "yieldGovernance", "poolDeployer", "poolGovernanceOne", "poolGovernanceTwo", "poolGovernanceThree"].map((key) => [key, key])));
  assert.deepEqual(plan.map(({ key }) => key), ["asset", "randomness", "yield", "pool"]);
  assert.deepEqual(plan[3].constructorArgs(), [Uint8Array.from(Buffer.from("a".repeat(64), "hex")), adapter.tokenColor, Uint8Array.from(Buffer.from("b".repeat(64), "hex")), Uint8Array.from(Buffer.from("c".repeat(64), "hex"))]);
});

test("Midnight.js results are normalized from finalized public evidence only", () => {
  const normalized = normalizeFinalizedResult(publicEvidence(1), { kind: "fixture" });
  assert.deepEqual(normalized, {
    id: "tx-1",
    txId: "tx-1",
    status: "SucceedEntirely",
    txHash: `0x${"1".repeat(64)}`,
    blockHash: `0x${"2".repeat(64)}`,
    blockHeight: 1,
    blockTimestamp: 1_700_000_001,
    finalizedAt: "2023-11-14T22:13:21.000Z",
  });
  assert.equal(normalized.private, undefined);
  assert.throws(() => normalizeFinalizedResult({ success: true, txId: "synthetic" }), /did not finalize successfully|no public transaction evidence/);
});

test("witnesses fail closed and automation mapping requires both recipient keys", async () => {
  const privateState = { marker: "isolated" };
  const map = createWitnessMap({
    key: "asset",
    authorities: { authorities: { assetReserve: AUTHORITIES.assetReserve } },
    privateState,
    automationWallet: { coinPublicKey: "0x1234" },
  });
  const [state, secret] = map.reserve_secret();
  assert.equal(state, privateState);
  assert.equal(secret.length, 32);
  assert.throws(() => map.participant_secret(), /not provisioned/);
  assert.deepEqual(map.automation_public_key()[1].bytes, Uint8Array.from([0x12, 0x34]));
  assert.deepEqual(await automationEncryptionMapping({ coinPublicKey: "coin", encryptionPublicKey: "enc" }), new Map([["coin", "enc"]]));
  await assert.rejects(automationEncryptionMapping({ coinPublicKey: "coin" }), /both coin and encryption/);
});

test("default assembly seam composes with injected providers without credentials", async () => {
  const assembly = await createProtectedAssembly({
    profile: PROFILE,
    manifest: MANIFEST,
    providers: {
      publicDataProvider: { watchForTxData: async () => publicEvidence(1) },
      privateStateProvider: {},
      zkConfigProvider: {},
      proofProvider: {},
      walletProvider: {
        getCoinPublicKey: () => "coin",
        getEncryptionPublicKey: () => "enc",
        synchronize: async () => undefined,
        getBalances: async () => [1n],
      },
      midnightProvider: { submitTx: async () => "tx-1" },
    },
    compiledContracts: { asset: {}, randomness: {}, yield: {}, pool: {} },
    additionalCoinEncPublicKeyMappings: new Map([["coin", "enc"]]),
  });
  try {
    assert.deepEqual(Object.keys(assembly.providers), ["asset", "randomness", "yield", "pool"]);
    for (const method of ["synchronize", "assertFunds", "deploy", "call", "readLedger", "deriveTokenColor", "close"]) {
      assert.equal(typeof assembly[method], "function", method);
    }
  } finally {
    await assembly.close();
  }
});

test("default assembly loads generated Compact contracts through the protected seam", async () => {
  const assembly = await createProtectedAssembly({
    profile: PROFILE,
    manifest: MANIFEST,
    providers: {
      publicDataProvider: { watchForTxData: async () => publicEvidence(1) },
      privateStateProvider: {},
      zkConfigProvider: {},
      proofProvider: {},
      walletProvider: {
        getCoinPublicKey: () => "coin",
        getEncryptionPublicKey: () => "enc",
        synchronize: async () => undefined,
        getBalances: async () => ({ shieldedBalances: { NIGHT: 1n }, dustBalance: 1n }),
      },
      midnightProvider: { submitTx: async () => "tx-1" },
    },
    additionalCoinEncPublicKeyMappings: new Map([["coin", "enc"]]),
  });
  try {
    for (const key of ["asset", "randomness", "yield", "pool"]) {
      assert.equal(typeof assembly.compiledContracts[key].compiled, "object", key);
      assert.equal(typeof assembly.compiledContracts[key].module.Contract, "function", key);
    }
  } finally {
    await assembly.close();
  }
});

test("node submission uses the ledger transaction identifier, never the finalized event hash", () => {
  const tx = { identifiers: () => ["tx-id-1"], serialize: () => Uint8Array.from([1]) };
  assert.equal(finalizedTransactionId(tx), "tx-id-1");
  assert.throws(() => finalizedTransactionId({ identifiers: () => [] }), /no Midnight transaction identifier/);
});

test("read-only assembly construction never creates private state", async () => {
  const root = mkdtempSync(join(tmpdir(), "midnight-readonly-"));
  await assert.rejects(createProtectedAssembly({
    root,
    readOnly: true,
    profile: PROFILE,
    manifest: MANIFEST,
    providers: {
      publicDataProvider: {},
      zkConfigProvider: {},
      proofProvider: {},
      walletProvider: { getCoinPublicKey: () => "coin", getEncryptionPublicKey: () => "enc" },
      midnightProvider: {},
    },
    compiledContracts: { asset: {}, randomness: {}, yield: {}, pool: {} },
  }), /read-only mode/);
});

test("bounded operations reject hung providers and clear their timer on success", async () => {
  await assert.rejects(withTimeout(new Promise((resolve) => setTimeout(resolve, 25)), 2, "hung provider"), /hung provider timed out/);
  assert.equal(await withTimeout(Promise.resolve("ok"), 20, "quick provider"), "ok");
});

test("full Stage 4 orchestration records six public finalized transactions in order", async () => {
  const root = mkdtempSync(join(tmpdir(), "midnight-stage4-"));
  const receiptPath = join(root, "evidence", "preprod-stage4.json");
  const order = [];
  let sequence = 0;
  const assembly = {
    contracts: {},
    tokenColor: undefined,
    async synchronize() { order.push("synchronize"); },
    async assertFunds() { order.push("assertFunds"); },
    async deploy({ key }) {
      order.push(key);
      sequence += 1;
      return { contractId: `0x${((sequence + 8) % 16).toString(16).repeat(64)}`, ...publicEvidence(sequence) };
    },
    async deriveTokenColor() {
      order.push("derive-token-color");
      return Uint8Array.from({ length: 32 }, (_, index) => index);
    },
    async call({ circuit }) {
      order.push(circuit === "seedPrizeReserve" ? "seed-reserve" : "evidence-fixture");
      sequence += 1;
      return publicEvidence(sequence);
    },
    async readLedger({ fields }) {
      order.push(`ledger:${fields.join(",")}`);
      return fields.includes("reserveSeeded") ? { reserveSeeded: true } : { automationIssued: true };
    },
    async close() { order.push("close"); },
  };
  const revision = { revision: "f".repeat(40), dirty: false, changes: [] };
  const receipt = await runDeployment({
    root,
    receiptPath,
    submit: true,
    now: new Date("2026-09-16T01:02:03.000Z"),
    profile: PROFILE,
    manifest: MANIFEST,
    preflight: async () => PROFILE,
    sourceRevisionReader: async () => revision,
    authoritiesFactory: async () => AUTHORITIES,
    assemblyFactory: async () => assembly,
  });
  assert.deepEqual(order, [
    "synchronize",
    "assertFunds",
    "asset",
    "derive-token-color",
    "randomness",
    "yield",
    "pool",
    "seed-reserve",
    "ledger:reserveSeeded",
    "evidence-fixture",
    "ledger:automationIssued",
    "close",
  ]);
  assert.equal(receipt.format, 2);
  assert.equal(receipt.status, "finalized");
  assert.equal(receipt.transactions.length, 6);
  assert.equal(receipt.transactions.some((transaction) => transaction.private || transaction.success !== undefined), false);
  assert.equal(validateReceipt(receipt, { profile: PROFILE, artifacts: MANIFEST.artifacts }), true);
  assert.equal((statSync(receiptPath).mode & 0o777).toString(8), "600");
  assert.match(readFileSync(join(root, ".env.production.local"), "utf8"), /VITE_SHROUDLY_POOL_CONTRACT_ID=/);
});

test("check is read-only and validates the protected assembly without receipts or env output", async () => {
  const root = mkdtempSync(join(tmpdir(), "midnight-check-"));
  const privateStatePath = join(root, "private-state");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(privateStatePath, { mode: 0o700 });
  let closed = false;
  const result = await runCheck({
    root,
    env: {
      MIDNIGHT_INDEXER_HTTP_URL: "https://indexer.example/graphql",
      MIDNIGHT_INDEXER_WS_URL: "wss://indexer.example/graphql/ws",
      MIDNIGHT_PROOF_SERVER_URL: "http://proof.example",
    },
    privateStatePath,
    profileReader: async () => PROFILE,
    manifestReader: async () => MANIFEST,
    sourceRevisionReader: async () => ({ revision: "f".repeat(40), dirty: false, changes: [] }),
    authoritiesReader: async () => AUTHORITIES,
    automationWallet: { coinPublicKey: "coin", encryptionPublicKey: "enc" },
    privateStatePasswordReader: async () => "protected-password",
    endpointChecker: async () => ({ ok: true, message: "fixture" }),
    assemblyFactory: async (options) => {
      assert.equal(options.readOnly, true);
      return {
        async synchronize() {},
        async assertFunds() {},
        async close() { closed = true; },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(closed, true);
  assert.equal(statSync(join(root, ".env.production.local"), { throwIfNoEntry: false }), undefined);
  assert.equal(statSync(join(root, "evidence", "preprod-stage4.json"), { throwIfNoEntry: false }), undefined);
});

test("read-only check rejects a private-state file even with a private mode", async () => {
  const root = mkdtempSync(join(tmpdir(), "midnight-check-file-"));
  const privateStatePath = join(root, "private-state");
  const { writeFileSync: writeFixture } = await import("node:fs");
  writeFixture(privateStatePath, "not a database", { mode: 0o600 });
  const result = await runCheck({
    root,
    env: {},
    privateStatePath,
    profileReader: async () => PROFILE,
    manifestReader: async () => MANIFEST,
    sourceRevisionReader: async () => ({ revision: "f".repeat(40), dirty: false, changes: [] }),
    authoritiesReader: async () => AUTHORITIES,
    automationWallet: { coinPublicKey: "coin", encryptionPublicKey: "enc" },
    privateStatePasswordReader: async () => "protected-password",
    endpointChecker: async () => ({ ok: true, message: "fixture" }),
    assemblyFactory: async () => ({
      async synchronize() {},
      async assertFunds() {},
      async close() {},
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name === "private-state-storage").ok, false);
});

test("receipt validation rejects format 1 and synthetic transaction flags", () => {
  assert.throws(() => validateReceipt({ format: 1 }), /unsupported Stage 4 receipt format/);
  const synthetic = {
    format: 2,
    status: "finalized",
    deploymentId: "shroudly-preprod-20260916T010203Z-eeeeeeee",
    network: "preprod",
    sourceRevision: "f".repeat(40),
    sourceDirty: false,
    artifactBundleHash: MANIFEST.bundleHash,
    artifactHashes: MANIFEST.artifacts,
    compatibility: { ...PROFILE, network: "preprod" },
    contracts: {},
    transactions: [{ id: "tx", status: "SucceedEntirely", success: true }],
  };
  assert.throws(() => validateReceipt(synthetic, { profile: PROFILE, artifacts: MANIFEST.artifacts }), /genuine finalized public evidence|missing for/);
});

test("attaches the operator Blockfrost token only to Blockfrost URLs after the WebSocket path is derived", () => {
  const env = { MIDNIGHT_BLOCKFROST_SECRET_NAME: "com.shroudly.preprod.blockfrost", MIDNIGHT_KEYCHAIN_ACCOUNT: "shroudly-preprod" };
  const calls = [];
  const reader = (args) => { calls.push(args); return { status: 0, stdout: "operatorToken123\n" }; };
  assert.equal(
    withProviderToken("wss://midnight-preprod.blockfrost.io/api/v0/ws", env, { reader }),
    "wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=operatorToken123",
  );
  assert.deepEqual(calls[0], ["find-generic-password", "-a", "shroudly-preprod", "-s", "com.shroudly.preprod.blockfrost", "-w"]);
  assert.equal(withProviderToken("http://127.0.0.1:8088/api/v4/graphql", env, { reader }), "http://127.0.0.1:8088/api/v4/graphql");
  assert.equal(calls.length, 1);
  assert.throws(() => withProviderToken("https://midnight-preprod.blockfrost.io/api/v0", {}, { reader }), /MIDNIGHT_BLOCKFROST_SECRET_NAME/);
  assert.throws(() => withProviderToken("https://midnight-preprod.blockfrost.io/api/v0", env, { reader: () => ({ status: 44, stdout: "" }) }), /missing or malformed/);
});
