// IndexedDB implementation of the durable-store port. Every commit is one
// readwrite transaction with `durability: 'strict'`; it resolves only on the
// transaction's `complete` event and rejects on any error, abort or conflict,
// so a caller can treat "resolved" as "durably committed" and refuse to submit otherwise.
const STORE='records';

export async function idbStore({indexedDB,name='shroudly-recovery-v1'}) {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error('durable write failed: storage could not be opened'));
    request.onblocked=()=>reject(Error('durable write failed: storage is blocked'));
  });
  const run=(mode,work)=>new Promise((resolve,reject)=>{
    let result;
    let transaction;
    try{transaction=db.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined);}
    catch(error){reject(Error(`durable write failed: ${error?.name??'storage unavailable'}`));return;}
    const fail=error=>reject(Error(`durable write failed: ${error?.name??transaction.error?.name??'transaction aborted'}`));
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>fail(transaction.error);
    transaction.onabort=()=>fail(transaction.error);
    try{result=work(transaction.objectStore(STORE),transaction);}catch(error){try{transaction.abort();}catch{}fail(error);}
  });
  return {
    get:key=>new Promise((resolve,reject)=>{
      const request=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('storage read failed'));
    }),
    list:prefix=>new Promise((resolve,reject)=>{
      const out=[];
      const request=db.transaction(STORE,'readonly').objectStore(STORE).openCursor(IDBKeyRange.bound(prefix,`${prefix}￿`));
      request.onsuccess=()=>{const cursor=request.result;if(cursor){out.push([cursor.key,cursor.value]);cursor.continue();}else resolve(out);};
      request.onerror=()=>reject(Error('storage read failed'));
    }),
    // All-or-nothing: expectations are verified inside the same transaction, which aborts on mismatch.
    commit:ops=>run('readwrite',(objects,transaction)=>{
      ops.forEach(op=>{
        const check=objects.get(op.key);
        check.onsuccess=()=>{
          if('expect' in op&&op.expect!==undefined&&(check.result??null)!==op.expect){transaction.abort();return;}
          if(op.type==='put')objects.put(op.value,op.key);
        };
      });
    }),
    close:()=>db.close(),
  };
}

// Qualification probe, not a policy: reports what this browser actually provides.
export async function qualifyStorage({indexedDB,storage,locks}) {
  const report={indexedDB:Boolean(indexedDB),strictDurability:false,webLocks:Boolean(locks?.request),persistenceRequested:false,persisted:false};
  if(indexedDB) {
    const probe=await new Promise(resolve=>{
      const request=indexedDB.open(`qualify-${Math.random()}`,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
      request.onsuccess=()=>{
        const db=request.result;
        try{report.strictDurability=db.transaction(STORE,'readwrite',{durability:'strict'}).durability==='strict';}catch{report.strictDurability=false;}
        db.close();indexedDB.deleteDatabase(db.name);resolve(true);
      };
      request.onerror=()=>resolve(false);
    });
    report.indexedDB=probe;
  }
  if(typeof storage?.persist==='function') {
    report.persistenceRequested=true;
    try{report.persisted=await storage.persist();}catch{report.persisted=false;}
  }
  report.storageApiPersisted=typeof storage?.persisted==='function'?await storage.persisted().catch(()=>false):false;
  // New contributions require persisted storage; exits stay available (ADR 0029).
  report.allowsNewContributions=report.indexedDB&&report.strictDurability&&report.webLocks&&report.persisted;
  return report;
}
