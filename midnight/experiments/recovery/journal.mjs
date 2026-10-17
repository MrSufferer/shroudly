import {encode,decode,toHex,fromHex} from './codec.mjs';

// Encrypted, versioned participant private state plus a durable action journal.
// Storage is an injected port (see memory-store.mjs); decryption keys exist only
// in the session `key` handed to openJournal and are dropped by lock().
export const SCHEMA_VERSION=1;
const TERMINAL=new Set(['completed','abandoned']);
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>Buffer.from(bytes).toString('base64');
const unb64=text=>new Uint8Array(Buffer.from(text,'base64'));

export async function sessionKeyFromKit(kitKeyHex) {
  if(!/^0x[0-9a-fA-F]{64}$/.test(kitKeyHex))throw Error('Recovery Kit key must contain 256 bits');
  return crypto.subtle.importKey('raw',fromHex(kitKeyHex.slice(2).toLowerCase()),{name:'AES-GCM'},false,['encrypt','decrypt']);
}

async function seal(key,storeKey,value) {
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:enc.encode(storeKey)},key,enc.encode(encode({schema:SCHEMA_VERSION,value})));
  return JSON.stringify({v:SCHEMA_VERSION,n:b64(nonce),c:b64(new Uint8Array(ct))});
}
export async function openRecord(key,storeKey,raw) {
  const sealed=JSON.parse(raw);
  if(sealed.v!==SCHEMA_VERSION)throw Error(`unsupported record version ${sealed.v}`);
  let plain;
  try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(sealed.n),additionalData:enc.encode(storeKey)},key,unb64(sealed.c));}
  catch{throw Error('private state cannot be decrypted with this Recovery Kit');}
  const payload=decode(dec.decode(plain));
  if(payload.schema!==SCHEMA_VERSION)throw Error('unsupported private-state schema');
  return payload.value;
}

export const scopePrefix=({network,deployment,participant})=>{
  for(const part of [network,deployment,participant])if(typeof part!=='string'||!part)throw Error('network, deployment and participant identity are required');
  return `shroudly/v${SCHEMA_VERSION}/${[network,deployment,participant].map(encodeURIComponent).join('/')}`;
};

// `isFresh(privateState)` is the contract-specific check that the witness
// material matches the fresh ledger; decryption alone proves nothing about freshness.
export async function openJournal({store,scope,key,writer,isFresh}) {
  const prefix=scopePrefix(scope);
  const stateKey=`${prefix}/state`;
  const actionKey=id=>`${prefix}/action/${encodeURIComponent(id)}`;
  let locked=false,sessionKey=key,stateRaw=null,state=null;
  const live=()=>{if(locked)throw Error('session is locked');return sessionKey;};
  const mayWrite=()=>{live();if(!writer)throw Error('view-only session: acquire the writer lock to change private state');writer.assertHeld();};
  const hydrate=async()=>{
    stateRaw=(await store.get(stateKey))??null;
    state=stateRaw===null?null:await openRecord(live(),stateKey,stateRaw);
  };
  await hydrate();

  const entries=async()=>{
    const out=[];
    for(const [k,raw] of await store.list(`${prefix}/action/`))out.push({key:k,raw,entry:await openRecord(live(),k,raw)});
    return out;
  };
  const journal={
    scope:{...scope},
    prefix,
    current(){live();return state&&{generation:state.generation,privateState:state.privateState};},
    async initialize(privateState) {
      mayWrite();
      if(state!==null)throw Error('private state is already initialized');
      const next={generation:0n,privateState};
      const raw=await seal(live(),stateKey,next);
      await store.commit([{type:'put',key:stateKey,value:raw,expect:null}]);
      stateRaw=raw;state=next;
    },
    async unresolved(){live();return (await entries()).map(e=>e.entry).filter(e=>!TERMINAL.has(e.status));},
    async entry(actionId){live();const raw=await store.get(actionKey(actionId));return raw===undefined?null:openRecord(live(),actionKey(actionId),raw);},
    async prepare(entry) {
      mayWrite();
      if(state===null)throw Error('private state is not initialized');
      if((await journal.unresolved()).length>0)throw Error('an unresolved action blocks new actions');
      if(isFresh&&!await isFresh(state.privateState))throw Error('private state is stale against the ledger; reconcile or restore a newer Recovery Kit');
      const record={...entry,status:'prepared',baseGeneration:state.generation,history:[{status:'prepared'}]};
      const raw=await seal(live(),actionKey(entry.actionId),record);
      // Intent and next witness state land together. Re-sealing the state record
      // with a new epoch makes the commit a compare-and-swap, so two writers
      // preparing concurrently cannot both succeed.
      const fenced={...state,epoch:(state.epoch??0n)+1n};
      const fencedRaw=await seal(live(),stateKey,fenced);
      await store.commit([
        {type:'put',key:stateKey,value:fencedRaw,expect:stateRaw},
        {type:'put',key:actionKey(entry.actionId),value:raw,expect:null},
      ]);
      stateRaw=fencedRaw;state=fenced;
      return record;
    },
    async transition(actionId,status,patch={}) {
      mayWrite();
      const k=actionKey(actionId);const raw=await store.get(k);
      if(raw===undefined)throw Error('unknown action');
      const entry=await openRecord(live(),k,raw);
      const next={...entry,...patch,status,history:[...entry.history,{status}]};
      await store.commit([{type:'put',key:k,value:await seal(live(),k,next),expect:raw}]);
      return next;
    },
    async complete(actionId,observation={}) {
      mayWrite();
      const k=actionKey(actionId);const raw=await store.get(k);
      if(raw===undefined)throw Error('unknown action');
      const entry=await openRecord(live(),k,raw);
      if(TERMINAL.has(entry.status))throw Error('action is already resolved');
      const next={generation:state.generation+1n,epoch:(state.epoch??0n)+1n,privateState:entry.nextPrivateState};
      const done={...entry,status:'completed',observation,history:[...entry.history,{status:'completed'}]};
      const nextRaw=await seal(live(),stateKey,next);
      // New witness state and the resolved journal entry commit together or not at all.
      await store.commit([
        {type:'put',key:stateKey,value:nextRaw,expect:stateRaw},
        {type:'put',key:k,value:await seal(live(),k,done),expect:raw},
      ]);
      stateRaw=nextRaw;state=next;
    },
    // Sealed state plus unresolved actions: the complete material a Recovery Kit carries.
    async exportRecords(){
      live();
      const records=[[stateKey,stateRaw]];
      for(const {key:k,raw,entry} of await entries())if(!TERMINAL.has(entry.status))records.push([k,raw]);
      return records;
    },
    lock(){locked=true;sessionKey=null;state=null;stateRaw=null;},
  };
  return journal;
}
export {toHex};
