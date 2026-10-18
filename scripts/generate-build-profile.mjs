import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const versionProfile = JSON.parse(readFileSync(resolve(root, "midnight/version-profile.json"), "utf8"));
const outputFlag = process.argv.indexOf("--out");
const outputArg = outputFlag >= 0 ? process.argv[outputFlag + 1] : "apps/web/public/build-profile.json";
if (!outputArg || outputArg.startsWith("-")) throw new Error("--out requires a file path");
const output = resolve(root, outputArg);
const sourceNames = ["TmixAsset", "RandomnessThreshold", "YieldAdapter", "PrizePool"];
const env = process.env;
const releaseBuild = process.argv.includes("--production") || envFlag("SHROUDLY_RELEASE_BUILD");
const sourceArtifactHashes = sourceNames.map((name) => `0x${createHash("sha256").update(readFileSync(resolve(root, "midnight", `${name}.compact`))).digest("hex")}`);
const configuredArtifactHashValues = [env.VITE_SHROUDLY_ASSET_ARTIFACT_HASH, env.VITE_SHROUDLY_RANDOMNESS_ARTIFACT_HASH, env.VITE_SHROUDLY_YIELD_ARTIFACT_HASH, env.VITE_SHROUDLY_POOL_ARTIFACT_HASH];
const configuredArtifactHashes = configuredArtifactHashValues.filter((value) => value !== undefined && value !== "");
if (configuredArtifactHashes.length > 0 && (configuredArtifactHashes.length !== sourceNames.length || configuredArtifactHashes.some((value) => !/^0x[0-9a-fA-F]{64}$/.test(value)))) {
  throw new Error("all four VITE_SHROUDLY_*_ARTIFACT_HASH values must be 0x-prefixed 32-byte hashes when configured");
}
const artifactHashes = configuredArtifactHashes.length === sourceNames.length ? configuredArtifactHashes : sourceArtifactHashes;
const constants = {
  token: "tMIX",
  tokenDecimals: 6,
  supplyCapMicroUnits: "10000000000000",
  faucetAmountMicroUnits: "1000000000",
  faucetEpochSeconds: "86400",
  automationAllocationMicroUnits: "25000000000",
  initialPrizeReserveMicroUnits: "1000000000000",
  simulatedYieldPerDrawMicroUnits: "100000000",
  simulatedYieldIntervalSeconds: "900",
  contributionMinMicroUnits: "1000000",
  contributionMaxMicroUnits: "1000000000",
  prizeReplenishmentMaxMicroUnits: "1000000000000",
  prizeReplenishmentTimelockSeconds: "3600",
  disclosureCohort: 5,
  randomnessContributors: 3,
  randomnessThreshold: 2,
  claimWindowSeconds: "3600",
  fullSettlementPauseMaxSeconds: "86400",
  sponsorTimeoutMilliseconds: 8000,
  sponsoredActionsPerAccountPer24h: 20,
  sponsoredActionsGlobalPerUtcDay: 500,
  sponsorDustCap: "125% of max observed qualification cost",
};
const profile = {
  product: "Shroudly",
  environment: "preprod",
  networkId: "preprod",
  deploymentId: env.VITE_SHROUDLY_DEPLOYMENT_ID || "shroudly-preprod-unassigned",
  contractIds: {
    asset: env.VITE_SHROUDLY_ASSET_CONTRACT_ID || "unassigned",
    randomness: env.VITE_SHROUDLY_RANDOMNESS_CONTRACT_ID || "unassigned",
    yield: env.VITE_SHROUDLY_YIELD_CONTRACT_ID || "unassigned",
    pool: env.VITE_SHROUDLY_POOL_CONTRACT_ID || "unassigned",
  },
  artifactHashes,
  endpoints: {
    // Browser endpoints are Chain Data Proxy routes. The reserved .invalid
    // defaults fail closed until a deployment names the real proxy.
    rpc: env.VITE_SHROUDLY_RPC_URL || "https://chain-data-proxy.invalid/rpc",
    indexer: env.VITE_SHROUDLY_INDEXER_URL || "https://chain-data-proxy.invalid/indexer",
    zkConfig: env.VITE_SHROUDLY_ZK_CONFIG_URL || "",
    sponsor: env.VITE_SHROUDLY_SPONSOR_URL || "",
  },
  compatibility: {
    compactCli: versionProfile.compactCli,
    compactLanguage: versionProfile.compactLanguage,
    compactCompiler: versionProfile.compactCompiler,
    compactRuntime: versionProfile.compactRuntime,
    midnightJs: versionProfile.midnightJs,
    walletSdk: versionProfile.walletSdk,
    dappConnector: versionProfile.dappConnector,
    node: versionProfile.node,
    indexer: versionProfile.indexer,
    proofServer: versionProfile.proofServer,
    onchainRuntime: versionProfile.onchainRuntime,
    ledger: versionProfile.ledger,
  },
  chainDataProvider: versionProfile.network.provider,
  browserReads: versionProfile.network.browserReads,
  constants,
  governance: "two-of-three-preprod",
  qualificationVerifierFingerprint: versionProfile.qualificationVerifierFingerprint ?? null,
  deployerDeadlineSeconds: "86400",
  mainnetTransactionsEnabled: false,
};
for (const [name, value] of Object.entries(profile.endpoints)) assertBrowserEndpoint(`${name} endpoint`, value);
if (releaseBuild) validateReleaseProfile(profile, configuredArtifactHashes);
profile.snapshotHash = `0x${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o644 });
console.log(`Wrote sanitized Shroudly build profile to ${output.replace(`${root}/`, "")}`);

function envFlag(name) { return env[name] === "1"; }

function assertBrowserEndpoint(label, value) {
  if (!value) return;
  let parsed;
  try { parsed = new URL(value); } catch { return; }
  if (/(^|\.)blockfrost\.io$/i.test(parsed.hostname) || parsed.searchParams.has("project_id")) {
    throw new Error(`${label} must be a Chain Data Proxy route, never a Blockfrost URL or project_id`);
  }
}

function validateReleaseProfile(candidate, configuredHashes) {
  if (!candidate.deploymentId || candidate.deploymentId === "shroudly-preprod-unassigned") throw new Error("release build requires an immutable Shroudly deployment ID");
  for (const [name, value] of Object.entries(candidate.contractIds)) {
    if (!value || value === "unassigned") throw new Error(`release build requires the ${name} contract ID`);
  }
  for (const [name, value] of Object.entries(candidate.endpoints)) {
    if (!value) throw new Error(`release build requires a ${name} endpoint`);
    assertHttpsEndpoint(`${name} endpoint`, value);
    if (new URL(value).hostname.endsWith(".invalid")) throw new Error(`release build requires a deployed ${name} endpoint, not the placeholder`);
  }
  if (configuredHashes.length !== sourceNames.length || configuredHashes.some((value) => !/^0x[0-9a-fA-F]{64}$/.test(value))) {
    throw new Error("release build requires all four explicitly configured Compact artifact hashes");
  }
  if (!/^[a-f0-9]{64}$/.test(candidate.qualificationVerifierFingerprint ?? "")) {
    throw new Error("release build requires the reviewed qualification verifier fingerprint");
  }
  if (candidate.mainnetTransactionsEnabled !== false || candidate.networkId !== "preprod") throw new Error("release build must remain on Midnight Preprod with Mainnet disabled");
}

function assertHttpsEndpoint(label, value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a valid HTTPS URL`); }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
}
