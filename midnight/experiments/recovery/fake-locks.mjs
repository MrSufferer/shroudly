// Minimal Web Locks double (exclusive, ifAvailable) for logic tests. Chrome's
// real navigator.locks is exercised in the browser suite.
export function fakeLocks() {
  const held=new Set();
  return {
    async request(name,options,callback) {
      if(held.has(name)){
        if(options?.ifAvailable)return callback(null);
        throw Error('blocking requests are not modeled');
      }
      held.add(name);
      try{return await callback({name,mode:'exclusive'});}finally{held.delete(name);}
    },
  };
}
