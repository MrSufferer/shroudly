import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/public-retirement/contract/index.js';

export const TMIX = 1_000_000n;
const COIN = '0'.repeat(64);

// Thin driver over the generated contract. Synthetic credentials only; never reads a wallet.
export function createPool({start, cohort = 5n, address = RT.sampleContractAddress()}) {
  let now = start;
  let state;
  let active; // the wallet whose private state the witnesses read during a call
  const witnesses = {
    secret: ({privateState}) => [privateState, active.secret],
    balance: ({privateState}) => [privateState, active.balance],
    amount: ({privateState}) => [privateState, active.pendingAmount],
  };
  const contract = new Contract(witnesses);
  const initial = contract.initialState(RT.createConstructorContext({}, COIN), BigInt(start), cohort).currentContractState;
  state = initial.data;
  const bucket = () => BigInt(Math.floor((now - start) / 60));
  // Private state keeps every note opening: claims for unresolved intervals need the historic balance.
  const liveNoteOf = wallet => {
    const tag = pureCircuits.identityTag(wallet.secret);
    const live = ledger(state).liveNote;
    return live.member(tag) ? live.lookup(tag) : undefined;
  };
  const track = wallet => {
    wallet.note = liveNoteOf(wallet);
    if (wallet.note !== undefined) wallet.openings[wallet.note] = wallet.balance;
    wallet.store?.commit();
  };
  // A durable wallet journals its intent before the transaction is built (ADR 0029).
  const journal = (wallet, circuit, amount) => {
    wallet.store?.begin({circuit, amount});
    wallet.pendingAmount = amount;
  };
  const call = (circuit, wallet, ...args) => {
    active = wallet;
    const ctx = RT.createCircuitContext(address, COIN, state, {}, undefined, undefined, now);
    const before = ctx.currentQueryContext; // the reference context a transaction is built against
    const result = contract.impureCircuits[circuit](ctx, ...args);
    state = result.context.currentQueryContext.state;
    return {...result, before};
  };
  return {
    at(time) { now = time; },
    initialContractState() { return initial; },
    participant(n) { return {secret: new Uint8Array(32).fill(n), balance: 0n, openings: {}}; },
    enroll(wallet, amt) {
      journal(wallet, 'enroll', amt);
      const result = call('enroll', wallet, bucket());
      wallet.balance = amt;
      track(wallet);
      return result;
    },
    contribute(wallet, amt) {
      journal(wallet, 'contribute', amt);
      const result = call('contribute', wallet, bucket());
      wallet.balance += amt;
      track(wallet);
      return result;
    },
    withdraw(wallet, amt) {
      journal(wallet, 'withdraw', amt);
      const result = call('withdraw', wallet, bucket());
      wallet.balance -= amt;
      track(wallet);
      return result;
    },
    compact() { return call('compactRetired', undefined); },
    close({slot, u}) { return call('closeDraw', undefined, bucket(), slot, u); },
    claim(wallet, draw) {
      const draws = ledger(state).drawNote;
      const note = draws.member(draw) ? draws.lookup(draw) : undefined;
      return call('claim', {...wallet, balance: wallet.openings[note] ?? 0n}, draw);
    },
    slotOf(note) { return ledger(state).slotOf.lookup(note); },
    ledger() { return ledger(state); },
    identityTag: pureCircuits.identityTag,
    liveNoteOf,
    noteCommitment: pureCircuits.noteCommitment,
  };
}
