import test from 'node:test';
import assert from 'node:assert/strict';
import {replay, annotate} from './replay.mjs';
import {DRAW,S,E} from './harness.mjs';

const record = (circuit, args, slot, blockSeconds, outcome, extra = {}) => ({circuit, args: args.map(String), slot, blockTimestampMs: blockSeconds * 1000 + 1, blockHeight: blockSeconds, outcome, ...extra});

test('replay reproduces network verdicts from block time alone, including time-ambiguous failures', () => {
  const records = [
    record('commit', [DRAW, 0n], 0, S + 30, 'SucceedEntirely'),
    record('commit', [DRAW, 1n], 1, S + 719, 'SucceedEntirely'),
    record('commit', [DRAW, 3n], 3, S + 720, 'FailEntirely'),
    record('reveal', [DRAW, 0n], 0, E - 1, 'FailEntirely'),
    record('reveal', [DRAW, 0n], 0, E, 'SucceedEntirely'),
    record('reveal', [DRAW, 1n], 1, E + 299, 'SucceedEntirely'),
    record('reveal', [DRAW, 2n], 2, E + 300, 'FailEntirely'),
    record('commit', [DRAW, 2n], 2, E + 2000, 'SucceedEntirely'),
  ];
  const {verdicts} = replay(records);
  assert.deepEqual(verdicts.map(verdict => verdict?.matchesNetwork), [true, true, true, true, true, true, true, false]);
  assert.match(verdicts[2].reason, /commit window/);
  assert.match(verdicts[3].reason, /reveal window/);
  assert.equal(verdicts[2].replayedAtSeconds, S + 720);
});

test('transactions never included in a block have no replay verdict', () => {
  const {verdicts} = replay([{circuit: 'commit', args: [String(DRAW), '0'], slot: 0, blockTimestampMs: null, outcome: 'rejected-at-submission'}]);
  assert.deepEqual(verdicts, [null]);
});

test('annotating a run attaches each replay verdict and lists steps whose outcome contradicts the expectation', () => {
  const steps = [
    {id: 'ok', expected: 'accept', ...record('commit', [DRAW, 0n], 0, S + 30, 'SucceedEntirely')},
    {id: 'wrong', expected: 'reject', ...record('commit', [DRAW, 1n], 1, S + 60, 'SucceedEntirely')},
    {id: 'probe', expected: 'probe', ...record('commit', [DRAW, 2n], 2, S + 720, 'FailEntirely')},
    {id: 'unsent', expected: 'accept', circuit: 'commit', args: [String(DRAW), '3'], slot: 3, blockTimestampMs: null, outcome: 'rejected-before-block'},
  ];
  assert.deepEqual(annotate(steps), ['wrong', 'unsent']);
  assert.equal(steps[0].replay.matchesNetwork, true);
  assert.match(steps[2].replay.reason, /commit window/);
  assert.equal(steps[3].replay, null);
});
