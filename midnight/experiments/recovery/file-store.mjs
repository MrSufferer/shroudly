import {closeSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,writeSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';

// Node implementation of the durable-store port for the live Preprod journey
// (the browser uses idb-store.mjs). Each commit writes a temp file, fsyncs it,
// renames it over the journal and fsyncs the directory, so a SIGKILL leaves
// either the previous or the next complete file, never a mixture.
export function fileStore(path) {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  let data=new Map();
  if(existsSync(path)) {
    try{data=new Map(Object.entries(JSON.parse(readFileSync(path,'utf8'))));}
    catch{throw Error('journal file is corrupt; refusing to treat it as empty');}
  }
  const persist=next=>{
    const tmp=join(dirname(path),`.tmp-${randomBytes(6).toString('hex')}`);
    const fd=openSync(tmp,'w',0o600);
    try{writeSync(fd,JSON.stringify(Object.fromEntries(next)));fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(tmp,path);
    const dirFd=openSync(dirname(path),'r');
    try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
  };
  return {
    async get(key){return data.get(key);},
    async list(prefix){return [...data].filter(([k])=>k.startsWith(prefix));},
    async commit(ops) {
      for(const op of ops)if('expect' in op&&op.expect!==undefined&&(data.get(op.key)??null)!==op.expect)throw Error('write conflict');
      const next=new Map(data);
      for(const op of ops)if(op.type==='put')next.set(op.key,op.value);
      try{persist(next);}catch{throw Error('durable write failed');}
      data=next;
    },
  };
}
