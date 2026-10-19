import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger} from '../../managed/timing-probe/contract/index.js';
import {ownerSecret,slotSecret} from './synthetic.mjs';

// Offline oracle: replay recorded transactions through the generated circuits at
// each transaction's finalized block time. Network status should equal the
// replay verdict; a mismatch means the network and local runtime disagree.
export function replay(records) {
  let slot = 0;
  const contract = new Contract({
    owner: ({privateState}) => [privateState, ownerSecret()],
    secret: ({privateState}) => [privateState, slotSecret(slot)],
  });
  let state = contract.initialState(RT.createConstructorContext({}, '0'.repeat(64))).currentContractState;
  const chainOrder = records.map((record, index) => ({record, index}))
    .filter(({record}) => record.blockTimestampMs != null)
    // The wallet lock serializes submissions, so within one block, record order is submission order.
    .sort((a, b) => a.record.blockHeight - b.record.blockHeight || a.index - b.index);
  const verdicts = new Map();
  for (const {record, index} of chainOrder) {
    slot = record.slot ?? 0;
    const time = Math.floor(record.blockTimestampMs / 1000);
    const context = RT.createCircuitContext(RT.sampleContractAddress(), '0'.repeat(64), state, {}, undefined, undefined, time);
    const args = record.args.map(value => BigInt(value));
    let verdict;
    try {
      const result = contract.impureCircuits[record.circuit](context, ...args);
      state = result.context.currentQueryContext.state;
      verdict = {predicted: 'SucceedEntirely'};
    } catch (error) {
      verdict = {predicted: 'FailEntirely', reason: String(error.message).replace(/^Error: /, '')};
    }
    verdicts.set(index, {...verdict, replayedAtSeconds: time, matchesNetwork: verdict.predicted === record.outcome});
  }
  return {verdicts: records.map((_, index) => verdicts.get(index) ?? null), finalState: ledger(state.data ?? state)};
}

// Attach each step's replay verdict and return the ids of steps whose network outcome contradicts
// their expectation (probes have none).
export function annotate(steps) {
  const {verdicts} = replay(steps);
  steps.forEach((record, index) => { record.replay = verdicts[index]; });
  return steps.filter(r => r.expected !== 'probe' && (r.outcome === 'SucceedEntirely') !== (r.expected === 'accept')).map(r => r.id);
}
