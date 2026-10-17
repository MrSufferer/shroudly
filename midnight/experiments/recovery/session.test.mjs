import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournal,sessionKeyFromKit} from './journal.mjs';
import {acquireWriter} from './writer-lock.mjs';
import {fakeLocks} from './fake-locks.mjs';
import {memoryStore} from './memory-store.mjs';

const scope={network:'preprod',deployment:'dep-A',participant:'p-1'};
const kit=`0x${'09'.repeat(32)}`;
const secret=new Uint8Array(32).fill(7);
const entry={actionId:'a1',circuit:'advance',base:{round:0n,commitment:'0x00'},expected:{round:1n,commitment:'0x01'},nextPrivateState:{secret,round:1n}};
async function session(store,s=scope,locks=fakeLocks(),k=kit) {
  const writer=await acquireWriter({locks,scope:s});
  const journal=await openJournal({store,scope:s,key:await sessionKeyFromKit(k),writer});
  return {journal,writer};
}

test('account, deployment and network scopes are isolated from one another', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});
  for(const other of [{...scope,deployment:'dep-B'},{...scope,participant:'p-2'},{...scope,network:'mainnet-test-build'}]){
    const b=await session(store,other);
    assert.equal(b.journal.current(),null);
    assert.deepEqual(await b.journal.unresolved(),[]);
  }
});

test('ciphertext moved to another scope cannot be decrypted there', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});
  const other={...scope,deployment:'dep-B'};
  const [[key,value]]=[...store.snapshot()];
  const forged=memoryStore([[key.replace('dep-A','dep-B'),value]]);
  await assert.rejects(session(forged,other),/cannot be decrypted/);
});

test('a wrong Recovery Kit key cannot open saved state', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});
  await assert.rejects(session(store,scope,fakeLocks(),`0x${'0a'.repeat(32)}`),/cannot be decrypted/);
});

test('locking clears decrypted state and keys but preserves durable state and unresolved actions', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});await a.journal.prepare(entry);
  a.journal.lock();
  assert.throws(()=>a.journal.current(),/locked/);
  await assert.rejects(a.journal.prepare({...entry,actionId:'a2'}),/locked/);
  const b=await session(store);
  assert.equal(b.journal.current().privateState.round,0n);
  assert.equal((await b.journal.unresolved()).length,1);
});

test('only one same-browser writer may be active; release permits a new one', async()=>{
  const store=memoryStore(),locks=fakeLocks();
  const a=await session(store,scope,locks);
  await assert.rejects(session(store,scope,locks),/active writer/);
  a.writer.release();
  assert.throws(()=>a.writer.assertHeld(),/released/);
  await assert.rejects(a.journal.initialize({secret,round:0n}),/released/);
  await new Promise(r=>setTimeout(r,0));
  const b=await session(store,scope,locks);
  await b.journal.initialize({secret,round:0n});
});

test('releasing the writer does not erase an unresolved action', async()=>{
  const store=memoryStore(),locks=fakeLocks();
  const a=await session(store,scope,locks);await a.journal.initialize({secret,round:0n});await a.journal.prepare(entry);
  a.writer.release();await new Promise(r=>setTimeout(r,0));
  const b=await session(store,scope,locks);
  assert.equal((await b.journal.unresolved()).length,1);
  await assert.rejects(b.journal.prepare({...entry,actionId:'a2'}),/unresolved action/);
});

test('two stale writers cannot both advance the same state version', async()=>{
  const store=memoryStore();
  const a=await session(store,scope,fakeLocks());await a.journal.initialize({secret,round:0n});
  // A second journal object with its own (separate-browser) lock sees the same storage: the
  // storage-level fence rejects whichever writer holds the older view.
  const b=await session(store,scope,fakeLocks());
  await a.journal.prepare(entry);
  await assert.rejects(b.journal.prepare({...entry,actionId:'a2'}),/write conflict|unresolved/);
});

test('concurrent preparations from different writers cannot both commit', async()=>{
  const store=memoryStore();
  const a=await session(store,scope,fakeLocks());await a.journal.initialize({secret,round:0n});
  const b=await session(store,scope,fakeLocks());
  const results=await Promise.allSettled([a.journal.prepare(entry),b.journal.prepare({...entry,actionId:'a2'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await a.journal.unresolved()).length,1);
});

test('a verified wallet-account binding is stored once and a different account is refused', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});
  assert.equal(await a.journal.binding(),null);
  const binding={address:'addr-1',verifyingKey:'vk-1',challenge:'c',signature:'s'};
  await a.journal.bindAccount(binding);
  await assert.rejects(a.journal.bindAccount({...binding,address:'addr-2'}),/already bound/);
  a.writer.release();await new Promise(r=>setTimeout(r,0));
  const b=await session(store);
  assert.deepEqual(await b.journal.binding(),binding);
  await b.journal.assertBoundTo('addr-1');
  await assert.rejects(b.journal.assertBoundTo('addr-2'),/different wallet account/);
});

test('a viewing session without the writer lock cannot change private state', async()=>{
  const store=memoryStore();
  const a=await session(store);await a.journal.initialize({secret,round:0n});
  const viewer=await openJournal({store,scope,key:await sessionKeyFromKit(kit)});
  assert.equal(viewer.current().privateState.round,0n);
  await assert.rejects(viewer.prepare(entry),/view-only/);
});
