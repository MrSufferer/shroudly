import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournal,sessionKeyFromKit} from './journal.mjs';
import {memoryStore} from './memory-store.mjs';
import {acquireWriter} from './writer-lock.mjs';
import {fakeLocks} from './fake-locks.mjs';

const scope={network:'preprod',deployment:'dep-A',participant:'p-1'};
const hex=n=>'0x'+n.toString(16).padStart(2,'0').repeat(32);
const secret=new Uint8Array(32).fill(7);
const state0={secret,round:0n};
const entry=(over={})=>({actionId:'a1',circuit:'advance',base:{round:0n,commitment:hex(1)},expected:{round:1n,commitment:hex(2)},nextPrivateState:{secret,round:1n},...over});
async function open(store=memoryStore(),opts={}) {
  const key=await sessionKeyFromKit(hex(9));
  const writer=await acquireWriter({locks:fakeLocks(),scope});
  const journal=await openJournal({store,scope,key,writer,...opts});
  return {store,journal};
}

test('first open persists versioned private state at generation 0', async()=>{
  const {journal}=await open();
  await journal.initialize(state0);
  assert.deepEqual(journal.current(),{generation:0n,privateState:state0});
});

test('prepare persists intent and next witness state atomically and increments nothing yet', async()=>{
  const {journal,store}=await open();
  await journal.initialize(state0);
  await journal.prepare(entry());
  assert.deepEqual(journal.current().privateState,state0);
  const [pending]=await journal.unresolved();
  assert.equal(pending.status,'prepared');
  assert.deepEqual(pending.nextPrivateState,{secret,round:1n});
  assert.equal(store.writes.length>=2,true);
});

test('a failed durable write prevents the action from being prepared at all', async()=>{
  const {journal,store}=await open();
  await journal.initialize(state0);
  store.failNextCommit();
  await assert.rejects(journal.prepare(entry()),/durable write failed/);
  assert.deepEqual(await journal.unresolved(),[]);
  assert.deepEqual(journal.current().privateState,state0);
});

test('nothing in storage contains plaintext witness material or the session key', async()=>{
  const {journal,store}=await open();
  await journal.initialize(state0);
  await journal.prepare(entry());
  const dump=JSON.stringify([...store.snapshot()]);
  assert.equal(dump.includes('0x0909'),false);
  assert.equal(dump.includes(Buffer.from(secret).toString('hex')),false);
  for(const raw of store.snapshot().values())assert.equal(JSON.parse(raw).v,1);
});
