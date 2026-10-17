import {scopePrefix,sessionKeyFromKit,openRecord} from './journal.mjs';
import {toHex} from './codec.mjs';

// The Recovery Kit is the participant-held artifact: the 256-bit key plus the
// sealed state and unresolved-action records (complete witness material,
// including the next witness state of an in-flight action). Backup Account
// login never unlocks it; the key lives in session memory after unlock.
export const KIT_FORMAT='shroudly-recovery-kit',KIT_VERSION=2;

export const generateKitKey=()=>`0x${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;

export async function exportKit({journal,kitKey}) {
  await sessionKeyFromKit(kitKey);
  return JSON.stringify({format:KIT_FORMAT,version:KIT_VERSION,scope:journal.scope,key:kitKey,records:await journal.exportRecords()});
}

const sameScope=(a,b)=>['network','deployment','participant'].every(field=>a?.[field]===b[field]);

export async function restoreKit({kitText,store,scope}) {
  let kit;
  try{kit=JSON.parse(kitText);}catch{throw Error('invalid Recovery Kit');}
  if(kit?.format!==KIT_FORMAT||kit.version!==KIT_VERSION||typeof kit.key!=='string'||!Array.isArray(kit.records)||typeof kit.scope!=='object'||kit.scope===null)throw Error('invalid Recovery Kit');
  if(!sameScope(kit.scope,scope))throw Error('Recovery Kit belongs to a different network, deployment or participant');
  const prefix=scopePrefix(scope),stateKey=`${prefix}/state`;
  const key=await sessionKeyFromKit(kit.key);
  const opened=new Map();
  for(const record of kit.records) {
    if(!Array.isArray(record)||typeof record[0]!=='string'||typeof record[1]!=='string'||!record[0].startsWith(`${prefix}/`))throw Error('invalid Recovery Kit record');
    opened.set(record[0],await openRecord(key,record[0],record[1]));
  }
  const incoming=opened.get(stateKey);
  if(!incoming)throw Error('invalid Recovery Kit: private state is missing');

  const existingRaw=(await store.get(stateKey))??null;
  if(existingRaw!==null) {
    let local;
    try{local=await openRecord(key,stateKey,existingRaw);}
    catch{throw Error('local private state exists under a different key; it is not overwritten');}
    const newer=local.generation>incoming.generation||(local.generation===incoming.generation&&(local.epoch??0n)>(incoming.epoch??0n));
    if(newer)throw Error('newer local state exists; reconcile instead of restoring this Recovery Kit');
  }
  const ops=[{type:'put',key:stateKey,value:kit.records.find(r=>r[0]===stateKey)[1],expect:existingRaw}];
  for(const [k,raw] of kit.records)if(k!==stateKey)ops.push({type:'put',key:k,value:raw});
  await store.commit(ops);
  return {store,generation:incoming.generation};
}
