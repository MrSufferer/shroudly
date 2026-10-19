import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEDULE} from './schedule.mjs';
import {DRAW, S, E, setup, revealed} from './harness.mjs';
import {honestBucket, claimDeadlines, smokeInterval, lockedStep, awaitFinality, providerClock} from './plan.mjs';

const {BUCKET} = SCHEDULE;

test('an honest bucket covers local evaluation 25 s before the target and 25 s of inclusion after it', () => {
  // E is a bucket boundary; offsets 25..34 keep [target - 25, target + 25] inside one bucket.
  assert.equal(honestBucket(E + 390, E, BUCKET), BigInt((E + 360) / BUCKET));
  assert.equal(honestBucket(E + 385, E, BUCKET), BigInt((E + 360) / BUCKET));
  for (const offset of [395, 380, 400, 340]) assert.throws(() => honestBucket(E + offset, E, BUCKET), /straddles/);
});

test('a late start is checked from the time it actually starts, not from the planned target', () => {
  // Planned for E + 390 but starting at E + 375: evaluation from E + 375, inclusion up to E + 425.
  assert.throws(() => honestBucket(E + 390, E + 375, BUCKET), /straddles/);
  assert.throws(() => honestBucket(E + 390, E + 370, BUCKET), /straddles/);
  // A little late still fits the planned bucket; much later moves to the next bucket that fits.
  assert.equal(honestBucket(E + 390, E + 366, BUCKET), BigInt((E + 360) / BUCKET));
  assert.equal(honestBucket(E + 390, E + 425, BUCKET), BigInt((E + 420) / BUCKET));
  assert.equal(honestBucket(S + 30, S + 5, BUCKET), BigInt(S / BUCKET));
});

// The full plan finalizes D at E + 390 and pauses its claims at E + 570 for 240 s.
function plannedD() {
  const p = setup();
  revealed(p);
  p.run(E + 390, 'finalize', DRAW, honestBucket(E + 390, E, BUCKET));
  p.run(E + 570, 'pause', 1n, DRAW, honestBucket(E + 570, E, BUCKET), 240n);
  const state = p.read();
  return {p, selected: Number(state.selectedAt.lookup(DRAW)), pause: state.pauses.lookup(0n)};
}

test('the after-base-deadline claim targets 60 s before the extended deadline and still past the base deadline', () => {
  const {p, selected, pause} = plannedD();
  const d = claimDeadlines(selected, pause, SCHEDULE);
  // Selected at E + 360; base = E + 360 + 60 + 120 + 3600; the pause runs E + 600 .. E + 840.
  assert.deepEqual(d, {baseD: E + 4140, claimPause: {start: E + 600, end: E + 840, extension: 240}, extendedD: E + 4380, claimAt: E + 4320});
  // Inclusion anywhere in the 60 s lead still lands inside the extended window.
  assert.throws(() => plannedD().p.run(d.extendedD, 'claim', DRAW), /claim window/);
  p.run(d.claimAt + 59, 'claim', DRAW);
});

test('a claim plan refuses a pause too short to put the claim past the base deadline with a 60 s lead', () => {
  const {selected} = plannedD();
  assert.throws(() => claimDeadlines(selected, {start: BigInt(E + 600), end: BigInt(E + 660)}, SCHEDULE), /base deadline/);
});

test('smoke mode rolls to the next interval unless its first commit lands by 60 s before the commit cutoff', () => {
  // The commit cutoff is S + 720 and the first commit targets t + 40.
  assert.equal(smokeInterval(S + 3), S);
  assert.equal(smokeInterval(S + 620), S);
  assert.equal(smokeInterval(S + 621), S + 900);
  assert.equal(smokeInterval(S + 650), S + 900);
  assert.equal(smokeInterval(S + 899), S + 900);
});

// A wallet lock held by another run for `holdSeconds`, on a fake clock.
function slowLock(clock, holdSeconds) {
  return async work => { clock.t += holdSeconds; return work(holdSeconds * 1000); };
}

test('lateness is measured after the wallet lock is acquired, so a long lock wait stops the run', async () => {
  const clock = {t: 1000, now() { return this.t; }};
  const record = {};
  let ran = false;
  await assert.rejects(lockedStep({id: 'x', at: 1025, clock, lock: slowLock(clock, 200), record, work: async () => { ran = true; }}), /host stalled: step x started 200 s late/);
  assert.equal(ran, false);
  assert.equal(record.outcome, 'not-run');
  assert.equal(record.lateStartSeconds, 200);
});

test('a short lock wait is flagged as a late start but the step still runs', async () => {
  const clock = {t: 1000, now() { return this.t; }};
  const record = {};
  const result = await lockedStep({id: 'x', at: 1025, clock, lock: slowLock(clock, 15), record, work: async waitMs => `ran after ${waitMs}`});
  assert.equal(result, 'ran after 15000');
  assert.equal(record.lateStartSeconds, 15);
  assert.equal(record.lockWaitMs, 15000);
  const onTime = {};
  await lockedStep({id: 'y', at: 1040, clock, lock: slowLock(clock, 0), record: onTime, work: async () => {}});
  assert.equal(onTime.lateStartSeconds, undefined);
});

// Timers that record which handles are still live.
function trackedTimers() {
  const live = new Set();
  return {
    live,
    setTimeout(fn, ms) { const h = setTimeout(() => { live.delete(h); fn(); }, ms); live.add(h); return h; },
    clearTimeout(h) { live.delete(h); clearTimeout(h); },
  };
}
const after = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));

test('a finality watch that resolves in time clears its timeout', async () => {
  const timers = trackedTimers();
  const result = await awaitFinality(after(5, {status: 'SucceedEntirely'}), {timeoutMs: 1000, resolveMs: 1000, timers});
  assert.deepEqual(result, {data: {status: 'SucceedEntirely'}, resolvedAfterTimeout: false});
  assert.equal(timers.live.size, 0);
});

test('after a finality timeout the step keeps waiting for the indexer to resolve the transaction', async () => {
  const timers = trackedTimers();
  const result = await awaitFinality(after(40, {status: 'FailEntirely'}), {timeoutMs: 10, resolveMs: 1000, timers});
  assert.deepEqual(result, {data: {status: 'FailEntirely'}, resolvedAfterTimeout: true});
  assert.equal(timers.live.size, 0);
});

test('a transaction the indexer never resolves aborts the run and keeps the wallet lock', async () => {
  const timers = trackedTimers();
  const error = await awaitFinality(new Promise(() => {}), {timeoutMs: 10, resolveMs: 20, timers}).then(() => null, e => e);
  assert.match(error.message, /finality unresolved/);
  assert.equal(error.abortRun, true);
  assert.equal(error.holdLock, true);
  assert.equal(timers.live.size, 0);
});

const dated = date => ({rpc: async () => ({result: 'Midnight Preprod', date})});

test('the provider clock refuses a response without a usable Date header', async () => {
  await assert.rejects(providerClock(dated(null), {pauseMs: 0}), /Date header/);
  await assert.rejects(providerClock(dated('not a date'), {pauseMs: 0}), /Date header/);
});

test('the provider clock offset comes from the Date header', async () => {
  const ahead = new Date(Date.now() + 3_600_000).toUTCString();
  const clock = await providerClock(dated(ahead), {pauseMs: 0});
  // The header floors to whole seconds; the clock assumes mid-second, so the offset is within 1 s.
  assert.ok(Math.abs(clock.offsetMs - 3_600_000) <= 1000, String(clock.offsetMs));
  assert.ok(Math.abs(clock.now() - (Date.now() + 3_600_000) / 1000) <= 1);
});
