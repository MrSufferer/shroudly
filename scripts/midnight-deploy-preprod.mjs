#!/usr/bin/env node

/**
 * Stage 4 deployment runner.
 *
 * The orchestration in this file owns the safety gates, ordering, resume
 * semantics, receipt, and public environment output. Provider construction is
 * deliberately injectable so that the production seam can be exercised
 * without credentials while the submit path still fails closed when a
 * protected provider is unavailable.
 */

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_NAMES = ["TmixAsset", "RandomnessThreshold", "YieldAdapter", "PrizePool"];
const CONTRACT_KEYS = ["asset", "randomness", "yield", "pool"];
const SOURCE_BY_KEY = Object.fromEntries(SOURCE_NAMES.map((name, index) => [CONTRACT_KEYS[index], name]));
const MANAGED_BY_KEY = {
  asset: "tmix-asset",
  randomness: "randomness-threshold",
  yield: "yield-adapter",
  pool: "prize-pool",
};
const DEFAULT_RECEIPT = join(ROOT, "evidence/preprod-stage4.json");
const PREPROD = "preprod";
const PROFILE_NAME = "shroudly-midnight-preprod-v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const CHECK_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT_MS = 10_000;
const PINNED = {
  midnightJs: "4.1.1",
  walletSdk: "1.2.0",
  compactRuntime: "0.16.0",
  compactCli: "0.5.2",
  compactCompiler: "0.31.1",
  compactLanguage: "0.23.0",
  proofServer: "8.1.3",
  network: PREPROD,
};
const PUBLIC_ENV = {
  deploymentId: "VITE_SHROUDLY_DEPLOYMENT_ID",
  asset: "VITE_SHROUDLY_ASSET_CONTRACT_ID",
  randomness: "VITE_SHROUDLY_RANDOMNESS_CONTRACT_ID",
  yield: "VITE_SHROUDLY_YIELD_CONTRACT_ID",
  pool: "VITE_SHROUDLY_POOL_CONTRACT_ID",
  assetHash: "VITE_SHROUDLY_ASSET_ARTIFACT_HASH",
  randomnessHash: "VITE_SHROUDLY_RANDOMNESS_ARTIFACT_HASH",
  yieldHash: "VITE_SHROUDLY_YIELD_ARTIFACT_HASH",
  poolHash: "VITE_SHROUDLY_POOL_ARTIFACT_HASH",
};
const REDACTIONS = new Set();
let consoleRedacted = false;

export function redactSecrets(text) {
  let result = String(text);
  for (const secret of REDACTIONS) result = result.split(secret).join("[redacted]");
  return result;
}

// Libraries such as the polkadot WsProvider log failing URLs, which carry the
// provider token as a query parameter. Once a token exists, every console
// line passes through the same redaction as the fatal-error path.
function redactConsole() {
  if (consoleRedacted) return;
  consoleRedacted = true;
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const write = console[level].bind(console);
    console[level] = (...args) => write(...args.map((arg) => redactSecrets(
      typeof arg === "string" ? arg : arg instanceof Error ? arg.stack ?? arg.message : inspect(arg),
    )));
  }
}
const AUTHORITY_NAMES = {
  assetLocal: "shroudly-preprod-authority-asset-local",
  assetReserve: "shroudly-preprod-authority-asset-reserve",
  assetAutomation: "shroudly-preprod-authority-asset-automation",
  assetParticipant: "shroudly-preprod-authority-asset-participant",
  randomnessRender: "shroudly-preprod-authority-randomness-render",
  randomnessGithubActions: "shroudly-preprod-authority-randomness-github-actions",
  randomnessOfflineMaintainer: "shroudly-preprod-authority-randomness-offline-maintainer",
  yieldOperator: "shroudly-preprod-authority-yield-operator",
  yieldGovernance: "shroudly-preprod-authority-yield-governance",
  poolDeployer: "shroudly-preprod-authority-pool-deployer",
  poolGovernanceOne: "shroudly-preprod-authority-pool-governance-one",
  poolGovernanceTwo: "shroudly-preprod-authority-pool-governance-two",
  poolGovernanceThree: "shroudly-preprod-authority-pool-governance-three",
};
const WITNESS_NAMES = {
  asset: [
    "local_secret_key",
    "reserve_secret",
    "automation_secret",
    "participant_secret",
    "participant_public_key",
    "automation_public_key",
  ],
  randomness: ["render_secret", "github_actions_secret", "offline_maintainer_secret"],
  yield: ["operator_secret", "governance_secret"],
  pool: [
    "deployer_secret",
    "governance_one_secret",
    "governance_two_secret",
    "governance_three_secret",
    "participant_secret",
    "participant_salt",
    "participant_public_key",
    "participant_coin",
    "participant_spendable_coin",
    "reserve_coin",
    "selection_bits",
  ],
};

// A generated contract must receive every witness function in its constructor,
// but a deployment process should only be able to exercise the authority it
// explicitly needs.  Keep participant and spend witnesses fail-closed unless a
// caller opts into them for a separately reviewed operation.
const DEFAULT_ALLOWED_WITNESSES = {
  asset: new Set(["local_secret_key", "reserve_secret", "automation_secret", "automation_public_key"]),
  randomness: new Set(["render_secret", "github_actions_secret", "offline_maintainer_secret"]),
  yield: new Set(["operator_secret", "governance_secret"]),
  pool: new Set(["deployer_secret", "governance_one_secret", "governance_two_secret", "governance_three_secret"]),
};

export function parseArgs(argv) {
  const args = { submit: false, resume: false, validate: false, receipt: DEFAULT_RECEIPT };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--submit") args.submit = true;
    else if (value === "--resume") args.resume = true;
    else if (value === "--validate") args.validate = true;
    else if (value === "--check") args.check = true;
    else if (value === "--receipt") {
      const next = argv[++index];
      if (!next) throw new Error("--receipt requires a path");
      args.receipt = resolve(ROOT, next);
    } else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`unknown option ${value}`);
  }
  if (args.resume && !args.submit && !args.validate) throw new Error("--resume requires --submit");
  if (args.check && (args.submit || args.resume || args.validate)) {
    throw new Error("--check cannot be combined with --submit, --resume, or --validate");
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function artifactManifest(root = ROOT) {
  const artifacts = {};
  for (const key of CONTRACT_KEYS) {
    const source = join(root, "midnight", `${SOURCE_BY_KEY[key]}.compact`);
    if (!existsSync(source)) throw new Error(`missing Compact source for ${SOURCE_BY_KEY[key]}`);
    artifacts[key] = `0x${sha256(readFileSync(source))}`;
  }
  const bundleInput = CONTRACT_KEYS.map((key) => `${SOURCE_BY_KEY[key]}:${artifacts[key]}`).join("\n");
  return { artifacts, bundleHash: `0x${sha256(bundleInput)}` };
}

export function immutableDeploymentId(now = new Date(), bundleHash = "") {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `shroudly-preprod-${stamp}-${bundleHash.replace(/^0x/, "").slice(0, 8)}`;
}

function loadProfile(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "midnight/version-profile.json"), "utf8"));
}

export function assertPreprodProfile(profile, installed = {}) {
  if (profile?.profile !== PROFILE_NAME) throw new Error(`wrong Compatibility Profile: ${profile?.profile}`);
  const profileNetwork = typeof profile.network === "string" ? profile.network : profile.network?.name;
  if (profileNetwork !== PREPROD) throw new Error("deployment network is not Midnight Preprod");
  for (const [key, expected] of Object.entries(PINNED)) {
    const actual = key === "network"
      ? profileNetwork
      : profile[key];
    if (actual !== expected) throw new Error(`profile pin ${key} is ${actual ?? "missing"}; expected ${expected}`);
    const installedValue = key === "network"
      ? (typeof installed.network === "string" ? installed.network : installed.network?.name)
      : installed[key];
    if (installedValue !== undefined && installedValue !== expected) {
      throw new Error(`installed pin ${key} is ${installedValue}; expected ${expected}`);
    }
  }
  if (installed.profile && installed.profile !== PROFILE_NAME) throw new Error("installed profile does not match Preprod profile");
  const installedNetwork = typeof installed.network === "string" ? installed.network : installed.network?.name;
  if (installedNetwork && installedNetwork !== PREPROD) throw new Error("installed network is not Preprod");
  return true;
}

/**
 * Read the versions this checkout actually declares for the pinned runtime.
 * Missing package entries are left undefined so fixture roots and source-only
 * callers can still validate the compatibility profile without pretending to
 * have an installed package manifest.
 */
function installedPackageProfile(root = ROOT) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return {};
  const packageJson = readJson(packagePath);
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  return {
    midnightJs: dependencies["@midnight-ntwrk/midnight-js-contracts"],
    walletSdk: dependencies["@midnight-ntwrk/wallet-sdk"],
    compactRuntime: dependencies["@midnight-ntwrk/compact-runtime"],
  };
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function validHash(value) {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

function validId(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !/^(unassigned|pending|null|undefined)$/i.test(value.trim());
}

function validTx(tx) {
  const value = asObject(tx);
  return validId(value.id ?? value.txId)
    && value.status === "SucceedEntirely"
    && validHash(value.txHash)
    && validHash(value.blockHash)
    && Number.isSafeInteger(value.blockHeight)
    && value.blockHeight >= 0
    && Number.isFinite(value.blockTimestamp)
    && value.blockTimestamp >= 0;
}

function timestampToIso(value) {
  const numeric = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1_000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function publicResultCandidate(result) {
  const value = asObject(result);
  return [
    value.public,
    value.finalized?.public,
    value.finalized,
    value,
  ].find((candidate) => {
    const item = asObject(candidate);
    return validId(item.txId ?? item.id)
      || validId(item.transactionId);
  });
}

/**
 * Extract only finalized public evidence from Midnight.js results. In
 * particular, never spread a result because the same object may contain the
 * private transcript, unproven transaction, or next private state.
 */
export function normalizeFinalizedResult(result, { kind = "transaction" } = {}) {
  const candidate = publicResultCandidate(result);
  if (!candidate) throw new Error(`${kind} returned no public transaction evidence`);
  const value = asObject(candidate);
  const id = value.txId ?? value.id ?? value.transactionId;
  if (!validId(id)) throw new Error(`${kind} returned no transaction identifier`);
  if (value.status !== "SucceedEntirely") {
    throw new Error(`${kind} did not finalize successfully (status ${value.status ?? "missing"})`);
  }
  const txHash = value.txHash ?? value.transactionHash ?? value.hash;
  const blockHash = value.blockHash ?? value.block?.hash;
  if (!validHash(txHash) || !validHash(blockHash)) {
    throw new Error(`${kind} finalized evidence is missing transaction or block hash`);
  }
  const blockHeight = Number(value.blockHeight ?? value.block?.height);
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) {
    throw new Error(`${kind} finalized evidence is missing block height`);
  }
  const blockTimestamp = Number(value.blockTimestamp ?? value.block?.timestamp);
  if (!Number.isFinite(blockTimestamp) || blockTimestamp < 0) {
    throw new Error(`${kind} finalized evidence is missing block timestamp`);
  }
  const normalized = {
    id: String(id),
    txId: String(id),
    status: "SucceedEntirely",
    txHash,
    blockHash,
    blockHeight,
    blockTimestamp,
    finalizedAt: timestampToIso(blockTimestamp) ?? new Date().toISOString(),
  };
  for (const key of ["identifiers", "indexerId", "protocolVersion", "blockAuthor"]) {
    if (value[key] !== undefined && (key !== "identifiers" || Array.isArray(value[key]))) {
      normalized[key] = key === "identifiers" ? value[key].map(String) : value[key];
    }
  }
  return normalized;
}

const PROHIBITED_KEYS = /^(?:private|secret|secrets|seed|walletseed|authorities|signingkey|witness|witnesses|unproven|calltxdata)$/i;

function containsProhibitedMaterial(value, parentKey = "") {
  if (!value || typeof value !== "object") return false;
  if (PROHIBITED_KEYS.test(parentKey)) return true;
  if (Array.isArray(value)) return value.some((item) => containsProhibitedMaterial(item, parentKey));
  return Object.entries(value).some(([key, child]) => containsProhibitedMaterial(child, key));
}

export function validateReceipt(
  receipt,
  { profile = loadProfile(), artifacts = artifactManifest().artifacts, bundleHash } = {},
) {
  if (!receipt || typeof receipt !== "object") throw new Error("Stage 4 receipt is not an object");
  if (receipt.format !== 2) throw new Error("unsupported Stage 4 receipt format");
  if (receipt.status !== "finalized") throw new Error("Stage 4 receipt is not finalized");
  if (!/^shroudly-preprod-\d{8}T\d{6}Z-[0-9a-f]{8}$/i.test(receipt.deploymentId ?? "")) {
    throw new Error("invalid immutable deployment ID");
  }
  assertPreprodProfile(profile, receipt.compatibility);
  if (receipt.network !== PREPROD) throw new Error("receipt network is not Preprod");
  if (!validId(receipt.sourceRevision) || receipt.sourceRevision === "uncommitted") {
    throw new Error("receipt source revision is missing");
  }
  if (receipt.sourceDirty !== false) throw new Error("receipt was created from a dirty deployment source");
  if (!validHash(receipt.artifactBundleHash)
      || (bundleHash && receipt.artifactBundleHash.toLowerCase() !== bundleHash.toLowerCase())) {
    throw new Error("receipt artifact bundle hash is invalid or mismatched");
  }
  if (!Array.isArray(receipt.transactions) || receipt.transactions.length < 6) {
    throw new Error("receipt transactions are not genuine finalized public evidence");
  }
  receiptTransactions(receipt, { complete: true });
  for (const key of CONTRACT_KEYS) {
    if (!validHash(receipt.artifactHashes?.[key])) throw new Error(`receipt artifact hash missing for ${key}`);
    if (artifacts[key] && receipt.artifactHashes[key].toLowerCase() !== artifacts[key].toLowerCase()) {
      throw new Error(`artifact hash mismatch for ${key}`);
    }
    if (!validId(receipt.contracts?.[key]?.id)) throw new Error(`contract ID missing for ${key}`);
    if (!validTx(receipt.contracts[key].deployment)) {
      throw new Error(`deployment transaction is not fully verified for ${key}`);
    }
    if (!matchingReceiptTransaction(receipt, receipt.contracts[key].deployment, "deploy", key)) {
      throw new Error(`deployment transaction evidence is not recorded for ${key}`);
    }
  }
  const dependencies = receipt.contracts.pool.dependencies;
  if (dependencies?.asset !== receipt.contracts.asset.id
      || dependencies?.randomness !== receipt.contracts.randomness.id
      || dependencies?.yield !== receipt.contracts.yield.id) {
    throw new Error("PrizePool dependency pins do not match deployed IDs");
  }
  if (!validHash(dependencies?.assetTokenColor)) {
    throw new Error("PrizePool asset token color is missing or invalid");
  }
  if (!validTx(receipt.reserveSeed?.transaction) || receipt.reserveSeed?.ledger?.reserveSeeded !== true) {
    throw new Error("reserve seed is not fully verified");
  }
  if (!matchingReceiptTransaction(receipt, receipt.reserveSeed.transaction, "seed-reserve", "asset")) {
    throw new Error("reserve seed transaction evidence is not recorded");
  }
  if (!validTx(receipt.automationFixture?.transaction) || receipt.automationFixture?.ledger?.automationIssued !== true) {
    throw new Error("evidence fixture is not fully verified");
  }
  if (!matchingReceiptTransaction(receipt, receipt.automationFixture.transaction, "evidence-fixture", "asset")) {
    throw new Error("evidence fixture transaction evidence is not recorded");
  }
  if (receipt.verification?.reserveSeeded !== true || receipt.verification?.automationIssued !== true) {
    throw new Error("receipt verification flags are incomplete");
  }
  if (containsProhibitedMaterial(receipt)) throw new Error("receipt contains prohibited private material");
  return true;
}

function receiptTransactions(receipt, { complete = false } = {}) {
  if (!Array.isArray(receipt?.transactions)) throw new Error("receipt transactions are not an array");
  if (complete && receipt.transactions.length !== 6) {
    throw new Error("receipt must contain exactly six Stage 4 transactions");
  }
  if (receipt.transactions.length > 6) throw new Error("receipt contains too many Stage 4 transactions");
  const ids = new Set();
  const hashes = new Set();
  const kinds = new Set();
  for (const transaction of receipt.transactions) {
    if (!validTx(transaction)) throw new Error("receipt transactions are not genuine finalized public evidence");
    const id = String(transaction.id ?? transaction.txId);
    const txHash = transaction.txHash.toLowerCase();
    if (ids.has(id) || hashes.has(txHash)) throw new Error("receipt contains duplicate transaction evidence");
    ids.add(id);
    hashes.add(txHash);
    if (transaction.kind === "deploy") {
      if (!CONTRACT_KEYS.includes(transaction.contract)) throw new Error("receipt has an invalid deployment transaction kind");
      const key = `deploy:${transaction.contract}`;
      if (kinds.has(key)) throw new Error(`receipt contains duplicate deployment evidence for ${transaction.contract}`);
      kinds.add(key);
    } else if (transaction.kind === "seed-reserve") {
      if (transaction.contract !== "asset" || transaction.circuit !== "seedPrizeReserve") {
        throw new Error("receipt has an invalid reserve seed transaction kind");
      }
      if (kinds.has(transaction.kind)) throw new Error("receipt contains duplicate reserve seed evidence");
      kinds.add(transaction.kind);
    } else if (transaction.kind === "evidence-fixture") {
      if (transaction.contract !== "asset" || transaction.circuit !== "allocateAutomation") {
        throw new Error("receipt has an invalid automation allocation transaction kind");
      }
      if (kinds.has(transaction.kind)) throw new Error("receipt contains duplicate automation evidence");
      kinds.add(transaction.kind);
    } else {
      throw new Error("receipt has an unknown transaction evidence kind");
    }
  }
  if (complete) {
    for (const key of CONTRACT_KEYS) {
      if (!kinds.has(`deploy:${key}`)) throw new Error(`receipt deployment evidence is missing for ${key}`);
    }
    if (!kinds.has("seed-reserve") || !kinds.has("evidence-fixture")) {
      throw new Error("receipt post-deployment evidence is incomplete");
    }
  }
  return { ids, hashes, kinds };
}

function matchingReceiptTransaction(receipt, evidence, kind, contract) {
  const id = String(evidence?.id ?? evidence?.txId ?? "");
  return receipt.transactions.find((transaction) =>
    transaction.kind === kind
      && (!contract || transaction.contract === contract)
      && String(transaction.id ?? transaction.txId) === id);
}

/**
 * Validate a resumable receipt before opening credentials or providers.  A
 * partial receipt is expected while a submit run is interrupted, but every
 * piece of evidence already written must still be genuine, unique, and tied
 * to the immutable source/artifact set.
 */
export function validateInProgressReceipt(
  receipt,
  {
    profile = loadProfile(),
    artifacts = artifactManifest().artifacts,
    bundleHash,
    revision,
  } = {},
) {
  if (!receipt || typeof receipt !== "object") throw new Error("in-progress Stage 4 receipt is not an object");
  if (receipt.format !== 2) throw new Error("in-progress receipt is not Stage 4 format 2");
  if (receipt.status !== "in-progress") throw new Error("Stage 4 receipt is not resumable");
  if (!/^shroudly-preprod-\d{8}T\d{6}Z-[0-9a-f]{8}$/i.test(receipt.deploymentId ?? "")) {
    throw new Error("invalid immutable deployment ID in in-progress receipt");
  }
  assertPreprodProfile(profile, receipt.compatibility);
  if (receipt.network !== PREPROD) throw new Error("in-progress receipt network is not Preprod");
  if (!validId(receipt.sourceRevision) || receipt.sourceRevision === "uncommitted") {
    throw new Error("in-progress receipt source revision is missing");
  }
  if (receipt.sourceDirty !== false) throw new Error("in-progress receipt was created from a dirty deployment source");
  if (revision) {
    if (revision.dirty) throw new Error("deployment source became dirty while resuming");
    if (receipt.sourceRevision !== revision.revision) throw new Error("in-progress receipt source revision does not match the clean deployment source");
  }
  if (!validHash(receipt.artifactBundleHash)
      || (bundleHash && receipt.artifactBundleHash.toLowerCase() !== bundleHash.toLowerCase())) {
    throw new Error("in-progress receipt artifact bundle hash is invalid or mismatched");
  }
  for (const key of CONTRACT_KEYS) {
    if (!validHash(receipt.artifactHashes?.[key])) throw new Error(`in-progress receipt artifact hash missing for ${key}`);
    if (artifacts[key] && receipt.artifactHashes[key].toLowerCase() !== artifacts[key].toLowerCase()) {
      throw new Error(`in-progress receipt artifact hash mismatch for ${key}`);
    }
  }
  const transactionIndex = receiptTransactions(receipt);
  if (containsProhibitedMaterial(receipt)) throw new Error("in-progress receipt contains prohibited private material");

  const contracts = asObject(receipt.contracts);
  for (const key of Object.keys(contracts)) {
    if (!CONTRACT_KEYS.includes(key)) throw new Error(`in-progress receipt has an unknown contract ${key}`);
    const entry = contracts[key];
    if (!validId(entry?.id) || !validTx(entry.deployment)) {
      throw new Error(`in-progress receipt contract evidence is incomplete for ${key}`);
    }
    const deploymentId = String(entry.deployment.id ?? entry.deployment.txId);
    const deploymentTransaction = matchingReceiptTransaction(receipt, entry.deployment, "deploy", key);
    if (!deploymentTransaction || !transactionIndex.ids.has(deploymentId)) {
      throw new Error(`in-progress receipt deployment evidence is not recorded for ${key}`);
    }
    if (key === "pool") {
      const dependencies = entry.dependencies;
      if (dependencies?.asset !== contracts.asset?.id
          || dependencies?.randomness !== contracts.randomness?.id
          || dependencies?.yield !== contracts.yield?.id
          || !validHash(dependencies?.assetTokenColor)) {
        throw new Error("in-progress PrizePool dependency pins are invalid");
      }
    } else if (entry.dependencies !== undefined) {
      throw new Error(`in-progress receipt has unexpected dependencies for ${key}`);
    }
  }
  for (const [name, kind, contract, circuit, ledgerField] of [
    ["reserveSeed", "seed-reserve", "asset", "seedPrizeReserve", "reserveSeeded"],
    ["automationFixture", "evidence-fixture", "asset", "allocateAutomation", "automationIssued"],
  ]) {
    const evidence = receipt[name];
    if (evidence === undefined) continue;
    if (!validTx(evidence.transaction) || evidence.ledger?.[ledgerField] !== true) {
      throw new Error(`in-progress ${name} evidence is incomplete`);
    }
    if (!matchingReceiptTransaction(receipt, evidence.transaction, kind, contract)) {
      throw new Error(`in-progress ${name} transaction is not recorded`);
    }
    if (evidence.transaction.circuit !== undefined && evidence.transaction.circuit !== circuit) {
      throw new Error(`in-progress ${name} circuit evidence is invalid`);
    }
  }
  if (receipt.verification !== undefined) {
    if (typeof receipt.verification !== "object"
        || receipt.verification.reserveSeeded !== (receipt.reserveSeed !== undefined)
        || receipt.verification.automationIssued !== (receipt.automationFixture !== undefined)) {
      throw new Error("in-progress receipt verification flags do not match evidence");
    }
  }
  return true;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function upsertPublicEnv(path, values) {
  let lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
  for (const [key, value] of Object.entries(values)) {
    lines = lines.filter((line) => !line.startsWith(`${key}=`));
    lines.push(`${key}=${value}`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o600, flag: "w" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function keychainCommand(args, securityPath = "/usr/bin/security") {
  if (process.platform !== "darwin" || !existsSync(securityPath)) {
    throw new Error("macOS Keychain is unavailable; refusing to handle deployment authority material");
  }
  return spawnSync(securityPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function keychainSecret(
  name,
  {
    account = "shroudly-preprod",
    servicePrefix = "com.shroudly.preprod.authority.",
    create = false,
    securityPath = "/usr/bin/security",
  } = {},
) {
  if (create) throw new Error("implicit Keychain secret creation is disabled; provision the entry out of band");
  const service = `${servicePrefix}${name}`;
  const result = keychainCommand(["find-generic-password", "-a", account, "-s", service, "-w"], securityPath);
  if (result.status !== 0) throw new Error(`protected deployer Keychain entry ${name} is missing`);
  const secret = result.stdout.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error(`Keychain entry ${name} is not a 32-byte secret`);
  REDACTIONS.add(secret.toLowerCase());
  return secret.toLowerCase();
}

export function keychainValue(
  name,
  {
    account = "shroudly-preprod",
    servicePrefix = "com.shroudly.preprod.private-state.",
    securityPath = "/usr/bin/security",
  } = {},
) {
  const result = keychainCommand([
    "find-generic-password",
    "-a",
    account,
    "-s",
    `${servicePrefix}${name}`,
    "-w",
  ], securityPath);
  if (result.status !== 0) throw new Error(`protected Keychain entry ${name} is missing`);
  const value = result.stdout.trim();
  if (!value) throw new Error(`protected Keychain entry ${name} is empty`);
  REDACTIONS.add(value);
  return value;
}

/**
 * Attach the operator chain data provider token to a Blockfrost URL. Call
 * this after any WebSocket URL is derived so the token never lands in a
 * derived path, and only for the operator account: the public account belongs
 * to the Chain Data Proxy. Non-Blockfrost URLs (local nodes, test servers)
 * pass through unchanged.
 */
export function withProviderToken(url, env = process.env, { reader = keychainCommand } = {}) {
  if (!url) return url;
  const parsed = new URL(url);
  if (!/(^|\.)blockfrost\.io$/i.test(parsed.hostname)) return url;
  const service = env.MIDNIGHT_BLOCKFROST_SECRET_NAME;
  const account = env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod";
  if (!service) throw new Error("MIDNIGHT_BLOCKFROST_SECRET_NAME must name the operator Blockfrost Keychain entry");
  const result = reader(["find-generic-password", "-a", account, "-s", service, "-w"]);
  const token = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,512}$/.test(token)) throw new Error("operator Blockfrost Keychain entry is missing or malformed");
  REDACTIONS.add(token);
  redactConsole();
  parsed.searchParams.set("project_id", token);
  return parsed.toString();
}

export function getAuthorities(env = process.env) {
  const account = env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod";
  const prefix = env.MIDNIGHT_AUTHORITY_SERVICE_PREFIX || "com.shroudly.preprod.authority.";
  const deployerName = env.MIDNIGHT_DEPLOYER_SECRET_NAME || "shroudly-preprod-deployer";
  const deployer = keychainSecret(deployerName, {
    account,
    servicePrefix: env.MIDNIGHT_WALLET_SERVICE_PREFIX || "com.shroudly.preprod.wallet.",
  });
  const authorities = {};
  for (const [key, name] of Object.entries(AUTHORITY_NAMES)) {
    authorities[key] = keychainSecret(name, { account, servicePrefix: prefix });
  }
  return { deployer, authorities };
}

export function sourceRevision(
  root = ROOT,
  { git = spawnSync } = {},
) {
  const revision = git("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (revision.status !== 0) throw new Error("could not determine source revision");
  const sourcePaths = SOURCE_NAMES.map((name) => `midnight/${name}.compact`);
  const status = git(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths],
    { cwd: root, encoding: "utf8" },
  );
  if (status.status !== 0) throw new Error("could not inspect deployment source status");
  const changes = (status.stdout || "").split(/\r?\n/).filter(Boolean);
  return { revision: revision.stdout.trim(), dirty: changes.length > 0, changes };
}

function runPreflight(root = ROOT) {
  for (const command of [["pnpm", ["midnight:compile:keys"]], ["pnpm", ["midnight:profile"]]]) {
    const result = spawnSync(command[0], command[1], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) throw new Error(`${command[1].join(" ")} preflight failed`);
  }
  return readJson(join(root, "midnight/version-profile.json"));
}

function bytesFromId(id) {
  const clean = String(id).replace(/^0x/i, "");
  if (/^[0-9a-f]{64}$/i.test(clean)) return Uint8Array.from(Buffer.from(clean, "hex"));
  return Uint8Array.from(Buffer.from(id, "utf8"));
}

function hexBytes(value) {
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : `0x${value}`;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `0x${Buffer.from(value).toString("hex")}`;
  }
  if (value && value.bytes instanceof Uint8Array) return hexBytes(value.bytes);
  return value;
}

function contractAddressId(value) {
  if (typeof value === "string") return value;
  if (value?.bytes instanceof Uint8Array || Buffer.isBuffer(value?.bytes)) {
    return hexBytes(value.bytes);
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return hexBytes(value);
  return value;
}

export async function withTimeout(promise, timeoutMs = DEFAULT_TIMEOUT_MS, label = "operation") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failClosedWitness(name) {
  return () => {
    throw new Error(`witness ${name} is not provisioned for this operation`);
  };
}

function witnessSecret(value, name) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value.replace(/^0x/i, ""))) {
    throw new Error(`witness secret ${name} is missing or invalid`);
  }
  return Uint8Array.from(Buffer.from(value.replace(/^0x/i, ""), "hex"));
}

function keyBytes(value) {
  if (value?.bytes instanceof Uint8Array) return value.bytes;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Uint8Array.from(value);
  if (typeof value === "string") {
    const clean = value.replace(/^0x/i, "");
    if (/^[0-9a-f]+$/i.test(clean) && clean.length % 2 === 0) {
      return Uint8Array.from(Buffer.from(clean, "hex"));
    }
    return bytesFromId(value);
  }
  return value;
}

function authorityValues(authorities = {}) {
  return authorities && typeof authorities === "object" && authorities.authorities
    ? authorities.authorities
    : authorities;
}

/**
 * Build the complete witness object required by a generated Compact Contract.
 * Every witness exists, but only explicitly supplied authorities can return
 * data; all other participant/fixture witnesses fail closed.
 */
export function createWitnessMap({
  key,
  authorities = {},
  privateState = {},
  automationWallet,
  allowedWitnesses,
} = {}) {
  const names = WITNESS_NAMES[key] || [];
  const witnessMap = Object.fromEntries(names.map((name) => [name, failClosedWitness(name)]));
  const allowed = allowedWitnesses === undefined
    ? (DEFAULT_ALLOWED_WITNESSES[key] || new Set())
    : new Set(allowedWitnesses);
  const configuredAuthorities = authorityValues(authorities);
  const authorityByWitness = {
    local_secret_key: configuredAuthorities.assetLocal,
    reserve_secret: configuredAuthorities.assetReserve,
    automation_secret: configuredAuthorities.assetAutomation,
    participant_secret: configuredAuthorities.assetParticipant,
    render_secret: configuredAuthorities.randomnessRender,
    github_actions_secret: configuredAuthorities.randomnessGithubActions,
    offline_maintainer_secret: configuredAuthorities.randomnessOfflineMaintainer,
    operator_secret: configuredAuthorities.yieldOperator,
    governance_secret: configuredAuthorities.yieldGovernance,
    deployer_secret: configuredAuthorities.poolDeployer,
    governance_one_secret: configuredAuthorities.poolGovernanceOne,
    governance_two_secret: configuredAuthorities.poolGovernanceTwo,
    governance_three_secret: configuredAuthorities.poolGovernanceThree,
  };
  for (const [name, value] of Object.entries(authorityByWitness)) {
    if (!names.includes(name) || !allowed.has(name) || value === undefined) continue;
    witnessMap[name] = (context) => [context?.privateState ?? privateState, witnessSecret(value, name)];
  }
  if (names.includes("automation_public_key") && allowed.has("automation_public_key")) {
    witnessMap.automation_public_key = (context) => {
      const publicKey = automationWallet?.coinPublicKey
        ?? (typeof automationWallet?.getCoinPublicKey === "function" ? automationWallet.getCoinPublicKey() : undefined);
      if (!publicKey) throw new Error("automation wallet coin public key is not provisioned");
      return [context?.privateState ?? privateState, { bytes: keyBytes(publicKey) }];
    };
  }
  return witnessMap;
}

export async function automationEncryptionMapping(automationWallet) {
  if (!automationWallet) throw new Error("isolated automation wallet is required for allocateAutomation");
  const coin = typeof automationWallet.getCoinPublicKey === "function"
    ? await automationWallet.getCoinPublicKey()
    : automationWallet.coinPublicKey;
  const encryption = typeof automationWallet.getEncryptionPublicKey === "function"
    ? await automationWallet.getEncryptionPublicKey()
    : automationWallet.encryptionPublicKey;
  if (!coin || !encryption) {
    throw new Error("automation wallet must provide both coin and encryption public keys");
  }
  return new Map([[coin, encryption]]);
}

export async function deriveWalletMaterial(seedHex) {
  const clean = String(seedHex).replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error("deployer seed must be a 32-byte hex value");
  const seed = Uint8Array.from(Buffer.from(clean, "hex"));
  const sdk = await import("@midnight-ntwrk/wallet-sdk");
  const ledger = await import("@midnight-ntwrk/ledger-v8");
  const zswapSecretKeys = sdk.ZswapSecretKeys?.fromSeed?.(seed) ?? ledger.ZswapSecretKeys.fromSeed(seed);
  const dustSecretKey = sdk.DustSecretKey?.fromSeed?.(seed) ?? ledger.DustSecretKey.fromSeed(seed);
  let hdKeys;
  if (sdk.HDWallet?.fromSeed) {
    const result = sdk.HDWallet.fromSeed(seed);
    if (result?.type === "seedOk") {
      const selected = result.hdWallet
        .selectAccount(0)
        .selectRoles([sdk.Roles.NightExternal, sdk.Roles.Dust])
        .deriveKeysAt(0);
      result.hdWallet.clear();
      if (selected?.type === "keysDerived") hdKeys = selected.keys;
    }
  }
  return {
    seed,
    zswapSecretKeys,
    dustSecretKey,
    coinPublicKey: zswapSecretKeys.coinPublicKey,
    encryptionPublicKey: zswapSecretKeys.encryptionPublicKey,
    hdKeys,
  };
}

function facadeWalletProvider(walletFacade, walletMaterial) {
  if (!walletFacade) return undefined;
  if (!walletMaterial?.zswapSecretKeys || !walletMaterial?.dustSecretKey) {
    throw new Error("wallet material is required to adapt WalletFacade to Midnight.js");
  }
  return {
    getCoinPublicKey: () => walletMaterial.coinPublicKey,
    getEncryptionPublicKey: () => walletMaterial.encryptionPublicKey,
    balanceTx: async (tx, ttl = new Date(Date.now() + 3_600_000)) => {
      const recipe = await walletFacade.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: walletMaterial.zswapSecretKeys,
          dustSecretKey: walletMaterial.dustSecretKey,
        },
        { ttl },
      );
      return walletFacade.finalizeRecipe(recipe);
    },
    synchronize: () => walletFacade.waitForSyncedState(),
    getBalances: async () => {
      const state = await walletFacade.waitForSyncedState();
      // FacadeState exposes balances through getters, so returning it directly
      // makes a generic balance walker miss the values and leaks wallet state
      // into callers.  Project only the public numeric budget needed by the
      // preflight gate.
      const dustBalance = typeof state?.dust?.balance === "function"
        ? state.dust.balance(new Date())
        : state?.dust?.balance;
      return {
        shieldedBalances: state?.shielded?.balances ?? {},
        unshieldedBalances: state?.unshielded?.balances ?? {},
        dustBalance,
        isSynced: state?.isSynced,
      };
    },
    close: () => (typeof walletFacade.stop === "function" ? walletFacade.stop() : undefined),
  };
}

function rootForAssembly(value, fallback) {
  return value ? (isAbsolute(value) ? resolve(value) : resolve(fallback, value)) : fallback;
}

function attachCompiled(fn, self, value) {
  try {
    return fn(self, value);
  } catch {
    return fn(value)(self);
  }
}

async function buildCompiledContracts({
  root = ROOT,
  authorities,
  privateState,
  automationWallet,
  allowedWitnesses,
  compiledContracts,
} = {}) {
  if (compiledContracts) return compiledContracts;
  const compact = await import("@midnight-ntwrk/midnight-js-protocol/compact-js");
  const result = {};
  for (const key of CONTRACT_KEYS) {
    const managedDirectory = join(root, "midnight/managed", MANAGED_BY_KEY[key]);
    const module = await import(pathToFileURL(join(managedDirectory, "contract/index.js")).href);
    const witnessMap = createWitnessMap({
      key,
      authorities: authorityValues(authorities),
      privateState,
      automationWallet,
      allowedWitnesses: allowedWitnesses?.[key],
    });
    let compiled = compact.CompiledContract.make(SOURCE_BY_KEY[key], module.Contract);
    compiled = attachCompiled(compact.CompiledContract.withWitnesses, compiled, witnessMap);
    compiled = attachCompiled(compact.CompiledContract.withCompiledFileAssets, compiled, managedDirectory);
    result[key] = { module, compiled, witnesses: witnessMap, managedDirectory };
  }
  return result;
}

/**
 * An explicit HTTP override wins over the profile's WebSocket URL, so a
 * local or alternate indexer never pairs with the Blockfrost stream.
 */
function indexerWsUrlFor(env, profileNetwork, httpUrl) {
  if (env.MIDNIGHT_INDEXER_WS_URL) return env.MIDNIGHT_INDEXER_WS_URL;
  if (env.MIDNIGHT_INDEXER_HTTP_URL) return deriveIndexerWs(env.MIDNIGHT_INDEXER_HTTP_URL);
  return profileNetwork.indexerWs || deriveIndexerWs(httpUrl);
}

function deriveIndexerWs(httpUrl) {
  if (!httpUrl) return undefined;
  return httpUrl
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:")
    .replace(/\/$/, "") + "/ws";
}

function providerSet({
  privateStateProvider,
  publicDataProvider,
  zkConfigProvider,
  proofProvider,
  walletProvider,
  midnightProvider,
}) {
  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

function extractBalanceValues(value) {
  const values = [];
  const visitNumeric = (item) => {
    if (typeof item === "bigint" || typeof item === "number" || typeof item === "string") {
      if (/^\d+$/.test(String(item))) values.push(BigInt(item));
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visitNumeric);
      return;
    }
    Object.values(item).forEach(visitNumeric);
  };
  const visit = (item) => {
    if (typeof item === "bigint" || typeof item === "number" || typeof item === "string") {
      if (/^\d+$/.test(String(item))) values.push(BigInt(item));
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (/balances?$/i.test(key)) visitNumeric(child);
      else if (/balance|available|amount|value|night|dust/i.test(key)) visit(child);
    }
  };
  visit(value);
  return values;
}

/**
 * Return the identifier that Midnight.js uses when waiting for a submitted
 * transaction.  A ledger transaction can contain more than one identifier
 * after merging, so use the first non-empty identifier and never substitute
 * the transaction hash (the SDK explicitly warns that hashes are not stable
 * watch keys for merged transactions).
 */
export function finalizedTransactionId(finalizedTx) {
  const identifiers = typeof finalizedTx?.identifiers === "function"
    ? finalizedTx.identifiers()
    : finalizedTx?.identifiers;
  if (!Array.isArray(identifiers)) {
    throw new Error("finalized transaction has no Midnight transaction identifiers");
  }
  const id = identifiers.find((value) => validId(value));
  if (!id) throw new Error("finalized transaction has no Midnight transaction identifier");
  return String(id);
}

async function createDefaultNodeProvider(env, resources, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // The pinned wallet-sdk barrel owns the node-client dependency in pnpm's
  // layout; importing through the barrel also keeps the SDK version aligned.
  const nodeModule = await import("@midnight-ntwrk/wallet-sdk/node-client");
  const rpcUrl = env.MIDNIGHT_RPC_URL || "wss://rpc.midnight-preprod.blockfrost.io";
  const node = await nodeModule.PolkadotNodeClient.init({ nodeURL: new URL(withProviderToken(rpcUrl, env)) });
  resources.push(node);
  return {
    submitTx: async (finalizedTx) => {
      // Capture the watch identifier before handing the private serialized
      // transaction to the node.  The node's Finalized event contains a
      // block/transaction hash but deliberately does not expose a Midnight
      // transaction ID, so returning the event hash here would make
      // midnight-js wait on an identifier that can never be found.
      const transactionId = finalizedTransactionId(finalizedTx);
      const serialized = typeof finalizedTx?.serialize === "function" ? finalizedTx.serialize() : finalizedTx;
      const submitted = await withTimeout(
        node.sendMidnightTransactionAndWait(serialized, "Finalized"),
        timeoutMs,
        "transaction submission",
      );
      if (submitted?._tag && submitted._tag !== "Finalized") {
        throw new Error(`transaction submission ended with ${submitted._tag}`);
      }
      return transactionId;
    },
  };
}

/**
 * Compose the pinned Midnight.js provider graph. Every dependency may be
 * injected for tests or a protected host; omitted dependencies are built from
 * the profile and protected Keychain entries.
 */
export async function createProtectedAssembly({
  root = ROOT,
  env = process.env,
  profile = loadProfile(root),
  manifest = artifactManifest(root),
  authorities = {},
  dependencies = {},
  providers = {},
  compiledContracts: suppliedCompiledContracts,
  walletProvider: suppliedWalletProvider,
  walletFacade: suppliedWalletFacade,
  walletFactory,
  walletMaterial: suppliedWalletMaterial,
  automationWallet: suppliedAutomationWallet,
  additionalCoinEncPublicKeyMappings,
  allowedWitnesses,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  readOnly = false,
} = {}) {
  assertPreprodProfile(profile);
  const mergedProviders = { ...(dependencies.providers || {}), ...providers };
  const resources = [];
  const privateStateDirectory = rootForAssembly(
    env.MIDNIGHT_PRIVATE_STATE_DB || ".midnight/preprod-private-state",
    root,
  );
  let publicDataProvider = mergedProviders.publicDataProvider;
  let privateStateProvider = mergedProviders.privateStateProvider;
  let midnightProvider = mergedProviders.midnightProvider;
  let walletProvider = suppliedWalletProvider
    || mergedProviders.walletProvider
    || dependencies.walletProvider;
  let walletFacade = suppliedWalletFacade || dependencies.walletFacade;
  let walletMaterial = suppliedWalletMaterial || dependencies.walletMaterial;
  const automationWallet = suppliedAutomationWallet
    || mergedProviders.automationWallet
    || dependencies.automationWallet;

  try {
    const track = (resource) => {
      if (resource && !resources.includes(resource)) resources.push(resource);
      return resource;
    };
    const networkModule = await import("@midnight-ntwrk/midnight-js-network-id");
    networkModule.setNetworkId(PREPROD);

    const profileNetwork = typeof profile.network === "object" ? profile.network : {};
    const indexerHttpUrl = env.MIDNIGHT_INDEXER_HTTP_URL || profileNetwork.indexerGraphql;
    const indexerWsUrl = indexerWsUrlFor(env, profileNetwork, indexerHttpUrl);
    if (!publicDataProvider) {
      const indexer = await import("@midnight-ntwrk/midnight-js-indexer-public-data-provider");
      // midnight-js 4.1.1 has no header option; Blockfrost reads project_id from the query.
      publicDataProvider = indexer.indexerPublicDataProvider(withProviderToken(indexerHttpUrl, env), withProviderToken(indexerWsUrl, env));
      track(publicDataProvider);
    }

    let automation = automationWallet;
    if (!automation && env.MIDNIGHT_AUTOMATION_WALLET_SECRET_NAME) {
      const automationSeed = keychainSecret(env.MIDNIGHT_AUTOMATION_WALLET_SECRET_NAME, {
        account: env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod",
        servicePrefix: env.MIDNIGHT_WALLET_SERVICE_PREFIX || "com.shroudly.preprod.wallet.",
      });
      automation = await deriveWalletMaterial(automationSeed);
    }

    if (!privateStateProvider) {
      if (readOnly) {
        throw new Error("private-state provider is unavailable in read-only mode");
      }
      mkdirSync(privateStateDirectory, { recursive: true, mode: 0o700 });
      chmodSync(privateStateDirectory, 0o700);
      const privateStateModule = await import("@midnight-ntwrk/midnight-js-level-private-state-provider");
      const password = keychainValue(
        env.MIDNIGHT_PRIVATE_STATE_PASSWORD_NAME || "shroudly-preprod-private-state-password",
        {
          account: env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod",
          servicePrefix: env.MIDNIGHT_PRIVATE_STATE_SERVICE_PREFIX || "com.shroudly.preprod.private-state.",
        },
      );
      privateStateProvider = privateStateModule.levelPrivateStateProvider({
        midnightDbName: privateStateDirectory,
        privateStateStoreName: "stage4-private-states",
        signingKeyStoreName: "stage4-signing-keys",
        privateStoragePasswordProvider: () => password,
        accountId: env.MIDNIGHT_ACCOUNT_ID || authorities.deployer || "stage4-deployer",
      });
      track(privateStateProvider);
    }

    if (!walletProvider && walletFacade) {
      walletProvider = facadeWalletProvider(walletFacade, walletMaterial);
    }
    if (!walletProvider && authorities.deployer) {
      walletMaterial ??= await deriveWalletMaterial(authorities.deployer);
      const createWallet = walletFactory || dependencies.walletFactory;
      if (createWallet) {
        walletProvider = await createWallet({
          walletMaterial,
          env,
          profile,
          publicDataProvider,
          privateStateProvider,
          timeoutMs,
        });
        walletFacade = walletProvider?.walletFacade || walletFacade;
      }
    }
    if (!walletProvider) {
      throw new Error("protected deployer wallet provider is unavailable; inject a WalletFacade/provider after provisioning the Keychain seed");
    }
    // Track injected and factory-created resources too.  A deployment must
    // never leave a wallet, indexer, or provider running when a later gate or
    // operation fails.  Facade-backed adapters own the facade's stop call;
    // otherwise track a standalone facade as well.
    track(walletProvider);
    if (walletFacade && typeof walletProvider.close !== "function") track(walletFacade);

    if (!midnightProvider) midnightProvider = await createDefaultNodeProvider(env, resources, timeoutMs);
    track(midnightProvider);

    const zkConfigProviders = {
      ...(dependencies.zkConfigProviders || {}),
      ...(mergedProviders.zkConfigProviders || {}),
    };
    let sharedZkConfigProvider = mergedProviders.zkConfigProvider || dependencies.zkConfigProvider;
    const compiled = await buildCompiledContracts({
      root,
      authorities,
      privateState: {},
      automationWallet: automation,
      allowedWitnesses,
      compiledContracts: suppliedCompiledContracts || dependencies.compiledContracts,
    });
    const providerByKey = {};
    for (const key of CONTRACT_KEYS) {
      let zkConfigProvider = zkConfigProviders[key] || sharedZkConfigProvider;
      if (!zkConfigProvider) {
        const zkModule = await import("@midnight-ntwrk/midnight-js-node-zk-config-provider");
        zkConfigProvider = new zkModule.NodeZkConfigProvider(compiled[key]?.managedDirectory || join(root, "midnight/managed", MANAGED_BY_KEY[key]));
        zkConfigProviders[key] = zkConfigProvider;
      }
      const proofByKey = (dependencies.proofProviders || mergedProviders.proofProviders || {})[key]
        || mergedProviders.proofProvider
        || dependencies.proofProvider;
      let proofProvider = proofByKey;
      if (!proofProvider) {
        const proofModule = await import("@midnight-ntwrk/midnight-js-http-client-proof-provider");
        proofProvider = proofModule.httpClientProofProvider(
          env.MIDNIGHT_PROOF_SERVER_URL || "http://127.0.0.1:6300",
          zkConfigProvider,
          { timeout: timeoutMs },
        );
      }
      track(zkConfigProvider);
      track(proofProvider);
      track(publicDataProvider);
      track(privateStateProvider);
      providerByKey[key] = providerSet({
        privateStateProvider,
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
      });
    }

    const automationMapping = additionalCoinEncPublicKeyMappings
      || dependencies.additionalCoinEncPublicKeyMappings
      || (automation ? await automationEncryptionMapping(automation) : undefined);

    const assembly = {
      profile,
      manifest,
      authorities,
      providers: providerByKey,
      publicDataProvider,
      privateStateProvider,
      walletProvider,
      midnightProvider,
      walletFacade,
      walletMaterial,
      automationWallet: automation,
      additionalCoinEncPublicKeyMappings: automationMapping,
      compiledContracts: compiled,
      contracts: {},
      tokenColor: undefined,
      timeoutMs,
      _resources: resources,
      _closed: false,
      async synchronize() {
        if (typeof walletProvider.synchronize === "function") {
          await withTimeout(walletProvider.synchronize(), timeoutMs, "wallet synchronization");
        } else if (walletFacade && typeof walletFacade.waitForSyncedState === "function") {
          await withTimeout(walletFacade.waitForSyncedState(), timeoutMs, "wallet synchronization");
        } else if (typeof dependencies.synchronize === "function") {
          await withTimeout(dependencies.synchronize(), timeoutMs, "wallet synchronization");
        } else {
          throw new Error("wallet synchronization is unavailable");
        }
      },
      async assertFunds(requirements = {}) {
        if (typeof dependencies.assertFunds === "function") {
          return dependencies.assertFunds(requirements);
        }
        if (typeof walletProvider.assertFunds === "function") {
          return walletProvider.assertFunds(requirements);
        }
        if (typeof walletProvider.getBalances !== "function") {
          throw new Error("wallet NIGHT/DUST balance inspection is unavailable");
        }
        const balances = await withTimeout(walletProvider.getBalances(), timeoutMs, "wallet balance query");
        const values = extractBalanceValues(balances);
        if (!values.some((value) => value > 0n)) {
          throw new Error("deployer wallet has insufficient NIGHT/DUST funds");
        }
        return balances;
      },
      async deploy({ key, name, constructorArgs = [], privateStateId = "stage4", initialPrivateState = {} } = {}) {
        if (typeof dependencies.deploy === "function") {
          return dependencies.deploy({ key, name, constructorArgs, privateStateId, initialPrivateState });
        }
        const contracts = await import("@midnight-ntwrk/midnight-js-contracts");
        const compiledContract = compiled[key]?.compiled;
        if (!compiledContract) throw new Error(`compiled contract ${key} is unavailable`);
        const deployed = await withTimeout(
          contracts.deployContract(providerByKey[key], {
            compiledContract,
            args: constructorArgs,
            privateStateId,
            initialPrivateState,
            additionalCoinEncPublicKeyMappings: automationMapping,
          }),
          timeoutMs,
          `${name} deployment`,
        );
        return {
          contractId: contractAddressId(deployed.address),
          public: deployed.deployTxData.public,
        };
      },
      async call({ contract, contractId, circuit, args = [], privateStateId = "stage4" } = {}) {
        if (typeof dependencies.call === "function") {
          return dependencies.call({ contract, contractId, circuit, args, privateStateId });
        }
        if (circuit === "allocateAutomation" && (!automationMapping || automationMapping.size === 0)) {
          throw new Error("allocateAutomation requires an isolated automation coin/encryption public-key mapping");
        }
        const contracts = await import("@midnight-ntwrk/midnight-js-contracts");
        const result = await withTimeout(
          contracts.submitCallTx(providerByKey[contract], {
            contractAddress: contractId,
            circuitId: circuit,
            args,
            privateStateId,
            additionalCoinEncPublicKeyMappings: automationMapping,
          }),
          timeoutMs,
          `${contract}.${circuit}`,
        );
        return { public: result.public };
      },
      async readLedger({ key, contract, contractId } = {}) {
        if (typeof dependencies.readLedger === "function") return dependencies.readLedger({ key, contract, contractId });
        const contracts = await import("@midnight-ntwrk/midnight-js-contracts");
        const contractKey = key || contract;
        const states = await withTimeout(
          contracts.getPublicStates(publicDataProvider, { bytes: bytesFromId(contractId) }),
          timeoutMs,
          `fresh ${contractKey} ledger read`,
        );
        const module = compiled[contractKey]?.module;
        if (!module?.ledger) throw new Error(`generated ledger decoder for ${contractKey} is unavailable`);
        const ledgerState = module.ledger(states.contractState);
        return ledgerState;
      },
      async deriveTokenColor({ contractId } = {}) {
        if (typeof dependencies.deriveTokenColor === "function") return dependencies.deriveTokenColor({ contractId });
        const ledger = await import("@midnight-ntwrk/ledger-v8");
        const domain = compiled.asset?.module?.pureCircuits?.tokenDomain?.();
        if (!(domain instanceof Uint8Array)) throw new Error("TmixAsset token domain is unavailable");
        const raw = ledger.rawTokenType(domain, String(contractId).replace(/^0x/i, ""));
        const color = bytesFromId(raw);
        if (color.length !== 32) throw new Error("derived tMIX token color is not 32 bytes");
        return color;
      },
      async reconcile(receipt) {
        if (typeof dependencies.reconcile === "function") return dependencies.reconcile(receipt);
        if (typeof publicDataProvider?.watchForTxData !== "function") {
          throw new Error("indexer transaction watcher is unavailable for resume reconciliation");
        }
        for (const transaction of receipt.transactions || []) {
          const evidence = await withTimeout(
            publicDataProvider.watchForTxData(transaction.id),
            timeoutMs,
            `reconcile transaction ${transaction.id}`,
          );
          const current = normalizeFinalizedResult(evidence, { kind: "resume reconciliation" });
          if (current.id !== transaction.id
              || current.txHash.toLowerCase() !== transaction.txHash.toLowerCase()
              || current.blockHash.toLowerCase() !== transaction.blockHash.toLowerCase()) {
            throw new Error(`resume reconciliation mismatch for transaction ${transaction.id}`);
          }
        }
        return true;
      },
      async close() {
        if (this._closed) return;
        this._closed = true;
        for (const resource of [...resources].reverse()) {
          try {
            if (typeof resource?.stop === "function") await withTimeout(resource.stop(), CLOSE_TIMEOUT_MS, "provider shutdown");
            else if (typeof resource?.close === "function") await withTimeout(resource.close(), CLOSE_TIMEOUT_MS, "provider shutdown");
            else if (typeof resource?.disconnect === "function") await withTimeout(resource.disconnect(), CLOSE_TIMEOUT_MS, "provider shutdown");
          } catch {
            // Cleanup is best effort; the original deployment error is more useful.
          }
        }
      },
    };
    return assembly;
  } catch (error) {
    for (const resource of [...resources].reverse()) {
      try {
        if (typeof resource?.stop === "function") await withTimeout(resource.stop(), CLOSE_TIMEOUT_MS, "provider shutdown");
        else if (typeof resource?.close === "function") await withTimeout(resource.close(), CLOSE_TIMEOUT_MS, "provider shutdown");
        else if (typeof resource?.disconnect === "function") await withTimeout(resource.disconnect(), CLOSE_TIMEOUT_MS, "provider shutdown");
      } catch {
        // Preserve the construction error.
      }
    }
    throw error;
  }
}

export function contractPlan(assembly, authorities) {
  return [
    {
      key: "asset",
      name: "TmixAsset",
      constructorArgs: [],
      authorities: {
        local_secret_key: authorities.assetLocal,
        reserve_secret: authorities.assetReserve,
        automation_secret: authorities.assetAutomation,
        participant_secret: authorities.assetParticipant,
      },
    },
    {
      key: "randomness",
      name: "RandomnessThreshold",
      constructorArgs: [],
      authorities: {
        render_secret: authorities.randomnessRender,
        github_actions_secret: authorities.randomnessGithubActions,
        offline_maintainer_secret: authorities.randomnessOfflineMaintainer,
      },
    },
    {
      key: "yield",
      name: "YieldAdapter",
      constructorArgs: [],
      authorities: {
        operator_secret: authorities.yieldOperator,
        governance_secret: authorities.yieldGovernance,
      },
    },
    {
      key: "pool",
      name: "PrizePool",
      constructorArgs: () => [
        bytesFromId(assembly.contracts.asset.id),
        assembly.tokenColor,
        bytesFromId(assembly.contracts.randomness.id),
        bytesFromId(assembly.contracts.yield.id),
      ],
      authorities: {
        deployer_secret: authorities.poolDeployer,
        governance_one_secret: authorities.poolGovernanceOne,
        governance_two_secret: authorities.poolGovernanceTwo,
        governance_three_secret: authorities.poolGovernanceThree,
      },
    },
  ];
}

function safeTransactionRecord(evidence, fields) {
  return { ...evidence, ...fields };
}

function newReceipt({ deploymentId, revision, manifest, now }) {
  return {
    format: 2,
    status: "in-progress",
    deploymentId,
    network: PREPROD,
    sourceRevision: revision.revision,
    sourceDirty: false,
    compatibility: {
      profile: PROFILE_NAME,
      network: PREPROD,
      midnightJs: PINNED.midnightJs,
      walletSdk: PINNED.walletSdk,
      compactRuntime: PINNED.compactRuntime,
      compactCli: PINNED.compactCli,
      compactCompiler: PINNED.compactCompiler,
      compactLanguage: PINNED.compactLanguage,
    },
    artifactBundleHash: manifest.bundleHash,
    artifactHashes: manifest.artifacts,
    contracts: {},
    transactions: [],
    verification: { reserveSeeded: false, automationIssued: false },
    generatedAt: now.toISOString(),
  };
}

async function closeAssemblyBestEffort(assembly) {
  if (!assembly || typeof assembly.close !== "function") return;
  try {
    await withTimeout(Promise.resolve().then(() => assembly.close()), CLOSE_TIMEOUT_MS, "provider shutdown");
  } catch {
    // Do not mask a failed deployment/check with a cleanup error.  The
    // assembly itself also attempts to close each owned provider in reverse
    // order, so this boundary is intentionally best effort.
  }
}

export async function runDeployment({
  root = ROOT,
  receiptPath = DEFAULT_RECEIPT,
  submit = false,
  resume = false,
  env = process.env,
  now = new Date(),
  assemblyFactory = createProtectedAssembly,
  authoritiesFactory = getAuthorities,
  preflight = runPreflight,
  profile: suppliedProfile,
  manifest: suppliedManifest,
  sourceRevisionReader = sourceRevision,
} = {}) {
  if (!submit) throw new Error("deployment is write-protected; pass --submit explicitly");
  const revision = await sourceRevisionReader(root);
  if (revision.dirty) {
    throw new Error(`deployment sources are dirty or uncommitted: ${revision.changes?.join(", ") || "unknown changes"}`);
  }
  // Inspect source state before running any compile/profile command.  The
  // preflight may refresh generated artifacts, but it must never get a chance
  // to mutate a checkout that has already failed the clean-source gate.
  const profile = suppliedProfile || await preflight(root);
  assertPreprodProfile(profile);
  const manifest = suppliedManifest || artifactManifest(root);
  let receipt = existsSync(receiptPath) ? readJson(receiptPath) : null;
  if (receipt?.status === "finalized") {
    validateReceipt(receipt, {
      profile,
      artifacts: manifest.artifacts,
      bundleHash: manifest.bundleHash,
    });
    throw new Error("Stage 4 receipt is already finalized; immutable deployment cannot be overwritten");
  }
  if (receipt) {
    if (receipt.status !== "in-progress") throw new Error("existing Stage 4 receipt is not resumable");
    if (!resume) throw new Error("an in-progress Stage 4 receipt exists; use --resume after checking its transaction status");
    validateInProgressReceipt(receipt, {
      profile,
      artifacts: manifest.artifacts,
      bundleHash: manifest.bundleHash,
      revision,
    });
  }
  const authorities = await authoritiesFactory(env);
  const authorityMap = authorityValues(authorities);
  let assembly;
  try {
    assembly = await assemblyFactory({ root, env, profile, manifest, authorities });
    const requiredMethods = ["synchronize", "assertFunds", "deploy", "call", "readLedger", "deriveTokenColor", "close"];
    if (!assembly || requiredMethods.some((method) => typeof assembly[method] !== "function")) {
      throw new Error("protected deployment assembly is incomplete; all provider operations and cleanup are required");
    }
    if (resume) {
      if (typeof assembly.reconcile !== "function") {
        throw new Error("resume requires protected transaction reconciliation");
      }
      await assembly.reconcile(receipt);
    }
    await assembly.synchronize();
    await assembly.assertFunds({
      network: PREPROD,
      night: env.MIDNIGHT_MIN_NIGHT ?? "deployment-fee-budget",
      dust: env.MIDNIGHT_MIN_DUST ?? "deployment-fee-budget",
    });

    const deploymentId = receipt?.deploymentId ?? immutableDeploymentId(now, manifest.bundleHash);
    receipt ??= newReceipt({ deploymentId, revision, manifest, now });
    if (receipt.deploymentId !== deploymentId || receipt.artifactBundleHash !== manifest.bundleHash) {
      throw new Error("resume receipt does not match this source artifact bundle");
    }
    if (receipt.sourceRevision !== revision.revision || receipt.sourceDirty !== false) {
      throw new Error("resume receipt source revision does not match the clean deployment source");
    }
    const contracts = receipt.contracts;
    assembly.contracts = contracts;
    if (!assembly.tokenColor && contracts.pool?.dependencies?.assetTokenColor) {
      assembly.tokenColor = bytesFromId(contracts.pool.dependencies.assetTokenColor);
    }
    if (!assembly.tokenColor && contracts.asset?.id) {
      assembly.tokenColor = await assembly.deriveTokenColor({
        contractId: contracts.asset.id,
        tokenDomain: "Shroudly/tMIX/v1",
      });
    }
    for (const plan of contractPlan(assembly, authorityMap)) {
      if (contracts[plan.key]?.id && validTx(contracts[plan.key].deployment)) continue;
      const constructorArgs = typeof plan.constructorArgs === "function" ? plan.constructorArgs() : plan.constructorArgs;
      if (plan.key === "pool" && !(assembly.tokenColor instanceof Uint8Array)) {
        throw new Error("tMIX token color must be derived before PrizePool deployment");
      }
      const result = await assembly.deploy({
        name: plan.name,
        key: plan.key,
        constructorArgs,
        authorities: plan.authorities,
        artifactHash: manifest.artifacts[plan.key],
        managedDirectory: join(root, "midnight/managed", MANAGED_BY_KEY[plan.key]),
      });
      const deployment = normalizeFinalizedResult(result, { kind: `${plan.name} deployment` });
      const contractId = contractAddressId(result.contractId ?? result.address ?? result.id);
      if (!validId(contractId)) throw new Error(`${plan.name} returned no contract ID`);
      contracts[plan.key] = {
        id: contractId,
        deployment,
        ...(plan.key === "pool"
          ? {
              dependencies: {
                asset: contracts.asset.id,
                randomness: contracts.randomness.id,
                yield: contracts.yield.id,
                assetTokenColor: hexBytes(result.assetTokenColor ?? assembly.tokenColor),
              },
            }
          : {}),
      };
      if (plan.key === "asset" && !assembly.tokenColor) {
        assembly.tokenColor = await assembly.deriveTokenColor({
          contractId: contracts.asset.id,
          tokenDomain: "Shroudly/tMIX/v1",
        });
      }
      receipt.transactions.push(safeTransactionRecord(deployment, {
        kind: "deploy",
        contract: plan.key,
      }));
      writePrivateJson(receiptPath, receipt);
    }
    if (!assembly.tokenColor && contracts.pool?.dependencies?.assetTokenColor) {
      assembly.tokenColor = bytesFromId(contracts.pool.dependencies.assetTokenColor);
    }
    if (!receipt.reserveSeed) {
      const result = await assembly.call({
        contract: "asset",
        contractId: contracts.asset.id,
        circuit: "seedPrizeReserve",
        args: [{ bytes: bytesFromId(contracts.pool.id) }],
        authority: authorityMap.assetReserve,
      });
      const transaction = normalizeFinalizedResult(result, { kind: "reserve seed" });
      const ledger = await assembly.readLedger({
        key: "asset",
        contract: "asset",
        contractId: contracts.asset.id,
        fields: ["reserveSeeded"],
      });
      if (ledger?.reserveSeeded !== true) throw new Error("fresh asset ledger read did not confirm reserveSeeded");
      receipt.reserveSeed = { transaction, ledger: { reserveSeeded: true }, verifiedAt: new Date().toISOString() };
      receipt.transactions.push(safeTransactionRecord(transaction, {
        kind: "seed-reserve",
        contract: "asset",
        circuit: "seedPrizeReserve",
      }));
      receipt.verification.reserveSeeded = true;
      writePrivateJson(receiptPath, receipt);
    }
    if (!receipt.automationFixture) {
      const result = await assembly.call({
        contract: "asset",
        contractId: contracts.asset.id,
        circuit: "allocateAutomation",
        args: [Uint8Array.from(Buffer.from("evidence-fixture".padEnd(32, "\0")))],
        authority: authorityMap.assetAutomation,
      });
      const transaction = normalizeFinalizedResult(result, { kind: "evidence fixture allocation" });
      const ledger = await assembly.readLedger({
        key: "asset",
        contract: "asset",
        contractId: contracts.asset.id,
        fields: ["automationIssued"],
      });
      if (ledger?.automationIssued !== true) throw new Error("fresh asset ledger read did not confirm automationIssued");
      receipt.automationFixture = { transaction, ledger: { automationIssued: true }, verifiedAt: new Date().toISOString() };
      receipt.transactions.push(safeTransactionRecord(transaction, {
        kind: "evidence-fixture",
        contract: "asset",
        circuit: "allocateAutomation",
      }));
      receipt.verification.automationIssued = true;
      writePrivateJson(receiptPath, receipt);
    }
    receipt.status = "finalized";
    receipt.finalizedAt = new Date().toISOString();
    validateReceipt(receipt, {
      profile,
      artifacts: manifest.artifacts,
      bundleHash: manifest.bundleHash,
    });
    writePrivateJson(receiptPath, receipt);
    upsertPublicEnv(join(root, ".env.production.local"), {
      [PUBLIC_ENV.deploymentId]: receipt.deploymentId,
      [PUBLIC_ENV.asset]: contracts.asset.id,
      [PUBLIC_ENV.randomness]: contracts.randomness.id,
      [PUBLIC_ENV.yield]: contracts.yield.id,
      [PUBLIC_ENV.pool]: contracts.pool.id,
      [PUBLIC_ENV.assetHash]: manifest.artifacts.asset,
      [PUBLIC_ENV.randomnessHash]: manifest.artifacts.randomness,
      [PUBLIC_ENV.yieldHash]: manifest.artifacts.yield,
      [PUBLIC_ENV.poolHash]: manifest.artifacts.pool,
    });
    return receipt;
  } finally {
    await closeAssemblyBestEffort(assembly);
  }
}

async function checkEndpoint(url, { method = "GET", timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  if (!url || typeof fetch !== "function") return { ok: false, message: "endpoint is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify({ query: "{ __typename }" }) : undefined,
    });
    return { ok: response.ok, message: `${response.status} ${response.statusText}` };
  } catch (error) {
    return { ok: false, message: error?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function checkResult(name, result) {
  return { name, ok: Boolean(result?.ok), message: result?.message || (result?.ok ? "ok" : "failed") };
}

/**
 * Read-only environment gate. It never creates Keychain entries, private
 * storage, wallet state, receipts, or transactions.
 */
export async function runCheck({
  root = ROOT,
  env = process.env,
  profileReader = loadProfile,
  manifestReader = artifactManifest,
  sourceRevisionReader = sourceRevision,
  authoritiesReader = getAuthorities,
  assemblyFactory = createProtectedAssembly,
  timeoutMs = CHECK_TIMEOUT_MS,
  privateStatePath,
  privateStatePasswordReader = (name, options) => keychainValue(name, options),
  automationWallet: suppliedAutomationWallet,
  endpointChecker = checkEndpoint,
} = {}) {
  const checks = [];
  let profile;
  let manifest;
  try {
    profile = await profileReader(root);
    const installed = installedPackageProfile(root);
    assertPreprodProfile(profile, installed);
    checks.push(checkResult("compatibility-profile", {
      ok: true,
      message: `${PROFILE_NAME} (${installed.midnightJs || "declared package versions unavailable"})`,
    }));
  } catch (error) {
    checks.push(checkResult("compatibility-profile", { ok: false, message: error.message }));
  }
  try {
    manifest = await manifestReader(root);
    checks.push(checkResult("artifacts", { ok: true, message: manifest.bundleHash }));
  } catch (error) {
    checks.push(checkResult("artifacts", { ok: false, message: error.message }));
  }
  try {
    const revision = await sourceRevisionReader(root);
    checks.push(checkResult("clean-deployment-sources", {
      ok: !revision.dirty,
      message: revision.dirty ? revision.changes.join(", ") : revision.revision,
    }));
  } catch (error) {
    checks.push(checkResult("clean-deployment-sources", { ok: false, message: error.message }));
  }

  let authorities;
  try {
    authorities = await authoritiesReader(env);
    checks.push(checkResult("keychain-authorities", { ok: true, message: "all authority entries present" }));
  } catch (error) {
    checks.push(checkResult("keychain-authorities", { ok: false, message: error.message }));
  }

  const profileNetwork = typeof profile?.network === "object" ? profile.network : {};
  const indexerUrl = env.MIDNIGHT_INDEXER_HTTP_URL || profileNetwork.indexerGraphql;
  const proofUrl = env.MIDNIGHT_PROOF_SERVER_URL || "http://127.0.0.1:6300";
  let authenticatedIndexerUrl;
  try {
    authenticatedIndexerUrl = withProviderToken(indexerUrl, env);
  } catch (error) {
    checks.push(checkResult("chain-data-token", { ok: false, message: error.message }));
  }
  // Without a token the Blockfrost probe can only fail with 403; skip it.
  if (authenticatedIndexerUrl !== undefined) {
    checks.push(checkResult("indexer", await endpointChecker(authenticatedIndexerUrl, { method: "POST", timeoutMs })));
  }
  checks.push(checkResult("proof-server", await endpointChecker(proofUrl, { timeoutMs })));
  const indexerWsUrl = indexerWsUrlFor(env, profileNetwork, indexerUrl);
  checks.push(checkResult("indexer-websocket", {
    ok: Boolean(indexerWsUrl),
    message: indexerWsUrl || "endpoint is not configured",
  }));

  const storagePath = privateStatePath || rootForAssembly(
    env.MIDNIGHT_PRIVATE_STATE_DB || ".midnight/preprod-private-state",
    root,
  );
  try {
    const storageStat = statSync(storagePath);
    const mode = storageStat.mode & 0o777;
    checks.push(checkResult("private-state-storage", {
      ok: storageStat.isDirectory() && (mode & 0o077) === 0,
      message: `${storagePath} ${storageStat.isDirectory() ? "directory" : "is not a directory"} mode ${mode.toString(8).padStart(3, "0")}`,
    }));
  } catch (error) {
    checks.push(checkResult("private-state-storage", { ok: false, message: `${storagePath}: ${error.message}` }));
  }
  try {
    const passwordName = env.MIDNIGHT_PRIVATE_STATE_PASSWORD_NAME || "shroudly-preprod-private-state-password";
    const password = await privateStatePasswordReader(passwordName, {
      account: env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod",
      servicePrefix: env.MIDNIGHT_PRIVATE_STATE_SERVICE_PREFIX || "com.shroudly.preprod.private-state.",
    });
    checks.push(checkResult("private-state-password", {
      ok: typeof password === "string" && password.length > 0,
      message: typeof password === "string" && password.length > 0 ? "protected entry present" : "protected entry is empty",
    }));
  } catch (error) {
    checks.push(checkResult("private-state-password", { ok: false, message: error.message }));
  }

  let automationWallet = suppliedAutomationWallet;
  if (automationWallet) {
    try {
      const mapping = await automationEncryptionMapping(automationWallet);
      checks.push(checkResult("automation-recipient-mapping", { ok: mapping.size === 1, message: "coin/encryption keys mapped" }));
    } catch (error) {
      checks.push(checkResult("automation-recipient-mapping", { ok: false, message: error.message }));
    }
  } else if (env.MIDNIGHT_AUTOMATION_WALLET_SECRET_NAME) {
    try {
      const seed = keychainSecret(env.MIDNIGHT_AUTOMATION_WALLET_SECRET_NAME, {
        account: env.MIDNIGHT_KEYCHAIN_ACCOUNT || "shroudly-preprod",
        servicePrefix: env.MIDNIGHT_WALLET_SERVICE_PREFIX || "com.shroudly.preprod.wallet.",
      });
      automationWallet = await deriveWalletMaterial(seed);
      const mapping = await automationEncryptionMapping(automationWallet);
      checks.push(checkResult("automation-recipient-mapping", { ok: mapping.size === 1, message: "coin/encryption keys mapped" }));
    } catch (error) {
      checks.push(checkResult("automation-recipient-mapping", { ok: false, message: error.message }));
    }
  } else {
    checks.push(checkResult("automation-recipient-mapping", { ok: false, message: "automation wallet Keychain entry is not configured" }));
  }

  let assembly;
  if (authorities && profile && manifest) {
    try {
      assembly = await assemblyFactory({
        root,
        env,
        profile,
        manifest,
        authorities,
        automationWallet,
        readOnly: true,
      });
      await withTimeout(assembly.synchronize(), timeoutMs, "wallet synchronization");
      checks.push(checkResult("wallet-synchronization", { ok: true, message: "synchronized" }));
      await withTimeout(assembly.assertFunds({ network: PREPROD }), timeoutMs, "wallet balance check");
      checks.push(checkResult("wallet-funds", { ok: true, message: "NIGHT/DUST budget available" }));
    } catch (error) {
      checks.push(checkResult("wallet-synchronization", { ok: false, message: error.message }));
      checks.push(checkResult("wallet-funds", { ok: false, message: error.message }));
    } finally {
      await closeAssemblyBestEffort(assembly);
    }
  } else {
    checks.push(checkResult("wallet-synchronization", { ok: false, message: "credentials and pinned artifacts are required" }));
    checks.push(checkResult("wallet-funds", { ok: false, message: "credentials and pinned artifacts are required" }));
  }
  return { ok: checks.every((check) => check.ok), checks };
}

function help() {
  return [
    "Usage: pnpm midnight:deploy:preprod -- --check",
    "       pnpm midnight:deploy:preprod -- --submit [--resume]",
    "       pnpm midnight:deploy:preprod -- --validate [--receipt path]",
    "",
    "The check path is read-only. The submit path requires the protected Keychain deployer and pinned Midnight.js release assembly.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }
  if (args.check) {
    const result = await runCheck();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (args.validate) {
    const receipt = readJson(args.receipt);
    const manifest = artifactManifest();
    validateReceipt(receipt, { artifacts: manifest.artifacts, bundleHash: manifest.bundleHash });
    if ((statSync(args.receipt).mode & 0o777) !== 0o600) throw new Error("Stage 4 receipt must be mode 0600");
    console.log(`Stage 4 receipt valid: ${receipt.deploymentId}`);
    return;
  }
  const receipt = await runDeployment({ receiptPath: args.receipt, submit: args.submit, resume: args.resume });
  console.log(JSON.stringify({
    deploymentId: receipt.deploymentId,
    network: receipt.network,
    contracts: Object.fromEntries(CONTRACT_KEYS.map((key) => [key, receipt.contracts[key].id])),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    let message = redactSecrets(error?.message ?? "Stage 4 deployment failed");
    message = message.replace(/0x?[0-9a-f]{64}/gi, "[redacted]");
    console.error(`Stage 4 deployment stopped: ${message}`);
    process.exitCode = 1;
  });
}
