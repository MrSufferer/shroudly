import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Records the #22 public-retirement experiment. Real proofs only: without the version profile's proof server
// (8.1.3) the run fails rather than recording a substitute.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const started = performance.now();
const compiled = spawnSync('compact', ['compile', 'PublicRetirement.compact', '../../managed/public-retirement'], {cwd: here, encoding: 'utf8'});
if (compiled.status !== 0) throw Error(compiled.stderr || compiled.stdout || 'Compact compiler failed');
const compileMs = Math.round(performance.now() - started);
const {PROOF_SERVER, PROOF_SERVER_VERSION, CIRCUITS, proveAgainstWrongKey, proveScenario} = await import('./prove.mjs');
const {measureAward, W_MAX} = await import('./award.mjs');
const proofServerVersion = await fetch(`${PROOF_SERVER}/version`).then(r => r.text(), () => undefined);
if (proofServerVersion !== PROOF_SERVER_VERSION) throw Error(`proof server ${PROOF_SERVER_VERSION} required at ${PROOF_SERVER}, got ${proofServerVersion}`);

const git = args => {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw Error(result.stderr || 'Cannot identify experiment revision');
  return result.stdout.trim();
};
const version = pkg => JSON.parse(readFileSync(new URL(`../../../node_modules/${pkg}/package.json`, import.meta.url))).version;
export const SOURCES = ['./PublicRetirement.compact', './pool.mjs', './private-state.mjs', './disclosure.mjs', './prove.mjs',
  './award.mjs', './run.mjs', './pool.test.mjs', './disclosure.test.mjs', './prove.test.mjs', './award.test.mjs',
  './report.test.mjs', './README.md'];
const sha256 = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const START = 1_800_000_000;
// Preprod limits from #22: transaction bytes, circuit k and verifier key bytes.
export const PREPROD_LIMITS = {transactionBytes: 786_432, k: 25, verifierKeyBytes: 50_000};
const circuitK = circuit => fetch(`${PROOF_SERVER}/k`, {method: 'POST',
  body: readFileSync(new URL(`../../managed/public-retirement/zkir/${circuit}.bzkir`, import.meta.url))}).then(r => r.text()).then(Number);
const ks = Object.fromEntries(await Promise.all(CIRCUITS.map(async circuit => [circuit, await circuitK(circuit)])));
const {measured, tamperedProof} = await proveScenario({start: START});
const award = measureAward();
const summarize = ({n, total, probability, expectedDraws, expectedWaitDays}) =>
  ({slots: n, totalWeight: total, probability, expectedDraws, expectedWaitDays});

const report = {
  recordedAt: new Date().toISOString(),
  issue: 22,
  releaseQualified: false,
  classification: 'mechanics-measured-award-below-floor-decision-required',
  toolchain: {node: process.version,
    compiler: spawnSync('compact', ['compile', '--version'], {encoding: 'utf8'}).stdout.trim(),
    runtime: version('@midnight-ntwrk/compact-runtime'), ledger: version('@midnight-ntwrk/ledger-v8'),
    proofServer: {endpoint: PROOF_SERVER, reportedVersion: proofServerVersion}},
  revision: {head: git(['rev-parse', 'HEAD']), workingTreeStatus: git(['status', '--short'])},
  sourceHashes: Object.fromEntries(SOURCES.map(path => [path, sha256(path)])),
  compileMs,
  preprodLimits: PREPROD_LIMITS,
  keys: Object.fromEntries(CIRCUITS.map(circuit => [circuit, {k: ks[circuit], ...Object.fromEntries(['prover', 'verifier'].map(kind => {
    const path = `../../managed/public-retirement/keys/${circuit}.${kind}`;
    return [kind, {bytes: statSync(new URL(path, import.meta.url)).size, sha256: sha256(path)}];
  }))}])),
  proofs: measured,
  verification: {
    localWellFormed: 'structure, transcript and limits only',
    tamperedProofByte: tamperedProof,
    wrongCircuitVerifierKey: await proveAgainstWrongKey({start: START}),
    finding: 'ledger-v8 Transaction.wellFormed with verifyContractProofs (8.1.0, and 8.1.3 in a manual cross-check) accepts ' +
      'tampered proofs and proofs against the wrong verifier key; proof verification is not established locally and ' +
      'remains a node-side gate',
  },
  award: {
    wMax: W_MAX, drawsPerDay: 96,
    typical: summarize(award.typical), skewed: summarize(award.skewed), allAtCap: summarize(award.allAtCap),
    churnDuring: summarize(award.churn.during), churnAfterCompaction: summarize(award.churn.after),
    finding: 'public retirement bounds churn dilution to the interval it occurs in, but typical award probability ' +
      'is unchanged from design record 4.1; rejection rollover is the dominant outcome',
  },
  disclosureCohort: {minimum: 5, counts: 'live identity tags at close (credentials, not people; ADR 0028)',
    addedDisclosure: 'none under public retirement'},
  liveNetworkGates: ['node-side contract proof verification', 'draw randomness', 'asset custody', 'network time',
    'transaction inclusion within the Draw Interval'],
};
const output = JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
if (process.argv.includes('--record')) writeFileSync(new URL('./results.json', import.meta.url), output);
process.stdout.write(output);
