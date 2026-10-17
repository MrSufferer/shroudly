import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify } from './qualify.mjs';

test('qualification fails closed when the real contract cannot admit an eligible saver', async () => {
  const report = await qualify();
  assert.equal(report.releaseQualified, false);
  assert.equal(report.capacity.attempted, 8);
  assert.equal(report.capacity.admitted, 0);
  assert.match(report.capacity.failures[0], /expected a cell, received null/);
  assert.equal(report.evidence.kind, 'generated-compact-runtime');
  assert.equal(report.evidence.proofsGenerated, 0);
});

import { probe } from './witness-probe.mjs';
test('eight committed operands do not supply offline settlement witnesses', async () => {
  const result = await probe();
  assert.equal(result.capacity, 8);
  assert.equal(result.controlWinner, 7);
  assert.match(result.offlineFailure, /private opening unavailable/);
  assert.equal(result.controlUsesAllParticipantOpenings, true);
});

test('seeded baseline isolates the cohort ceiling and repeated-note identity-cap failure', async () => {
  const {seededFixture} = await qualify();
  assert.equal(seededFixture.notReachableFromConstructor, true);
  assert.equal(seededFixture.admitted, 5);
  assert.match(seededFixture.sixthFailure, /cohort is full/);
  assert.equal(seededFixture.sameIdentityBalance, '2000000000');
  assert.equal(seededFixture.sameNoteReplayAccepted, true);
  assert.equal(seededFixture.transcriptAudit.amountEncodingObserved, true);
  assert.equal(seededFixture.transcriptAudit.ownerEncodingObserved, true);
  assert.equal(seededFixture.withdrawal.runtimeAccepted, true);
  assert.equal(seededFixture.withdrawal.unresolvedDrawId, '1');
});
