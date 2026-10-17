// In-memory implementation of the durable-store port, for logic tests with
// failure injection. The real boundary (IndexedDB) is qualified in Chrome.
//
// Port: get(key), list(prefix), commit(ops). `commit` is all-or-nothing:
// ops are {type:'put',key,value,expect?} or {type:'check',key,expect};
// `expect` (string|null) is compared with the current value inside the commit.
export function memoryStore(initial=[]) {
  const data=new Map(initial);
  let failures=0,failAfterApply=false;
  const store={
    writes:[],
    failNextCommit(options={}){failures+=1;failAfterApply=options.afterApply===true;},
    snapshot:()=>new Map(data),
    async get(key){return data.get(key);},
    async list(prefix){return [...data].filter(([k])=>k.startsWith(prefix));},
    async commit(ops){
      for(const op of ops){
        if('expect' in op&&op.expect!==undefined&&(data.get(op.key)??null)!==op.expect)throw Error('write conflict');
      }
      if(failures>0){
        failures-=1;
        if(failAfterApply)for(const op of ops)if(op.type==='put')data.set(op.key,op.value);
        throw Error('durable write failed');
      }
      for(const op of ops)if(op.type==='put'){data.set(op.key,op.value);store.writes.push(op.key);}
    },
  };
  return store;
}
