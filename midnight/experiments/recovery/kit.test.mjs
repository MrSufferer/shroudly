import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournal,sessionKeyFromKit} from './journal.mjs';
import {exportKit,restoreKit,generateKitKey} from './kit.mjs';
import {acquireWriter} from './writer-lock.mjs';
import {fakeLocks} from './fake-locks.mjs';
import {memoryStore} from './memory-store.mjs';

const scope={network:'preprod',deployment:'dep-A',participant:'p-1'};
const secret=new Uint8Array(32).fill(7);
const entry={actionId:'a1',circuit:'advance',base:{round:0n,commitment:'0x00'},expected:{round:1n,commitment:'0x01'},nextPrivateState:{secret,round:1n}};
async function fresh(store,kitKey,opts={}) {
  const writer=await acquireWriter({locks:fakeLocks(),scope});
  return openJournal({store,scope,key:await sessionKeyFromKit(kitKey),writer,...opts});
}

test('the Recovery Kit restores the complete witness material on an empty browser', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);
  await journal.initialize({secret,round:0n});await journal.prepare(entry);await journal.complete('a1');
  const text=await exportKit({journal,kitKey});
  const restored=await restoreKit({kitText:text,store:memoryStore(),scope});
  const reopened=await fresh(restored.store,kitKey);
  assert.deepEqual(reopened.current().privateState.secret,secret);
  assert.equal(reopened.current().privateState.round,1n);
  assert.equal(restored.generation,1n);
});

test('an unresolved action travels in the kit with its next witness state', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);
  await journal.initialize({secret,round:0n});await journal.prepare(entry);
  const restored=await restoreKit({kitText:await exportKit({journal,kitKey}),store:memoryStore(),scope});
  const reopened=await fresh(restored.store,kitKey);
  const [pending]=await reopened.unresolved();
  assert.equal(pending.nextPrivateState.round,1n);
});

test('decryption alone does not establish freshness: an older kit blocks new actions', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);
  await journal.initialize({secret,round:0n});
  const older=await exportKit({journal,kitKey});
  const restored=await restoreKit({kitText:older,store:memoryStore(),scope});
  const ledgerRound=3n;
  const reopened=await fresh(restored.store,kitKey,{isFresh:async state=>state.round===ledgerRound});
  await assert.rejects(reopened.prepare(entry),/stale/);
  assert.equal((await reopened.unresolved()).length,0);
});

test('a kit for another deployment, participant or network is rejected without writing', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);await journal.initialize({secret,round:0n});
  const text=await exportKit({journal,kitKey});
  for(const wrong of [{...scope,deployment:'dep-B'},{...scope,participant:'p-2'},{...scope,network:'mainnet-test-build'}]){
    const target=memoryStore();
    await assert.rejects(restoreKit({kitText:text,store:target,scope:wrong}),/different/);
    assert.equal(target.snapshot().size,0);
  }
});

test('a tampered or truncated kit is rejected without writing', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);await journal.initialize({secret,round:0n});
  const parsed=JSON.parse(await exportKit({journal,kitKey}));
  const [first]=parsed.records;const sealed=JSON.parse(first[1]);sealed.c=(sealed.c[0]==='A'?'B':'A')+sealed.c.slice(1);first[1]=JSON.stringify(sealed);
  const target=memoryStore();
  await assert.rejects(restoreKit({kitText:JSON.stringify(parsed),store:target,scope}),/cannot be decrypted|invalid/);
  await assert.rejects(restoreKit({kitText:'{"format":"nope"}',store:target,scope}),/invalid Recovery Kit/);
  assert.equal(target.snapshot().size,0);
});

test('restoring never overwrites newer local state', async()=>{
  const kitKey=generateKitKey(),store=memoryStore();
  const journal=await fresh(store,kitKey);
  await journal.initialize({secret,round:0n});
  const older=await exportKit({journal,kitKey});
  await journal.prepare(entry);await journal.complete('a1');
  await assert.rejects(restoreKit({kitText:older,store,scope}),/newer local state/);
  assert.equal((await fresh(store,kitKey)).current().privateState.round,1n);
});
