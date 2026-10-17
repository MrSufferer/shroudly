import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract} from '../../managed/timing-probe/contract/index.js';
import {S} from './harness.mjs';

// The node supplies secondsSinceEpochErr with every block time. Record how the
// generated predicates treat it so the margin proposal does not assume either way.
function commitAt(time, err) {
  const contract = new Contract({owner: ({privateState}) => [privateState, new Uint8Array(32)], secret: ({privateState}) => [privateState, new Uint8Array(32)]});
  const state = contract.initialState(RT.createConstructorContext({}, '0'.repeat(64))).currentContractState;
  const context = RT.createCircuitContext(RT.sampleContractAddress(), '0'.repeat(64), state, {}, undefined, undefined, time);
  context.currentQueryContext.block = {...context.currentQueryContext.block, secondsSinceEpochErr: err};
  try { contract.impureCircuits.commit(context, 2_000_000n, 0n); return true; } catch { return false; }
}

test('the local runtime evaluates predicates on the supplied block time and ignores the error field', () => {
  const offsets = [-31, -1, 0, 1, 719, 720, 750];
  const expected = offsets.map(offset => offset >= 0 && offset < 720);
  for (const err of [0, 5, 30]) assert.deepEqual(offsets.map(offset => commitAt(S + offset, err)), expected);
});
