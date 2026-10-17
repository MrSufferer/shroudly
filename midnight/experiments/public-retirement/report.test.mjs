import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const results = JSON.parse(readFileSync(new URL('./results.json', import.meta.url)));
const sha256 = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');

test('the recorded run matches the current sources and qualifies nothing', () => {
  for (const [path, hash] of Object.entries(results.sourceHashes)) {
    if (path === './results.json') continue;
    assert.equal(sha256(path), hash, `${path} changed since the recorded run; rerun with --record`);
  }
  assert.equal(results.releaseQualified, false);
  assert.equal(results.toolchain.proofServer.reportedVersion, '8.1.0');
});

test('the record holds measurements and hashes only, never keys or openings', () => {
  const text = JSON.stringify(results);
  assert.ok(text.length < 40_000);
  assert.doesNotMatch(text, /secret|opening|privateState|witness/i);
  assert.ok(Object.values(results.keys).every(k => /^[0-9a-f]{64}$/.test(k.prover.sha256)));
});
