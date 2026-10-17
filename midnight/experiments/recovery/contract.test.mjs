import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger} from '../../managed/recovery-probe/contract/index.js';
import {witnesses,initialPrivateState} from './probe-witnesses.mjs';

// Behavior seam: generated circuits plus the participant's private state.
const secret=new Uint8Array(32).fill(7);
function deploy(privateState=initialPrivateState(secret)){
 const contract=new Contract(witnesses);
 const init=contract.initialState(RT.createConstructorContext(privateState,'0'.repeat(64)));
 let state=init.currentContractState.data,ps=init.currentPrivateState;
 return {
  read:()=>ledger(state),
  advance(withState=ps){
   const result=contract.impureCircuits.advance(RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,withState));
   state=result.context.currentQueryContext.state;ps=result.context.currentPrivateState;return ps;
  },
  privateState:()=>ps,
 };
}
test('an advance moves the public round and the private witness together',()=>{
 const probe=deploy();const before=probe.read().commitment;
 const next=probe.advance();
 assert.equal(probe.read().round,1n);
 assert.equal(next.round,1n);
 assert.notDeepEqual(probe.read().commitment,before);
 probe.advance(next);assert.equal(probe.read().round,2n);
});
test('stale private state cannot advance the ledger again',()=>{
 const probe=deploy();const stale=probe.privateState();
 probe.advance();
 assert.throws(()=>probe.advance(stale),/stale or foreign/);
 assert.equal(probe.read().round,1n);
});
test('a different secret cannot advance the ledger',()=>{
 const probe=deploy();
 assert.throws(()=>probe.advance(initialPrivateState(new Uint8Array(32).fill(8))),/stale or foreign/);
});
