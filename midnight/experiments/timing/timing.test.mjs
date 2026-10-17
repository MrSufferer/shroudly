import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCHEDULE} from './schedule.mjs';
import {DRAW,S,E,bytes,bucketOf,setup,revealed} from './harness.mjs';

const {BUCKET, FINALITY_ALLOWANCE, CLAIM} = SCHEDULE;

test('commitments are accepted only from interval start to three minutes before it closes', () => {
  const p = setup();
  assert.throws(() => p.run(S - 1, 'commit', DRAW, 0n), /commit window/);
  p.run(S, 'commit', DRAW, 0n);
  p.run(E - 181, 'commit', DRAW, 1n);
  assert.throws(() => p.run(E - 180, 'commit', DRAW, 2n), /commit window/);
  assert.throws(() => p.run(E + 10, 'commit', DRAW, 2n), /commit window/);
  assert.throws(() => p.run(S + 5, 'commit', DRAW, 0n), /already committed/);
});

test('reveals open only after weighting closes and stay open five minutes', () => {
  const p = setup();
  p.run(S, 'commit', DRAW, 0n);
  assert.throws(() => p.run(E - 1, 'reveal', DRAW, 0n), /reveal window/);
  assert.throws(() => p.run(E + 300, 'reveal', DRAW, 0n), /reveal window/);
  p.setSecret(bytes(9));
  assert.throws(() => p.run(E, 'reveal', DRAW, 0n), /reveal mismatch/);
  p.setSecret(bytes(1));
  assert.throws(() => p.run(E, 'reveal', DRAW, 1n), /no commitment/);
  p.run(E, 'reveal', DRAW, 0n);
  assert.throws(() => p.run(E + 1, 'reveal', DRAW, 0n), /already revealed/);
  assert.equal(p.read().revealed.lookup(DRAW), 1n);
});

test('late commitment cannot become a late reveal', () => {
  const p = setup();
  assert.throws(() => p.run(E - 180, 'commit', DRAW, 0n), /commit window/);
  assert.throws(() => p.run(E, 'reveal', DRAW, 0n), /no commitment/);
});


test('finalization is rejected before the reveal window closes', () => {
  const p = setup();
  revealed(p);
  const early = E + 299;
  assert.throws(() => p.run(early, 'finalize', DRAW, bucketOf(early)), /finalization not open/);
  p.run(E + 300, 'finalize', DRAW, bucketOf(E + 300));
  assert.equal(p.read().selectedAt.lookup(DRAW), BigInt(Math.floor((E + 300) / BUCKET) * BUCKET));
});

test('finalization needs two reveals and happens once', () => {
  const p = setup();
  revealed(p, 1);
  assert.throws(() => p.run(E + 300, 'finalize', DRAW, bucketOf(E + 300)), /reveal threshold/);
  const q = setup();
  revealed(q);
  q.run(E + 300, 'finalize', DRAW, bucketOf(E + 300));
  assert.throws(() => q.run(E + 301, 'finalize', DRAW, bucketOf(E + 301)), /already finalized/);
});

test('caller-asserted selection time must match network time within its bucket', () => {
  const now = E + 400;
  for (const forged of [bucketOf(now) + 1n, bucketOf(now) - 1n, bucketOf(now) + 100_000n, 0n]) {
    const p = setup();
    revealed(p);
    assert.throws(() => p.run(now, 'finalize', DRAW, forged), /selection time/);
  }
  const p = setup();
  revealed(p);
  p.run(now, 'finalize', DRAW, bucketOf(now));
});

test('late historical finalization stays valid and keeps its own network-time claim window', () => {
  const p = setup();
  revealed(p);
  const late = E + 3 * 86400 + 17;
  p.run(late, 'finalize', DRAW, bucketOf(late));
  const selected = Number(p.read().selectedAt.lookup(DRAW));
  const deadline = selected + BUCKET + FINALITY_ALLOWANCE + CLAIM;
  p.run(deadline - 1, 'claim', DRAW);
});

test('the compiled interface exposes no caller-supplied clock, deadline or grace-period input', () => {
  const info = JSON.parse(readFileSync(new URL('../../managed/timing-probe/compiler/contract-info.json', import.meta.url), 'utf8'));
  const impure = info.circuits.filter(circuit => !circuit.pure);
  assert.deepEqual(impure.map(circuit => circuit.name).sort(), ['claim', 'commit', 'finalize', 'pause', 'resume', 'reveal']);
  // Only a bucket (proved against network time) and a bounded pause duration are time-shaped inputs.
  assert.deepEqual(Object.fromEntries(impure.map(circuit => [circuit.name, circuit.arguments.map(argument => argument.name)])), {
    commit: ['draw', 'who'], reveal: ['draw', 'who'], finalize: ['draw', 'bucket'],
    pause: ['kind', 'scope', 'bucket', 'duration'], resume: ['id', 'bucket'], claim: ['draw'],
  });
  for (const circuit of info.circuits) assert.doesNotMatch(circuit.name, /extend|grace|deadline|setTime|now/i);
  assert.deepEqual(info.witnesses.map(witness => witness.name).sort(), ['owner', 'secret']);
  for (const pure of info.circuits.filter(circuit => circuit.pure)) assert.deepEqual(pure.arguments, []);
});

test('claims succeed until the derived deadline and not afterwards', () => {
  const p = setup();
  revealed(p);
  const now = E + 330;
  p.run(now, 'finalize', DRAW, bucketOf(now));
  const selected = Number(p.read().selectedAt.lookup(DRAW));
  const deadline = selected + BUCKET + FINALITY_ALLOWANCE + CLAIM;
  assert.throws(() => p.run(deadline, 'claim', DRAW), /claim window/);
  assert.throws(() => p.run(deadline + 3600, 'claim', DRAW), /claim window/);
  assert.throws(() => p.run(now, 'claim', DRAW + 1n), /not selected/);
  p.run(deadline - 1, 'claim', DRAW);
  assert.throws(() => p.run(deadline - 1, 'claim', DRAW), /already claimed/);
});

test('selection always leaves at least sixty minutes after the finalized block time', () => {
  // The finalized block time lies in [bucketStart, bucketStart + BUCKET); the participant observes
  // finality FINALITY_ALLOWANCE later at worst. The deadline must still be sixty minutes away.
  for (const offset of [0, 1, BUCKET - 1]) {
    const p = setup();
    revealed(p);
    const now = E + 300 + offset;
    p.run(now, 'finalize', DRAW, bucketOf(now));
    const selected = Number(p.read().selectedAt.lookup(DRAW));
    const deadline = selected + BUCKET + FINALITY_ALLOWANCE + CLAIM;
    assert.ok(deadline - (now + FINALITY_ALLOWANCE) >= CLAIM);
    p.run(now + FINALITY_ALLOWANCE + CLAIM - 1, 'claim', DRAW);
  }
});
