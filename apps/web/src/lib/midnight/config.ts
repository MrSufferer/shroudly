import { createMigrationTimeline } from "./timeline";
import { PROGRAM_CONSTANTS, MAINNET_INTERFACE } from "./constants";

export const SHROUDLY_ENVIRONMENT = "preprod" as const;
export const SHROUDLY_NETWORK_ID = "preprod" as const;

export type ShroudlyContractIds = Readonly<Record<"asset" | "randomness" | "yield" | "pool", string>>;

export const MIDNIGHT_CONTRACT_IDS: ShroudlyContractIds = Object.freeze({
  asset: import.meta.env.VITE_SHROUDLY_ASSET_CONTRACT_ID ?? "unassigned",
  randomness: import.meta.env.VITE_SHROUDLY_RANDOMNESS_CONTRACT_ID ?? "unassigned",
  yield: import.meta.env.VITE_SHROUDLY_YIELD_CONTRACT_ID ?? "unassigned",
  pool: import.meta.env.VITE_SHROUDLY_POOL_CONTRACT_ID ?? "unassigned",
});

export function browserChainEndpoint(name: string, value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return value; }
  if (/(^|\.)blockfrost\.io$/i.test(parsed.hostname) || parsed.searchParams.has("project_id")) {
    throw new Error(`${name} must be a Chain Data Proxy route, never a Blockfrost URL or project_id`);
  }
  return value;
}

export const MIDNIGHT_NETWORK_CONFIG = Object.freeze({
  environment: SHROUDLY_ENVIRONMENT,
  network: SHROUDLY_NETWORK_ID,
  deploymentId: import.meta.env.VITE_SHROUDLY_DEPLOYMENT_ID ?? "shroudly-preprod-unassigned",
  contractIds: MIDNIGHT_CONTRACT_IDS,
  // Chain Data Proxy routes. The provider token stays on the proxy, so these
  // must never be Blockfrost URLs or carry a project_id. The reserved .invalid
  // defaults keep module load valid while failing closed until deployed.
  rpcUrl: browserChainEndpoint("VITE_SHROUDLY_RPC_URL", import.meta.env.VITE_SHROUDLY_RPC_URL ?? "https://chain-data-proxy.invalid/rpc"),
  indexerGraphqlUrl: browserChainEndpoint("VITE_SHROUDLY_INDEXER_URL", import.meta.env.VITE_SHROUDLY_INDEXER_URL ?? "https://chain-data-proxy.invalid/indexer"),
  // After connect, participant reads use the wallet's getConfiguration()
  // endpoints and fall back to the proxy only when those fail or are not HTTPS.
  participantReads: "wallet-configuration-first" as const,
  zkConfigUrl: import.meta.env.VITE_SHROUDLY_ZK_CONFIG_URL ?? "",
  sponsorUrl: import.meta.env.VITE_SHROUDLY_SPONSOR_URL ?? "",
  proofMode: "local" as const,
  allowRemoteProof: false as const,
  mainnetTransactionsEnabled: false as const,
});

export const MIDNIGHT_VERSION_PROFILE = Object.freeze({
  compactCli: "0.5.2",
  compactLanguage: "0.23.0",
  compactCompiler: "0.31.1",
  compactRuntime: "0.16.0",
  midnightJs: "4.1.1",
  dappConnector: "4.0.1",
  walletSdk: "1.2.0",
  node: "1.0.400",
  indexer: "4.3.302",
  proofServer: "8.1.3",
  onchainRuntime: "3.0.0",
  ledgerTarget: "ledger-8.0.2",
});

// This is deliberately null until the human qualification run has been
// performed by the approved verifier. A local build must never manufacture a
// qualification identity that could be mistaken for release evidence.
export const MIDNIGHT_QUALIFICATION_VERIFIER_FINGERPRINT: string | null = null;

export const MIDNIGHT_PROVIDER_STATUS = [
  ["Private state", "Encrypted locally with Recovery Kit"],
  ["Proofs", "Wallet-bound proving (release binding required)"],
  ["Public data", "Wallet-supplied indexer, Chain Data Proxy fallback, plus fresh ledger confirmation"],
  ["DUST", "Explicit sponsorship approval"],
] as const;

export const PREPROD_DISCLOSURES = Object.freeze({
  identity: "Shroudly Preprod / mainnet-test-build",
  trust: "Preprod is valueless test infrastructure and is not a Mainnet trust claim.",
  deployer: "Temporary deployer authority expires after 24 hours; submissions lock if removal is late.",
  governance: "Preprod governance and emergency actions require two of three authorities.",
  cohort: "Disclosure Cohort: five participating wallets are required before a draw can settle.",
  yield: "Simulated Yield: at most 100 tMIX per completed 15-minute draw.",
  token: "tMIX has six-decimal integer accounting and no monetary value.",
});

export const EMPTY_MIGRATION_TIMELINE = createMigrationTimeline({ id: "unconnected-account", network: SHROUDLY_NETWORK_ID, account: "unconnected" });

export { PROGRAM_CONSTANTS, MAINNET_INTERFACE };
