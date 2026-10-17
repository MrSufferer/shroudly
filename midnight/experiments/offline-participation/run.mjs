import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const proving = process.argv.includes('--prove');
const compile = (source, target, keys) => {
  const start = performance.now();
  const result = spawnSync('compact', ['compile', ...(keys ? [] : ['--skip-zk']), source, target], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw Error(result.stderr || result.stdout || 'Compact compiler failed');
  return Math.round(performance.now() - start);
};
const baselineCompileMs = compile('midnight/PrizePool.compact', 'midnight/managed/prize-pool', false);
const probeCompileMs = compile('midnight/experiments/offline-participation/WitnessAvailability.compact', 'midnight/managed/witness-availability', proving);
const {qualify} = await import('./qualify.mjs');
const {probe} = await import('./witness-probe.mjs');
const git = args => {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw Error(result.stderr || 'Cannot identify experiment revision');
  return result.stdout.trim();
};
const sourcePaths = ['../../PrizePool.compact', './WitnessAvailability.compact', './qualify.mjs',
  './witness-probe.mjs', './run.mjs', './qualification.test.mjs', './README.md'];
const sha256 = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const report = {
  recordedAt: new Date().toISOString(),
  releaseQualified: false,
  classification: 'rejected-protocol-probe-and-baseline-diagnostics',
  toolchain: {node: process.version, cli: spawnSync('compact', ['--version'], {encoding: 'utf8'}).stdout.trim(),
    compiler: spawnSync('compact', ['compile', '--version'], {encoding: 'utf8'}).stdout.trim(),
    runtime: JSON.parse(readFileSync(new URL('../../../node_modules/@midnight-ntwrk/compact-runtime/package.json', import.meta.url))).version,
    proofServer: proving ? {usage: 'requested', endpoint: 'http://127.0.0.1:6300',
      configuredVersion: JSON.parse(readFileSync(new URL('../../version-profile.json', import.meta.url))).proofServer,
      versionStatus: 'unverified configuration; actual responding service identity not measured'} : {usage: 'not-used'}},
  revision: {head: git(['rev-parse', 'HEAD']), workingTreeStatus: git(['status', '--short'])},
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, sha256(path)])),
  baselineCompileMs, probeCompileMs,
  baseline: await qualify(),
  witnessProbe: await probe({prove: proving}),
};
if (proving) report.artifacts = Object.fromEntries(['prover','verifier'].map(kind => [kind, {
  bytes: statSync(new URL(`../../managed/witness-availability/keys/select.${kind}`, import.meta.url)).size,
  sha256: sha256(`../../managed/witness-availability/keys/select.${kind}`),
}]));
const output = JSON.stringify(report, (_,v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
if (process.argv.includes('--record')) writeFileSync(new URL('./results.json', import.meta.url), output);
process.stdout.write(output);
