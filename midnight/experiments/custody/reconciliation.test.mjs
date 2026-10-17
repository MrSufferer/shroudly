import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {Contract,ledger} from '../../managed/custody-probe/contract/index.js';
import {reconcileCustody,sanitizeStep} from './reconciliation.mjs';
const bytes=n=>new Uint8Array(32).fill(n);
function run(){
  let state;
  const contract=new Contract({owner:({privateState})=>[privateState,bytes(1)],first:({privateState})=>[privateState,bytes(2)],second:({privateState})=>[privateState,bytes(3)],third:({privateState})=>[privateState,bytes(4)],spendable:({privateState})=>[privateState,{...ledger(state).custody,mt_index:0n}],recipient:({privateState})=>[privateState,{bytes:bytes(5)}]});
  state=contract.initialState(RT.createConstructorContext({},'0'.repeat(64))).currentContractState;
  const call=(name,...args)=>{state=contract.impureCircuits[name](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,{}),...args).context.currentQueryContext.state;return ledger(state);};
  return call;
}
test('reserve plus liabilities reconcile to the tracked shielded coin through every transition',()=>{
  const call=run();
  const seeded=call('seed');
  assert.deepEqual(reconcileCustody(seeded),{custodyValue:'2000000',principalLiability:'1000000',prizeReserve:'1000000',prizeLiability:'0',liabilitiesTotal:'2000000',reconciled:true});
  assert.equal(reconcileCustody(call('allocateYield',1n,0n,1n)).reconciled,true);
  const released=reconcileCustody(call('withdraw',400000n));
  assert.equal(released.custodyValue,'1600000');assert.equal(released.liabilitiesTotal,'1600000');assert.equal(released.reconciled,true);
});
test('a custody shortfall or surplus is reported as unreconciled',()=>{
  const call=run();const seeded=call('seed');
  assert.equal(reconcileCustody({...seeded,custody:{...seeded.custody,value:1999999n}}).reconciled,false);
  assert.equal(reconcileCustody({...seeded,prizeLiability:1n}).reconciled,false);
});
test('step evidence is an explicit allowlist and refuses malformed hashes',()=>{
  const step=sanitizeStep({name:'seed',txHash:'ab'.repeat(32),blockHeight:12,blockHash:'cd'.repeat(32),status:'SucceedEntirely',elapsedMs:5,token:'secret',url:'https://x.example/?project_id=abc',extra:{a:1}});
  assert.deepEqual(Object.keys(step).sort(),['blockHash','blockHeight','elapsedMs','name','status','txHash']);
  assert.throws(()=>sanitizeStep({name:'seed',txHash:'not hex'}),/invalid evidence/);
});
