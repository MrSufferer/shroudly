// Condense live evidence (gitignored, local) into the committed results.json.
// Usage: node summarize.mjs <full-evidence.json> <smoke-evidence.json> <out.json> [edge-run.json ...]
// Edge runs contribute only cutoff-margin observations that the node actually judged.
import {readFileSync, writeFileSync} from 'node:fs';

const [fullPath, smokePath, outPath, ...edgePaths] = process.argv.slice(2);
if (!outPath) throw Error('usage: node summarize.mjs <full.json> <smoke.json> <out.json> [edge-run.json ...]');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const full = read(fullPath), smoke = read(smokePath);
if (!full.completed || full.mismatches?.length) throw Error('full evidence is incomplete or has mismatches');

const {S, E} = full.plan;
const relative = (id, seconds) => seconds == null ? null : +(seconds - (id.startsWith('D2') ? E : S)).toFixed(3);
const nodeCode = detail => detail?.match(/Custom error: (\d+)/)?.[1] ?? null;
const summarizeStep = (record, intervalOf = relative) => ({
  id: record.id, circuit: record.circuit, expected: record.expected, outcome: record.outcome, note: record.note ?? undefined,
  forgedClockSeconds: record.forgedClockSeconds, targetSeconds: record.targetSeconds,
  submittedAtSeconds: record.submittedAtSeconds ?? null, blockTimestampSeconds: record.blockTimestampMs == null ? null : record.blockTimestampMs / 1000,
  offsetFromIntervalStart: {submitted: intervalOf(record.id, record.submittedAtSeconds), block: intervalOf(record.id, record.blockTimestampMs == null ? null : record.blockTimestampMs / 1000)},
  txHash: record.txHash ?? null, blockHeight: record.blockHeight ?? null,
  rejection: record.outcome === 'SucceedEntirely' ? null : {where: record.submittedAtSeconds ? 'node' : 'local', nodeErrorCode: nodeCode(record.errorDetail), errorClass: record.errorClass},
  lateStartSeconds: record.lateStartSeconds, walletReopenedMs: record.wallet?.reopenedMs,
  replayMatchesNetwork: record.replay?.matchesNetwork ?? null,
});

const byId = Object.fromEntries(full.steps.map(record => [record.id, record]));
const deadlines = full.deadlines;
const usableMinutes = (finalizeId, base) => {
  const record = byId[finalizeId];
  return {finalizeBlockSeconds: record.blockTimestampMs / 1000, finalityObservedAtSeconds: record.observedFinalizedAtSeconds, baseDeadlineSeconds: base,
    fromBlockMinutes: +((base - record.blockTimestampMs / 1000) / 60).toFixed(2), fromObservedFinalityMinutes: +((base - record.observedFinalizedAtSeconds) / 60).toFixed(2)};
};

// Commit-cutoff edge: seconds between submission and the cutoff (start + 720), for submissions the node judged.
const cutoffObservations = [];
for (const [run, evidence] of [['final', full], ...edgePaths.map(path => [path.match(/run(\d+)/)?.[1] ?? path, read(path)])]) {
  for (const record of evidence.steps) {
    if (!/^D2?\.commit\.slot\d\.(boundary|cutoffProbe\d+|late\d?)$/.test(record.id) || !record.submittedAtSeconds) continue;
    const cutoff = (record.id.startsWith('D2') ? evidence.plan.E : evidence.plan.S) + 720;
    cutoffObservations.push({run, id: record.id, secondsBeforeCutoffAtSubmission: +(cutoff - record.submittedAtSeconds).toFixed(1),
      secondsBeforeCutoffAtBlock: record.blockTimestampMs == null ? null : +(cutoff - record.blockTimestampMs / 1000).toFixed(1), accepted: record.outcome === 'SucceedEntirely', nodeErrorCode: nodeCode(record.errorDetail)});
  }
}
cutoffObservations.sort((a, b) => a.secondsBeforeCutoffAtSubmission - b.secondsBeforeCutoffAtSubmission);
const latencies = full.steps.filter(r => r.outcome === 'SucceedEntirely' && r.submittedAtSeconds).map(r => r.blockTimestampMs / 1000 - r.submittedAtSeconds).sort((a, b) => a - b);

const result = {
  format: 'shroudly-timing-results-v1',
  sourceRevision: full.sourceRevision, schedule: full.schedule, providerClockOffsetMs: full.providerClockOffsetMs,
  contractAddress: full.contractAddress, deployment: full.deployment, deployedOperations: full.deployedOperations, artifactHashes: full.artifactHashes,
  plan: full.plan, deadlines,
  smoke: {contractAddress: smoke.contractAddress, deployment: smoke.deployment, steps: smoke.steps.map(record => summarizeStep(record, (id, s) => s == null ? null : +(s - smoke.plan?.S).toFixed(3)))},
  steps: full.steps.map(record => summarizeStep(record)),
  mismatches: full.mismatches,
  claimWindow: {D: usableMinutes('D.finalize', deadlines.baseD), D2: usableMinutes('D2.finalize', deadlines.baseD2),
    pauseExtendedClaim: {deadline: deadlines.extendedD, blockSeconds: byId['D.claim.afterBaseDeadline'].blockTimestampMs / 1000,
      secondsPastBaseDeadline: byId['D.claim.afterBaseDeadline'].blockTimestampMs / 1000 - deadlines.baseD}},
  inclusionLatencySeconds: {count: latencies.length, min: latencies[0], median: latencies[latencies.length >> 1], max: latencies.at(-1)},
  cutoffObservations,
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({claimWindow: result.claimWindow, inclusionLatencySeconds: result.inclusionLatencySeconds, cutoffObservations}, null, 1));
