import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger} from '../../managed/timing-probe/contract/index.js';
import {SCHEDULE} from './schedule.mjs';

// Offline harness over the generated circuits. Network time is the QueryContext
// block time (what a node supplies on chain); no helper here computes timing rules.
export const DRAW = 2_000_000n;        // interval [1.8e9, 1.8e9 + 900), a UTC quarter-hour boundary
export const S = Number(DRAW * 900n);
export const E = S + 900;
export const bytes = n => new Uint8Array(32).fill(n);
export const bucketOf = time => BigInt(Math.floor(time / SCHEDULE.BUCKET));

export function setup() {
  let secret = bytes(1);
  let owner = bytes(7);
  const contract = new Contract({
    owner: ({privateState}) => [privateState, owner],
    secret: ({privateState}) => [privateState, secret],
  });
  let state = contract.initialState(RT.createConstructorContext({}, '0'.repeat(64))).currentContractState;
  const run = (time, name, ...args) => {
    const context = RT.createCircuitContext(RT.sampleContractAddress(), '0'.repeat(64), state, {}, undefined, undefined, time);
    const result = contract.impureCircuits[name](context, ...args);
    state = result.context.currentQueryContext.state;
    return result;
  };
  return {run, read: () => ledger(state), setSecret: v => (secret = v), setOwner: v => (owner = v)};
}

export function revealed(p, count = 2) {
  for (let who = 0; who < count; who++) p.run(S + who, 'commit', DRAW, BigInt(who));
  for (let who = 0; who < count; who++) p.run(E + who, 'reveal', DRAW, BigInt(who));
}
