import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract} from '../../managed/timing-probe/contract/index.js';
import {forgingContract} from './forging.mjs';
import {DRAW, S, bytes} from './harness.mjs';

// midnight-js-contracts (compact-js ContractExecutable) evaluates calls through
// provableCircuits with a context whose block time is the local wall clock. A
// dishonest client controls exactly that value; the forging contract models it.
const prepare = control => {
  const Forging = forgingContract(Contract, control);
  const contract = new Forging({owner: ({privateState}) => [privateState, bytes(7)], secret: ({privateState}) => [privateState, bytes(1)]});
  const state = contract.initialState(RT.createConstructorContext({}, '0'.repeat(64))).currentContractState;
  const realClockContext = () => RT.createCircuitContext(RT.sampleContractAddress(), '0'.repeat(64), state, {}, undefined, undefined, S - 5000);
  return {contract, realClockContext};
};

test('a forged client clock is what the provable circuit evaluates against', () => {
  const control = {forgedSeconds: S + 5};
  const {contract, realClockContext} = prepare(control);
  const result = contract.provableCircuits.commit(realClockContext(), DRAW, 0n);
  assert.equal(result.context.currentQueryContext.block.secondsSinceEpoch, BigInt(S + 5));
});

test('without forgery the provable circuit evaluates at the real clock', () => {
  const {contract, realClockContext} = prepare({forgedSeconds: undefined});
  assert.throws(() => contract.provableCircuits.commit(realClockContext(), DRAW, 0n), /commit window/);
});
