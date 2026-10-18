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
  const profile = JSON.parse(readFileSync(new URL('../../version-profile.json', import.meta.url)));
  assert.equal(results.toolchain.proofServer.reportedVersion, profile.proofServer);
});

test('every recorded circuit is within the Preprod limits', () => {
  const {preprodLimits: limits} = results;
  assert.deepEqual(limits, {transactionBytes: 786_432, k: 25, verifierKeyBytes: 50_000});
  for (const [circuit, key] of Object.entries(results.keys)) {
    assert.ok(Number.isInteger(key.k) && key.k <= limits.k, `${circuit} k=${key.k}`);
    assert.ok(key.verifier.bytes <= limits.verifierKeyBytes, `${circuit} verifier key ${key.verifier.bytes} bytes`);
  }
  for (const proof of results.proofs) assert.ok(proof.transactionBytes <= limits.transactionBytes, proof.circuit);
});

test('the record holds measurements and hashes only, never keys or openings', () => {
  const text = JSON.stringify(results);
  assert.ok(text.length < 40_000);
  assert.doesNotMatch(text, /secret|opening|privateState|witness/i);
  assert.ok(Object.values(results.keys).every(k => /^[0-9a-f]{64}$/.test(k.prover.sha256)));
});
