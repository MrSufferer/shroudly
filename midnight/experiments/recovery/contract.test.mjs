import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger,pureCircuits} from '../../managed/recovery-probe/contract/index.js';
import {witnesses,initialPrivateState} from './probe-witnesses.mjs';

// Behavior seam: generated circuits plus each participant's private state.
const bytes=n=>new Uint8Array(32).fill(n);
function deploy() {
  const contract=new Contract(witnesses);
  const init=contract.initialState(RT.createConstructorContext(undefined,'0'.repeat(64)));
  let state=init.currentContractState.data;
  const call=(circuit,privateState)=>{
    const result=contract.impureCircuits[circuit](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,privateState));
    state=result.context.currentQueryContext.state;
    return result.context.currentPrivateState;
  };
  const id=secret=>pureCircuits.identity(secret);
  return {call,read:()=>ledger(state),id,round:secret=>ledger(state).rounds.lookup(id(secret)),commitment:secret=>ledger(state).commitments.lookup(id(secret))};
}
test('registering then advancing moves the public round and the private witness together',()=>{
  const chain=deploy(),ps=initialPrivateState(bytes(7));
  chain.call('register',ps);
  assert.equal(chain.round(bytes(7)),0n);
  assert.deepEqual(chain.commitment(bytes(7)),pureCircuits.bind(bytes(7),0n));
  const next=chain.call('advance',ps);
  assert.equal(next.round,1n);
  assert.equal(chain.round(bytes(7)),1n);
  assert.deepEqual(chain.commitment(bytes(7)),pureCircuits.bind(bytes(7),1n));
  assert.equal(chain.read().total,2n);
});
test('a participant cannot register twice or advance before registering',()=>{
  const chain=deploy(),ps=initialPrivateState(bytes(7));
  assert.throws(()=>chain.call('advance',ps),/not registered/);
  chain.call('register',ps);
  assert.throws(()=>chain.call('register',ps),/already registered/);
});
test('stale private state cannot advance the ledger again',()=>{
  const chain=deploy(),ps=initialPrivateState(bytes(7));
  chain.call('register',ps);
  chain.call('advance',ps);
  assert.throws(()=>chain.call('advance',ps),/stale or foreign/);
  assert.equal(chain.round(bytes(7)),1n);
});
test('participants in one deployment are isolated from one another',()=>{
  const chain=deploy(),a=initialPrivateState(bytes(7)),b=initialPrivateState(bytes(8));
  chain.call('register',a);chain.call('register',b);
  chain.call('advance',a);
  assert.equal(chain.round(bytes(7)),1n);
  assert.equal(chain.round(bytes(8)),0n);
  assert.throws(()=>chain.call('advance',{secret:bytes(8),round:1n}),/stale or foreign/);
});
