import {fileURLToPath} from 'node:url';
import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emit, runIsolated} from './isolated.mjs';

// Genuine Preprod timing experiment. Parent: starts an isolated worker and
// prints only sanitized records. Worker: deploys the generated TimingProbe,
// then drives scheduled and forged-clock calls, recording block timestamps.
const EVIDENCE = new URL('./evidence/', import.meta.url);
const ABBREVIATE = hash => (typeof hash === 'string' ? hash : hash);

if (process.argv[2] === '--worker') {
  const [, , , envPath, mode, evidencePath] = process.argv;
  const {openSession, withWalletLock, providerClock, artifactHashes, sha256, errorClass} = await import('./network-session.mjs');
  const {errorDetail} = await import('./wallet.mjs');
  const {SCHEDULE} = await import('./schedule.mjs');
  const {replay} = await import('./replay.mjs');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const BUCKET = SCHEDULE.BUCKET;
  const evidence = {format: 'shroudly-timing-network-experiment-v1', mode, schedule: SCHEDULE, steps: [], notes: []};
  const save = () => writeFileSync(evidencePath, JSON.stringify(evidence, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  let session;
  try {
    session = await openSession(envPath);
    const {providers, compiled, contracts, module, control, publicDataProvider, provider} = session;
    const clock = await providerClock(provider);
    evidence.providerClockOffsetMs = clock.offsetMs;
    const dust = session.opened.state.dust.balance(new Date());
    evidence.dustBalanceBeforeRun = dust.toString();
    emit({stage: 'session-ready', dustPositive: dust > 0n});

    const waitUntil = async seconds => { const ms = (seconds - clock.now()) * 1000; if (ms > 0) await sleep(ms); };
    const bucketAt = seconds => BigInt(Math.floor(seconds / BUCKET));

    // Deploy under the wallet lock.
    const deployed = await withWalletLock(async () => {
      control.slot = 0;
      const result = await contracts.deployContract(providers, {compiledContract: compiled, args: []});
      return result;
    }, () => emit({stage: 'waiting-for-wallet-lock', for: 'deploy'}));
    const address = deployed.deployTxData.public.contractAddress ?? deployed.address;
    evidence.contractAddress = typeof address === 'string' ? address : Buffer.from(address.bytes ?? address).toString('hex');
    evidence.deployment = {txHash: deployed.deployTxData.public.txHash, blockHash: deployed.deployTxData.public.blockHash, blockHeight: deployed.deployTxData.public.blockHeight, blockTimestampMs: deployed.deployTxData.public.blockTimestamp, status: deployed.deployTxData.public.status};
    save();
    emit({stage: 'deployed', txHash: evidence.deployment.txHash, blockHeight: evidence.deployment.blockHeight});

    const readLedger = async () => {
      const states = await contracts.getPublicStates(publicDataProvider, evidence.contractAddress);
      return module.ledger(states.contractState.data ?? states.contractState);
    };
    const step = async ({id, circuit, args, slot = 0, forge, at, expect, note}) => {
      // Preparation (lock, evaluation, proof, balancing) happens before the target. An honest
      // step evaluates against real network time, so its target sits at least 45 s inside its
      // window: evaluation then runs no earlier than 20 s after the window opens.
      await waitUntil(at - 25);
      const record = {id, circuit, args: args.map(String), slot, forgedClockSeconds: forge ?? null, targetSeconds: at, expected: expect, note};
      // Run 4 slept through its claim target (macOS idle sleep); flag any step that woke late so the
      // outcome is not read as network behaviour.
      const lateBy = clock.now() - (at - 25);
      if (lateBy > 10) record.lateStartSeconds = +lateBy.toFixed(1);
      // Run 5's lid closed mid-run: every later step was minutes late and failed in cascade. Stop
      // rather than spend DUST on steps whose timing no longer means anything.
      if (lateBy > 120) {
        record.outcome = 'not-run'; evidence.steps.push(record); save();
        throw Error(`host stalled: step ${id} started ${Math.round(lateBy)} s late (sleep or provider outage)`);
      }
      await withWalletLock(async lockWaitMs => {
        record.lockWaitMs = lockWaitMs;
        control.forgedSeconds = forge; control.slot = slot;
        control.gate = async () => { await waitUntil(at); record.submittedAtSeconds = +clock.now().toFixed(3); };
        try {
          const submitted = await contracts.submitCallTxAsync(providers, {compiledContract: compiled, contractAddress: evidence.contractAddress, circuitId: circuit, args});
          control.forgedSeconds = undefined;
          record.txId = submitted.txId;
          const data = await Promise.race([publicDataProvider.watchForTxData(submitted.txId), sleep(240000).then(() => { throw Error('finality watch timeout'); })]);
          record.observedFinalizedAtSeconds = +clock.now().toFixed(3);
          Object.assign(record, {outcome: data.status, txHash: data.txHash, blockHash: data.blockHash, blockHeight: data.blockHeight, blockTimestampMs: data.blockTimestamp});
        } catch (error) {
          record.outcome = record.txId ? 'finality-unobserved' : 'rejected-before-block';
          record.errorClass = errorClass(error); record.errorDetail = errorDetail(error);
        } finally { record.wallet = control.walletView ?? null; control.walletView = undefined; control.forgedSeconds = undefined; control.gate = undefined; }
      }, () => emit({stage: 'waiting-for-wallet-lock', for: id}));
      evidence.steps.push(record);
      save();
      emit({step: id, outcome: record.outcome, expected: expect, blockTimestampMs: record.blockTimestampMs ?? null, submittedAtSeconds: record.submittedAtSeconds ?? null, errorClass: record.errorClass, errorDetail: record.errorDetail});
      return record;
    };
    // Local evaluation runs from target - 25 and inclusion lands a few seconds after the target; both
    // must fall in the stated bucket. Run 4's D2.finalize at second :55 failed this locally.
    const honestBucketAt = target => {
      if (bucketAt(target - 25) !== bucketAt(target + 8)) throw Error(`honest bucket target ${target} straddles a bucket boundary`);
      return bucketAt(Math.max(target, clock.now() + 25) + 8);
    };

    if (mode === 'smoke') {
      const t = clock.now();
      let S0 = Math.floor(t / 900) * 900;
      if (t + 40 > S0 + 700) S0 += 900;
      const Dn = BigInt(S0 / 900);
      const first = await step({id: 'smoke.commit', circuit: 'commit', args: [Dn, 0n], slot: 0, at: Math.max(t + 40, S0 + 45), expect: 'accept'});
      await step({id: 'smoke.commit.forgedPrevious', circuit: 'commit', args: [Dn - 1n, 0n], slot: 0, at: Math.max(t, first.submittedAtSeconds ?? t) + 30, forge: S0 - 900 + 60, expect: 'reject'});
      const { verdicts } = replay(evidence.steps);
      evidence.steps.forEach((record, index) => { record.replay = verdicts[index]; });
      evidence.mismatches = evidence.steps.filter(r => r.expected !== 'probe' && (r.outcome === 'SucceedEntirely') !== (r.expected === 'accept')).map(r => r.id);
      evidence.completed = true; save(); emit({done: true, smoke: true, mismatches: evidence.mismatches});
      process.exit(evidence.mismatches.length ? 1 : 0);
    }

    // ---- Schedule: draw D starts at the next UTC quarter-hour at least five minutes away.
    const now0 = clock.now();
    const S = Math.ceil((now0 + 330) / 900) * 900;
    const D = BigInt(S / 900);
    const E = S + 900;
    const D2 = D + 1n;
    evidence.plan = {S, E, draw: D.toString(), draw2: D2.toString(), plannedAtSeconds: +now0.toFixed(3)};
    save();
    emit({stage: 'planned', S, secondsUntilStart: Math.round(S - now0)});

    await step({id: 'D.commit.slot0', circuit: 'commit', args: [D, 0n], slot: 0, at: S + 45, expect: 'accept', note: 'honest commit inside weighting interval'});
    await step({id: 'D.commit.slot2', circuit: 'commit', args: [D, 2n], slot: 2, at: S + 90, expect: 'accept', note: 'honest commit; this slot never reveals in time'});
    await step({id: 'Dprev.commit.slot0.forged', circuit: 'commit', args: [D - 1n, 0n], slot: 0, at: S + 120, forge: S - 900 + 60, expect: 'reject', note: 'forged browser clock claims the previous interval; real network time is after its cutoff'});
    // Run 1 (2026-10-18) had a commit submitted 9 s before the cutoff rejected by the node (1010 custom
    // error 104), so the honest boundary commit keeps 60 s; D2's spare slots probe 40 s and 15 s.
    await step({id: 'D.commit.slot1.boundary', circuit: 'commit', args: [D, 1n], slot: 1, at: S + 720 - 60, expect: 'accept', note: 'honest commit 60 s before the three-minute commit cutoff'});
    await step({id: 'D.commit.slot3.late', circuit: 'commit', args: [D, 3n], slot: 3, at: S + 720 + 4, forge: S + 300, expect: 'reject', note: 'forged clock inside window, real network time past cutoff'});
    await step({id: 'D.commit.slot3.late2', circuit: 'commit', args: [D, 3n], slot: 3, at: S + 720 + 70, forge: S + 300, expect: 'reject', note: 'second late commitment'});
    await step({id: 'D.reveal.slot0.early', circuit: 'reveal', args: [D, 0n], slot: 0, at: E - 40, forge: E + 50, expect: 'reject', note: 'reveal before weighting closes; run 2 at E-8 was included at E+12, so this keeps 40 s'});
    await step({id: 'D.reveal.slot0', circuit: 'reveal', args: [D, 0n], slot: 0, at: E + 45, expect: 'accept', note: 'honest reveal'});
    await step({id: 'D.reveal.slot1', circuit: 'reveal', args: [D, 1n], slot: 1, at: E + 90, expect: 'accept', note: 'honest reveal'});
    const earlyForge = E + 330;
    await step({id: 'D.finalize.early', circuit: 'finalize', args: [D, bucketAt(earlyForge)], at: E + 150, forge: earlyForge, expect: 'reject', note: 'forged clock past the reveal window; real network time is inside it'});
    await step({id: 'D.reveal.slot2.late', circuit: 'reveal', args: [D, 2n], slot: 2, at: E + 315, forge: E + 100, expect: 'reject', note: 'late reveal with forged in-window clock'});
    const forgedBucketTime = E + 350;
    await step({id: 'D.finalize.forgedBucket', circuit: 'finalize', args: [D, bucketAt(forgedBucketTime + 3600)], at: forgedBucketTime, forge: forgedBucketTime + 3600, expect: 'reject', note: 'caller asserts a selection time an hour in the future'});
    const finalizeAt = E + 395;
    await step({id: 'D.finalize', circuit: 'finalize', args: [D, honestBucketAt(finalizeAt)], at: finalizeAt, expect: 'accept', note: 'honest finalization after the reveal window'});
    const selection = evidence.steps.at(-1);
    emit({stage: 'finalized', outcome: selection.outcome});

    // ---- Draw D2 runs in parallel with D's claim window.
    await step({id: 'D2.commit.slot0', circuit: 'commit', args: [D2, 0n], slot: 0, at: E + 470, expect: 'accept'});
    await step({id: 'D2.commit.slot1', circuit: 'commit', args: [D2, 1n], slot: 1, at: E + 520, expect: 'accept'});
    const pauseAt = E + 575;
    await step({id: 'D.pause.claims', circuit: 'pause', args: [1n, D, honestBucketAt(pauseAt), 240n], at: pauseAt, expect: 'accept', note: 'claim-blocking pause scoped to draw D only'});
    await step({id: 'D.claim.duringPause', circuit: 'claim', args: [D], at: E + 640, forge: E + 450, expect: 'reject', note: 'forged pre-pause clock; real network time is inside the pause'});
    await step({id: 'D2.commit.slot2.cutoffProbe40', circuit: 'commit', args: [D2, 2n], slot: 2, at: E + 720 - 40, expect: 'probe', note: 'margin probe: honest commit 40 s before the cutoff'});
    await step({id: 'D2.commit.slot3.cutoffProbe15', circuit: 'commit', args: [D2, 3n], slot: 3, at: E + 720 - 15, expect: 'probe', note: 'margin probe: honest commit 15 s before the cutoff'});
    const depositsAt = E + 880;
    await step({id: 'D.pause.deposits', circuit: 'pause', args: [2n, 0n, honestBucketAt(depositsAt), 120n], at: depositsAt, expect: 'accept', note: 'unrelated pause: must not extend any claim deadline'});
    await step({id: 'D2.reveal.slot0', circuit: 'reveal', args: [D2, 0n], slot: 0, at: E + 945, expect: 'accept'});
    await step({id: 'D2.reveal.slot1', circuit: 'reveal', args: [D2, 1n], slot: 1, at: E + 990, expect: 'accept'});
    const finalize2At = E + 1200 + 35;
    await step({id: 'D2.finalize', circuit: 'finalize', args: [D2, honestBucketAt(finalize2At)], at: finalize2At, expect: 'accept'});

    // ---- Claim deadlines are derived from fresh ledger reads, never from the harness's own clock.
    const state = await readLedger();
    // D2 may fail to finalize; keep measuring D's claim window rather than crash on the missing cell.
    if (!state.selectedAt.member(D) || !state.pauses.member(0n)) throw Error('draw D did not finalize or the claims pause is missing; claim deadlines cannot be measured');
    const selectedD = Number(state.selectedAt.lookup(D)), selectedD2 = state.selectedAt.member(D2) ? Number(state.selectedAt.lookup(D2)) : null;
    const base = selected => selected + SCHEDULE.BUCKET + SCHEDULE.FINALITY_ALLOWANCE + SCHEDULE.CLAIM;
    const pauseRecord = state.pauses.lookup(0n);
    const extension = Math.max(0, Number(pauseRecord.end) - Math.max(Number(pauseRecord.start), selectedD));
    evidence.deadlines = {selectedD, selectedD2, baseD: base(selectedD), baseD2: selectedD2 === null ? null : base(selectedD2), claimPause: {start: Number(pauseRecord.start), end: Number(pauseRecord.end), extension}, extendedD: base(selectedD) + extension};
    save();
    emit({stage: 'deadlines', ...evidence.deadlines});

    const claimDAt = evidence.deadlines.extendedD - 14;
    await step({id: 'D.claim.afterBaseDeadline', circuit: 'claim', args: [D], at: claimDAt, expect: 'accept', note: 'targets block time after the base deadline but just before the pause-extended deadline'});
    if (selectedD2 === null) evidence.notes.push('D2 did not finalize, so D2.claim.pastBaseDeadline was not run');
    else await step({id: 'D2.claim.pastBaseDeadline', circuit: 'claim', args: [D2], at: evidence.deadlines.baseD2 + 12, forge: evidence.deadlines.baseD2 - 200, expect: 'reject', note: 'draw D2 was never paused for claims: scoped pause and unrelated pause give no grace'});

    // ---- Offline replay against recorded block times, plus operations exposed by the deployed contract.
    const { verdicts } = replay(evidence.steps);
    evidence.steps.forEach((record, index) => { record.replay = verdicts[index]; });
    const states = await contracts.getPublicStates(publicDataProvider, evidence.contractAddress);
    evidence.deployedOperations = states.contractState.operations ? [...states.contractState.operations()].map(String).sort() : null;
    evidence.sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    evidence.artifactHashes = artifactHashes();
    evidence.mismatches = evidence.steps.filter(r => r.expected !== 'probe' && (r.outcome === 'SucceedEntirely') !== (r.expected === 'accept')).map(r => r.id);
    evidence.completed = true;
    save();
    emit({done: true, mismatches: evidence.mismatches});
    if (evidence.mismatches.length) process.exitCode = 1;
  } catch (error) {
    evidence.failure = errorClass(error); save(); process.exitCode = 1;
    emit({done: false, error: errorClass(error), detail: errorDetail(error)});
  } finally { await session?.close().catch(() => {}); process.exit(); }
} else {
  const [envPath, mode = 'full', name = `network-${mode}.json`] = process.argv.slice(2);
  if (!envPath) throw Error('Pass the protected local environment file path');
  mkdirSync(EVIDENCE, {recursive: true});
  const out = fileURLToPath(new URL(name, EVIDENCE));
  const { code, tainted } = await runIsolated(fileURLToPath(import.meta.url), [envPath, mode, out], 4 * 3600 * 1000, record => console.log(JSON.stringify(record)));
  process.exitCode = code || tainted ? 1 : 0;
}
