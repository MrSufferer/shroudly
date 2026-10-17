import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEDULE} from './schedule.mjs';
import {DRAW,S,E,bytes,bucketOf,setup,revealed} from './harness.mjs';

const {BUCKET, FINALITY_ALLOWANCE, CLAIM} = SCHEDULE;
const CLAIMS = 1n, DEPOSITS = 2n;

function selected(now = E + 330) {
  const p = setup();
  revealed(p);
  p.run(now, 'finalize', DRAW, bucketOf(now));
  const at = Number(p.read().selectedAt.lookup(DRAW));
  return {p, at, base: at + BUCKET + FINALITY_ALLOWANCE + CLAIM};
}
const pause = (p, time, kind, scope, duration) => p.run(time, 'pause', kind, scope, bucketOf(time), BigInt(duration));
const record = (p, id) => p.read().pauses.lookup(BigInt(id));
const length = r => Number(r.end - r.start);

test('a claim-blocking pause blocks the claim and extends the deadline by its recorded blocked time', () => {
  const {p, base} = selected();
  pause(p, base - 1000, CLAIMS, 0n, 600);
  const r = record(p, 0);
  assert.equal(length(r), 600 + BUCKET);
  assert.throws(() => p.run(Number(r.start), 'claim', DRAW), /claims paused/);
  assert.throws(() => p.run(Number(r.end) - 1, 'claim', DRAW), /claims paused/);
  assert.throws(() => p.run(base + length(r), 'claim', DRAW), /claim window/);
  p.run(base + length(r) - 1, 'claim', DRAW);
});

test('unrelated and other-draw pauses never extend the deadline', () => {
  for (const [kind, scope] of [[DEPOSITS, 0n], [CLAIMS, DRAW + 1n], [DEPOSITS, DRAW]]) {
    const {p, base} = selected();
    pause(p, base - 1000, kind, scope, 3000);
    p.run(base - 1, 'claim', DRAW);
    const q = selected().p;
    pause(q, base - 1000, kind, scope, 3000);
    assert.throws(() => q.run(base, 'claim', DRAW), /claim window/);
  }
});

test('pauses entirely before selection or after the window extend nothing', () => {
  const {p, base, at} = selected();
  // Ends before the selection bucket begins: owner cannot backdate beyond the network time proof.
  assert.throws(() => p.run(base, 'pause', CLAIMS, 0n, bucketOf(at - 7200), 600n), /selection time/);
  pause(p, base + 5000, CLAIMS, 0n, 600);
  assert.throws(() => p.run(base, 'claim', DRAW), /claim window/);
});

test('early resume counts only the actual bucket-bounded blocked duration', () => {
  const {p, base} = selected();
  pause(p, base - 1000, CLAIMS, 0n, 20000);
  p.run(base - 500, 'resume', 0n, bucketOf(base - 500));
  const r = record(p, 0);
  assert.equal(Number(r.end), Math.floor((base - 500) / BUCKET) * BUCKET + BUCKET);
  assert.ok(length(r) <= 500 + 2 * BUCKET);
  assert.throws(() => p.run(Number(r.end) - 1, 'claim', DRAW), /claims paused/);
  assert.throws(() => p.run(base + length(r), 'claim', DRAW), /claim window/);
  p.run(base + length(r) - 1, 'claim', DRAW);
  assert.throws(() => p.run(base - 400, 'resume', 0n, bucketOf(base - 400)), /pause already expired/);
});

test('sequential claim pauses accumulate, including one starting inside the extension', () => {
  const {p, base} = selected();
  pause(p, base - 2000, CLAIMS, 0n, 500);
  const first = record(p, 0);
  // Begins after the original deadline but before the extended one.
  const secondStart = base + 200;
  assert.ok(secondStart < base + length(first) && secondStart >= Number(first.end));
  pause(p, secondStart, CLAIMS, DRAW, 400);
  const total = length(first) + length(record(p, 1));
  assert.throws(() => p.run(base + total, 'claim', DRAW), /claim window/);
  p.run(base + total - 1, 'claim', DRAW);
});

test('pause authority, bounds, ordering and history capacity are enforced', () => {
  const {p, base} = selected();
  p.setOwner(bytes(8));
  assert.throws(() => pause(p, base, CLAIMS, 0n, 600), /unauthorized pause/);
  p.setOwner(bytes(7));
  assert.throws(() => pause(p, base, CLAIMS, 0n, 0), /pause duration/);
  assert.throws(() => pause(p, base, CLAIMS, 0n, SCHEDULE.MAX_PAUSE + 1), /pause duration/);
  assert.throws(() => p.run(base, 'pause', CLAIMS, 0n, bucketOf(base) + 1n, 600n), /selection time/);
  pause(p, base, CLAIMS, 0n, SCHEDULE.MAX_PAUSE);
  assert.throws(() => pause(p, base + 1000, CLAIMS, 0n, 600), /must not overlap/);
  p.setOwner(bytes(8));
  assert.throws(() => p.run(base + 5, 'resume', 0n, bucketOf(base + 5)), /unauthorized pause/);
  p.setOwner(bytes(7));
  assert.throws(() => p.run(base + 5, 'resume', 1n, bucketOf(base + 5)), /unknown pause/);
  const limit = setup();
  let time = S;
  for (let i = 0; i < 4; i++) { pause(limit, time, DEPOSITS, 0n, 60); time += 300; }
  assert.throws(() => pause(limit, time, DEPOSITS, 0n, 60), /pause history full/);
});
