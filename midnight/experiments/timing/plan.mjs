// Pure scheduling helpers for run-experiment.mjs, kept free of SDK imports so they test offline.

// Local evaluation can start up to 25 s before inclusion, and inclusion has taken up to 25 s after
// submission. Run 4's D2.finalize at second :55 failed locally because these straddled a boundary.
export const INCLUSION_LATENCY = 25;

// Bucket for an honest step planned at `target` and starting at `now`. A late start is checked from
// the time it actually starts, so a step that woke late cannot claim a bucket it will miss.
export function honestBucket(target, now, bucket) {
  const at = Math.max(target, now + INCLUSION_LATENCY);
  const of = seconds => BigInt(Math.floor(seconds / bucket));
  if (of(at - INCLUSION_LATENCY) !== of(at + INCLUSION_LATENCY)) throw Error(`honest bucket target ${at} straddles a bucket boundary`);
  return of(at);
}

// The after-base-deadline claim keeps a full bucket of lead before the extended deadline, so slow
// inclusion still lands inside it, and must still land past the base deadline to test the extension.
export const CLAIM_LEAD = 60;

// Claim deadlines for a draw selected at `selected` with one claims pause, mirroring the contract's
// extendFor fold: the pause extends the deadline by the part of it after selection.
export function claimDeadlines(selected, pause, schedule) {
  const start = Number(pause.start), end = Number(pause.end);
  const baseD = selected + schedule.BUCKET + schedule.FINALITY_ALLOWANCE + schedule.CLAIM;
  const begin = Math.max(start, selected);
  const extension = begin < baseD ? Math.max(0, end - begin) : 0;
  const extendedD = baseD + extension;
  const claimAt = extendedD - CLAIM_LEAD;
  if (claimAt <= baseD) throw Error(`claim target ${claimAt} is not past the base deadline ${baseD}; the claims pause is too short`);
  return {baseD, claimPause: {start, end, extension}, extendedD, claimAt};
}

// Smoke mode commits at t + 40; it rolls to the next interval unless that lands 60 s before the
// commit cutoff (S + 720), the margin run 1 showed honest boundary commits need.
export function smokeInterval(t, interval = 900) {
  const start = Math.floor(t / interval) * interval;
  return t + 40 > start + 660 ? start + interval : start;
}

// Run `work` under the wallet lock, measuring lateness once the lock is held: a step that waited
// minutes for another run's lock is as stale as one the host slept through. Run 4 slept through its
// claim target; run 5's closed lid made every later step minutes late and fail in cascade.
export async function lockedStep({id, at, clock, lock, record, work, flagSeconds = 10, stallSeconds = 120}) {
  return lock(async lockWaitMs => {
    record.lockWaitMs = lockWaitMs;
    const lateBy = clock.now() - (at - 25);
    if (lateBy > flagSeconds) record.lateStartSeconds = +lateBy.toFixed(1);
    if (lateBy > stallSeconds) {
      record.outcome = 'not-run';
      throw Error(`host stalled: step ${id} started ${Math.round(lateBy)} s late (sleep, provider outage or wallet lock wait)`);
    }
    return work(lockWaitMs);
  });
}

// Wait for the indexer to report a submitted transaction. A watch that outlives `timeoutMs` is not
// treated as an outcome: the step keeps waiting up to `resolveMs` more, because the transaction may
// still finalize and spend wallet coins (a run that moved on double-spent its DUST view). If it never
// resolves, the run aborts and keeps the wallet lock; a dead owner's lock is reclaimable.
export async function awaitFinality(watch, {timeoutMs = 240000, resolveMs = 1200000, timers = globalThis} = {}) {
  const within = ms => {
    let handle;
    const timeout = new Promise(resolve => { handle = timers.setTimeout(() => resolve(TIMEOUT), ms); });
    return Promise.race([watch, timeout]).finally(() => timers.clearTimeout(handle));
  };
  const first = await within(timeoutMs);
  if (first !== TIMEOUT) return {data: first, resolvedAfterTimeout: false};
  const second = await within(resolveMs);
  if (second !== TIMEOUT) return {data: second, resolvedAfterTimeout: true};
  throw Object.assign(Error(`finality unresolved after ${Math.round((timeoutMs + resolveMs) / 1000)} s; aborting the run`), {abortRun: true, holdLock: true});
}
const TIMEOUT = Symbol('timeout');

// The facade's submitTransaction resolves only once the node's Finalized subscription reports the
// transaction, and that subscription can stall after the transaction lands (run 7 hung holding the
// wallet lock with its first step already in a block). Node rejections throw promptly, so a submission
// still pending after `timeoutMs` was accepted: return its identifier and let awaitFinality settle it
// through the indexer. A timed-out submission must not be reverted, because it may still spend DUST.
// Run 8's D.reveal.slot1 landed 6 s after submission, yet the wallet threw a ParseError on the node's
// reply (no blockNumber); `unknownOutcome` marks such errors as landed-or-not rather than rejected.
export async function boundedSubmit(submit, tx, {timeoutMs = 180000, timers = globalThis, unknownOutcome = () => false} = {}) {
  const id = transactionId(tx);
  let handle;
  const timeout = new Promise(resolve => { handle = timers.setTimeout(() => resolve(TIMEOUT), timeoutMs); });
  const pending = submit(tx);
  pending.catch(() => {});
  let result;
  try { result = await Promise.race([pending, timeout]); } catch (error) {
    if (unknownOutcome(error)) return {id, stalled: 'unparsed-reply'};
    throw error;
  } finally { timers.clearTimeout(handle); }
  if (result !== TIMEOUT) return {id: result, stalled: false};
  return {id, stalled: 'timeout'};
}

// Same rule as finalizedTransactionId in scripts/midnight-deploy-preprod.mjs: the first non-empty
// identifier, never the hash.
export function transactionId(tx) {
  const identifiers = typeof tx?.identifiers === 'function' ? tx.identifiers() : tx?.identifiers;
  const id = Array.isArray(identifiers) ? identifiers.find(value => typeof value === 'string' ? value.length > 0 : value != null) : undefined;
  if (id == null) throw Error('transaction has no identifier to watch');
  return String(id);
}

// Network clock from the provider's HTTP Date header (median of five samples). A missing or
// unparseable header throws: a NaN offset would silently make every scheduled step fire at once.
export async function providerClock(provider, {samples = 5, pauseMs = 300} = {}) {
  const offsets = [];
  for (let i = 0; i < samples; i++) {
    const local = Date.now();
    const {date} = await provider.rpc('system_chain');
    const remote = typeof date === 'string' ? Date.parse(date) : NaN;
    if (!Number.isFinite(remote)) throw Error(`provider response has no usable Date header (${date === null || date === undefined ? 'missing' : 'unparseable'})`);
    offsets.push(remote + 500 - (local + Date.now()) / 2); // Date header floors to whole seconds
    if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
  }
  offsets.sort((a, b) => a - b);
  const offset = offsets[Math.floor(offsets.length / 2)];
  return {offsetMs: Math.round(offset), now: () => (Date.now() + offset) / 1000};
}
