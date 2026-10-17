// Same-browser single-writer exclusion over the Web Locks API (injected, so
// it is testable). A held lock authorizes writes; it never erases an
// unresolved journal entry, and it does NOT exclude other devices or browser
// profiles holding a copied Recovery Kit (ADR 0029: explicit, reconciled transfer).
import {scopePrefix} from './journal.mjs';

export async function acquireWriter({locks,scope}) {
  if(!locks||typeof locks.request!=='function')throw Error('Web Locks are unavailable; writing is blocked');
  const name=`${scopePrefix(scope)}/writer`;
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  let granted=false;
  const acquired=await new Promise((resolve,reject)=>{
    locks.request(name,{mode:'exclusive',ifAvailable:true},async lock=>{
      if(lock===null){resolve(false);return;}
      granted=true;resolve(true);
      await held;
    }).catch(reject);
  });
  if(!acquired)throw Error('another session is the active writer for this account');
  let live=granted;
  return {
    name,
    assertHeld(){if(!live)throw Error('writer exclusion was released');},
    release(){live=false;release();},
  };
}
