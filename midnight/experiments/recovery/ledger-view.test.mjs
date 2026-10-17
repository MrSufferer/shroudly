import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger,pureCircuits} from '../../managed/recovery-probe/contract/index.js';
import {witnesses,initialPrivateState} from './probe-witnesses.mjs';
import {participantLedger,expectedAfter,isFreshAgainst,UNREGISTERED} from './ledger-view.mjs';

const secret=new Uint8Array(32).fill(7);
const contract=new Contract(witnesses);
let state=contract.initialState(RT.createConstructorContext(undefined,'0'.repeat(64))).currentContractState.data;
const run=(circuit,ps)=>{const r=contract.impureCircuits[circuit](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,ps));state=r.context.currentQueryContext.state;return r.context.currentPrivateState;};
const id=pureCircuits.identity(secret);

test('the projection matches the generated ledger before and after each action',()=>{
  assert.deepEqual(participantLedger(ledger(state),id),UNREGISTERED);
  const ps0=initialPrivateState(secret);
  const base0=participantLedger(ledger(state),id);
  const next0=run('register',ps0);
  assert.deepEqual(participantLedger(ledger(state),id),expectedAfter({circuit:'register',base:base0,next:next0,bind:pureCircuits.bind}));
  const base1=participantLedger(ledger(state),id);
  const next1=run('advance',next0);
  assert.deepEqual(participantLedger(ledger(state),id),expectedAfter({circuit:'advance',base:base1,next:next1,bind:pureCircuits.bind}));
});

test('freshness is the exact commitment match, never decryptability',()=>{
  const view=participantLedger(ledger(state),id);
  assert.equal(isFreshAgainst(view,{secret,round:1n},pureCircuits.bind),true);
  assert.equal(isFreshAgainst(view,{secret,round:0n},pureCircuits.bind),false);
  assert.equal(isFreshAgainst(UNREGISTERED,{secret,round:0n},pureCircuits.bind),true);
});
