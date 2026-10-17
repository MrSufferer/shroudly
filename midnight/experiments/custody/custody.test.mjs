import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger} from '../../managed/custody-probe/contract/index.js';
const bytes=n=>new Uint8Array(32).fill(n);
function setup(){
 let secret=bytes(1);const contract=new Contract({owner:({privateState})=>[privateState,secret], first:({privateState})=>[privateState,bytes(2)],second:({privateState})=>[privateState,bytes(3)],third:({privateState})=>[privateState,bytes(4)], spendable:({privateState})=>[privateState,{...ledger(state).custody,mt_index:0n}],recipient:({privateState})=>[privateState,{bytes:bytes(5)}]});
 const initial=contract.initialState(RT.createConstructorContext({},'0'.repeat(64)));
 let state=initial.currentContractState;
 const call=(name,...args)=>{const result=contract.impureCircuits[name](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,{}),...args);state=result.context.currentQueryContext.state;return result;};
 return {call,read:()=>ledger(state),setSecret:value=>secret=value};
}
test('reserve issuance creates shielded custody and reconciled segregated liabilities',()=>{
 const p=setup();p.call('seed');const state=p.read();assert.equal(state.principalLiability,1000000n);assert.equal(state.prizeReserve,1000000n);assert.equal(state.prizeLiability,0n);assert.equal(state.custody.value,2000000n);assert.throws(()=>p.call('seed'),/already seeded/);
});
test('yield allocation rejects draw and contributor mismatches and replay',()=>{
 const p=setup();p.call('seed');
 assert.throws(()=>p.call('allocateYield',2n,0n,1n),/draw mismatch/);
 assert.throws(()=>p.call('allocateYield',1n,0n,0n),/distinct contributors/);
 assert.throws(()=>p.call('allocateYield',1n,2n,1n),/contributor binding/);
 p.call('allocateYield',1n,0n,1n);
 assert.equal(p.read().allocatedYield,100n);assert.equal(p.read().prizeLiability,100n);assert.equal(p.read().prizeReserve,999900n);
 assert.throws(()=>p.call('allocateYield',1n,0n,1n),/already allocated/);
});
test('release authenticates owner and preserves liabilities and shielded change',()=>{
 const p=setup();p.call('seed');p.setSecret(bytes(9));
 assert.throws(()=>p.call('withdraw',1000000n),/unauthorized asset release/);
 p.setSecret(bytes(1));assert.throws(()=>p.call('withdraw',1000001n),/principal liability/);
 p.call('withdraw',400000n);const s=p.read();assert.equal(s.principalLiability,600000n);assert.equal(s.custody.value,1600000n);assert.equal(s.prizeReserve,1000000n);
});
