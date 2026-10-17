import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as Asset from '../../../managed/separated-asset/contract/index.js';
import * as Pool from '../../../managed/separated-pool/contract/index.js';
import { reconcileCustody } from '../reconciliation.mjs';
const bytes = (n) => new Uint8Array(32).fill(n);
function deploy(module, args = []) {
  const contract = new module.Contract({ owner: ({ privateState }) => [privateState, bytes(1)] });
  let state = contract.initialState(RT.createConstructorContext({}, '0'.repeat(64)), ...args).currentContractState;
  return {
    call: (name, ...a) => { state = contract.impureCircuits[name](RT.createCircuitContext(RT.sampleContractAddress(), '0'.repeat(64), state, {}), ...a).context.currentQueryContext.state; return module.ledger(state); },
    read: () => module.ledger(state),
  };
}
test('separated pool accepts a forged custody claim the asset contract does not hold', () => {
  const asset = deploy(Asset); const held = asset.call('seed').custody.value;
  const pool = deploy(Pool, [bytes(7)]);
  const forged = pool.call('recordSeed', 5000000n);
  assert.equal(held, 2000000n);
  assert.equal(forged.principalLiability, 5000000n);
  const view = reconcileCustody({ custody: { value: held }, principalLiability: forged.principalLiability, prizeReserve: forged.prizeReserve, prizeLiability: forged.prizeLiability });
  assert.equal(view.reconciled, false);
});
test('separated pool accepts any caller-supplied randomness result', () => {
  const pool = deploy(Pool, [bytes(7)]);
  assert.equal(pool.call('allocateYield', 424242n).prizeLiability, 100n);
  assert.equal(pool.call('allocateYield', 1n).prizeLiability, 200n);
});
