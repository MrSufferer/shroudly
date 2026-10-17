import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournal,sessionKeyFromKit} from './journal.mjs';
import {runAction,reconcile} from './actions.mjs';
import {memoryStore} from './memory-store.mjs';
import {acquireWriter} from './writer-lock.mjs';
import {fakeLocks} from './fake-locks.mjs';

const scope={network:'preprod',deployment:'dep-A',participant:'p-1'};
const secret=new Uint8Array(32).fill(7);
const commit=round=>`0x${round.toString(16).padStart(64,'0')}`;

// Fake of the network boundary only: a ledger, a mempool, and an indexer.
function fakeNetwork() {
  const net={round:0n,mempool:new Map(),submissions:0,indexerDown:false,failNextObserve:false,visible:new Set(),failedTx:new Set()};
  net.executor={
    async build(privateState){
      return {base:{round:net.round,commitment:commit(net.round)},expected:{round:privateState.round+1n,commitment:commit(privateState.round+1n)},nextPrivateState:{...privateState,round:privateState.round+1n},payload:{from:privateState.round}};
    },
    async submit({payload}){
      net.submissions+=1;
      const txId=`0x${net.submissions.toString(16).padStart(64,'a')}`;
      net.mempool.set(txId,payload);return txId;
    },
    async observe(txId){
      if(net.failNextObserve){net.failNextObserve=false;throw Error('observation timed out');}
      if(net.indexerDown)return null;
      if(net.failedTx.has(txId))return {status:'failed'};
      if(net.mempool.has(txId)&&net.visible.has(txId))return {status:'finalized',indexerVisible:true};
      return null;
    },
    async queryLedger(){return {round:net.round,commitment:commit(net.round)};},
  };
  // Mining step: pending transactions that still match the ledger become final.
  net.mine=()=>{for(const [txId,payload] of net.mempool)if(payload.from===net.round&&!net.visible.has(txId)){net.round+=1n;net.visible.add(txId);}};
  return net;
}
async function boot(store,network,writer) {
  const key=await sessionKeyFromKit(`0x${'09'.repeat(32)}`);
  const journal=await openJournal({store,scope,key,writer:writer??await acquireWriter({locks:fakeLocks(),scope})});
  if(journal.current()===null)await journal.initialize({secret,round:0n});
  return journal;
}
const crashAt=stage=>({after:s=>{if(s===stage)throw Object.assign(Error('process crashed'),{crash:true});}});

test('a finalized action commits the next witness state and resolves the journal', async()=>{
  const store=memoryStore(),net=fakeNetwork(),journal=await boot(store);
  const pending=runAction({journal,executor:net.executor,actionId:'a1',pollMs:0});
  await new Promise(r=>setTimeout(r,5));net.mine();
  const result=await pending;
  assert.equal(result.outcome,'completed');
  assert.equal(journal.current().generation,1n);
  assert.equal(journal.current().privateState.round,1n);
  assert.deepEqual(await journal.unresolved(),[]);
  assert.equal(net.submissions,1);
});

test('failed durable prepare never reaches submission', async()=>{
  const store=memoryStore(),net=fakeNetwork(),journal=await boot(store);
  store.failNextCommit();
  await assert.rejects(runAction({journal,executor:net.executor,actionId:'a1',pollMs:0}),/durable write failed/);
  assert.equal(net.submissions,0);
});

test('crash before submission: restart submits the original action exactly once', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  await assert.rejects(runAction({journal:await boot(store),executor:net.executor,actionId:'a1',pollMs:0,hooks:crashAt('prepared')}),/crashed/);
  assert.equal(net.submissions,0);
  const restarted=await boot(store);
  assert.equal((await restarted.unresolved()).length,1);
  const pending=reconcile({journal:restarted,executor:net.executor,pollMs:0});
  await new Promise(r=>setTimeout(r,5));net.mine();
  const [outcome]=await pending;
  assert.equal(outcome.outcome,'completed');
  assert.equal(net.submissions,1);
  assert.equal(restarted.current().privateState.round,1n);
});

test('crash during handoff: the unknown submission is never repeated and timeouts are not failures', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  await assert.rejects(runAction({journal:await boot(store),executor:net.executor,actionId:'a1',pollMs:0,hooks:crashAt('submitting')}),/crashed/);
  const restarted=await boot(store);
  const [first]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(first.outcome,'pending');
  assert.equal(net.submissions,0);
  assert.equal((await restarted.unresolved()).length,1);
});

test('crash during observation: indexer absence stays pending; finality later completes without a second submission', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  await assert.rejects(runAction({journal:await boot(store),executor:net.executor,actionId:'a1',pollMs:0,hooks:crashAt('submitted')}),/crashed/);
  assert.equal(net.submissions,1);
  net.indexerDown=true;
  const restarted=await boot(store);
  const [pending]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(pending.outcome,'pending');
  assert.equal((await restarted.unresolved()).length,1);
  net.indexerDown=false;net.mine();
  const [done]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(done.outcome,'completed');
  assert.equal(net.submissions,1);
  assert.equal(restarted.current().privateState.round,1n);
});

test('crash after finality: pending entry retains next state and a restart commits it', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  const first=await boot(store);
  const run=runAction({journal:first,executor:net.executor,actionId:'a1',pollMs:0,hooks:{after(stage){if(stage==='finalized'){store.failNextCommit();}}}});
  await new Promise(r=>setTimeout(r,5));net.mine();
  await assert.rejects(run,/durable write failed/);
  const restarted=await boot(store);
  assert.equal(restarted.current().privateState.round,0n);
  const [entry]=await restarted.unresolved();
  assert.equal(entry.nextPrivateState.round,1n);
  const [done]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(done.outcome,'completed');
  assert.equal(net.submissions,1);
  assert.equal(restarted.current().privateState.round,1n);
});

test('a definitively failed transaction is abandoned and a new action may follow', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  const journal=await boot(store);
  await assert.rejects(runAction({journal,executor:net.executor,actionId:'a1',pollMs:0,hooks:crashAt('submitted')}),/crashed/);
  const restarted=await boot(store);
  net.failedTx.add([...net.mempool.keys()][0]);
  const [result]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(result.outcome,'abandoned');
  assert.equal(restarted.current().privateState.round,0n);
  await restarted.prepare({actionId:'a2',circuit:'advance',base:{round:0n,commitment:commit(0n)},expected:{round:1n,commitment:commit(1n)},nextPrivateState:{secret,round:1n}});
});

test('an unresolved action blocks another action; a ledger that moved elsewhere blocks as a conflict', async()=>{
  const store=memoryStore(),net=fakeNetwork();
  await assert.rejects(runAction({journal:await boot(store),executor:net.executor,actionId:'a1',pollMs:0,hooks:crashAt('prepared')}),/crashed/);
  const restarted=await boot(store);
  await assert.rejects(runAction({journal:restarted,executor:net.executor,actionId:'a2',pollMs:0}),/unresolved action/);
  net.round=5n;
  const [result]=await reconcile({journal:restarted,executor:net.executor,pollMs:0,maxPolls:1});
  assert.equal(result.outcome,'conflict');
  assert.equal(net.submissions,0);
});
