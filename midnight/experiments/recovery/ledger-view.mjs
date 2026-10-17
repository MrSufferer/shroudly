import {toHex} from './codec.mjs';

// Pure projections between the generated ledger and the journal's
// {round, commitment} vocabulary. An unregistered participant is round -1.
export const UNREGISTERED={round:-1n,commitment:`0x${'00'.repeat(32)}`};

export function participantLedger(ledgerState,id) {
  if(!ledgerState.commitments.member(id))return UNREGISTERED;
  return {round:ledgerState.rounds.lookup(id),commitment:`0x${toHex(ledgerState.commitments.lookup(id))}`};
}

export function expectedAfter({circuit,base,next,bind}) {
  const round=circuit==='register'?0n:base.round+1n;
  return {round,commitment:`0x${toHex(bind(next.secret,next.round))}`};
}

// Witness material is fresh when it commits to exactly what the ledger holds.
export function isFreshAgainst(ledgerView,privateState,bind) {
  if(ledgerView.round<0n)return privateState.round===0n;
  return ledgerView.commitment===`0x${toHex(bind(privateState.secret,privateState.round))}`;
}
