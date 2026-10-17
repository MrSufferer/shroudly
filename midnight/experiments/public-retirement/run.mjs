import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Records the #22 public-retirement experiment. Real proofs only: without proof server 8.1.0 the
// run fails rather than recording a substitute.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const started = performance.now();
const compiled = spawnSync('compact', ['compile', 'PublicRetirement.compact', '../../managed/public-retirement'], {cwd: here, encoding: 'utf8'});
if (compiled.status !== 0) throw Error(compiled.stderr || compiled.stdout || 'Compact compiler failed');
const compileMs = Math.round(performance.now() - started);
const {PROOF_SERVER, CIRCUITS, proveAgainstWrongKey, proveScenario} = await import('./prove.mjs');
const {measureAward, W_MAX} = await import('./award.mjs');
const proofServerVersion = await fetch(`${PROOF_SERVER}/version`).then(r => r.text(), () => undefined);
if (proofServerVersion !== '8.1.0') throw Error(`proof server 8.1.0 required at ${PROOF_SERVER}, got ${proofServerVersion}`);

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
  keys: Object.fromEntries(CIRCUITS.map(circuit => [circuit, Object.fromEntries(['prover', 'verifier'].map(kind => {
    const path = `../../managed/public-retirement/keys/${circuit}.${kind}`;
    return [kind, {bytes: statSync(new URL(path, import.meta.url)).size, sha256: sha256(path)}];
  }))])),
  proofs: measured,
  verification: {
    localWellFormed: 'structure, transcript and limits only',
    tamperedProofByte: tamperedProof,
    wrongCircuitVerifierKey: await proveAgainstWrongKey({start: START}),
    finding: 'ledger-v8 8.1.0 Transaction.wellFormed with verifyContractProofs accepts tampered proofs and proofs ' +
      'against the wrong verifier key; proof verification is not established locally and remains a node-side gate',
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
