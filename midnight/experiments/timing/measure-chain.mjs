import {fileURLToPath} from 'node:url';
import {writeFileSync, mkdirSync} from 'node:fs';
import {emit, runIsolated} from './isolated.mjs';

// Read-only Preprod clock measurement: block cadence, best-to-finalized distance
// and the delay between a block's own timestamp and the first moment a finalized
// view (RPC finalized head, indexer) shows it. The provider's HTTP Date header,
// not the local clock, is the reference for "now" (1 s resolution).
const BLOCK = '{ block { height hash timestamp } }';
const AT = 'query($h: Int!) { block(offset: {height: $h}) { height hash timestamp } }';

if (process.argv[2] === '--worker') {
  const {openProvider} = await import('./provider.mjs');
  const [path, seconds, interval] = [process.argv[3], Number(process.argv[4]), Number(process.argv[5])];
  const provider = await openProvider(path);
  const samples = [];
  const firstSeen = new Map();
  const stopAt = Date.now() + seconds * 1000;
  try {
    while (Date.now() < stopAt) {
      const began = Date.now();
      try {
        const best = await provider.rpc('chain_getHeader');
        const finalizedHash = (await provider.rpc('chain_getFinalizedHead')).result;
        const finalizedHeader = (await provider.rpc('chain_getHeader', [finalizedHash]));
        const indexed = await provider.graphql(BLOCK);
        const reference = Date.parse(indexed.date);
        const sample = {
          referenceMs: reference, localMs: began,
          bestHeight: Number.parseInt(best.result.number, 16),
          finalizedHeight: Number.parseInt(finalizedHeader.result.number, 16),
          indexerHeight: indexed.data.block.height, indexerTimestamp: indexed.data.block.timestamp,
        };
        samples.push(sample);
        if (!firstSeen.has(sample.indexerHeight)) firstSeen.set(sample.indexerHeight, {timestamp: sample.indexerTimestamp, referenceMs: reference});
        if (samples.length % 10 === 0) emit({progress: samples.length, bestHeight: sample.bestHeight, finalizedHeight: sample.finalizedHeight});
      } catch { emit({category: 'sample-failed'}); }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, interval * 1000 - (Date.now() - began))));
    }
    // Block timestamps for the whole observed height range, for cadence statistics.
    const heights = [...firstSeen.keys()].sort((a, b) => a - b);
    const timestamps = [];
    for (let h = heights[0]; h <= heights.at(-1); h++) {
      try { timestamps.push([h, (await provider.graphql(AT, {h})).data.block.timestamp]); } catch { emit({category: 'block-query-failed'}); }
    }
    emit({final: true, samples, firstSeen: [...firstSeen.entries()], timestamps});
  } finally { await provider.close(); }
} else {
  const [path, seconds = '600', interval = '2', out] = process.argv.slice(2);
  let result;
  const {code, tainted} = await runIsolated(fileURLToPath(import.meta.url), [path, seconds, interval], (Number(seconds) + 600) * 1000, record => { if (record.final) result = record; else console.log(JSON.stringify(record)); });
  if (!result || tainted) { console.log(JSON.stringify({measured: false, exit: code})); process.exit(1); }
  const stat = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
    return {n: sorted.length, min: sorted[0], p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1), mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2)};
  };
  const gaps = result.timestamps.slice(1).map(([, t], i) => (t - result.timestamps[i][1]) / 1000);
  // Lag bounds: reference is a whole-second Date header, so each value carries about +-1 s.
  const observationLag = result.firstSeen.map(([, {timestamp, referenceMs}]) => (referenceMs - timestamp) / 1000);
  const distance = result.samples.map(s => s.bestHeight - s.finalizedHeight);
  const indexerVsFinalized = result.samples.map(s => s.finalizedHeight - s.indexerHeight);
  const skew = result.samples.map(s => (s.localMs - s.referenceMs) / 1000);
  const summary = {
    format: 'shroudly-timing-chain-measurement-v1', measuredAt: new Date().toISOString(), durationSeconds: Number(seconds), pollSeconds: Number(interval),
    blockSpacingSeconds: stat(gaps), firstSightLagSecondsAfterBlockTimestamp: stat(observationLag), bestMinusFinalizedBlocks: stat(distance),
    finalizedMinusIndexerBlocks: stat(indexerVsFinalized), localMinusProviderDateSeconds: stat(skew),
    blocks: {first: result.timestamps[0], last: result.timestamps.at(-1), count: result.timestamps.length}, networkTransactions: 0,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (out) { mkdirSync(new URL('./evidence/', import.meta.url), {recursive: true}); writeFileSync(out, JSON.stringify({...summary, gapsSeconds: gaps, observationLagSeconds: observationLag}, null, 2)); }
}
