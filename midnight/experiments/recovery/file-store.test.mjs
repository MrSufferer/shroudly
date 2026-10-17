import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileStore} from './file-store.mjs';

const dir=()=>mkdtempSync(join(tmpdir(),'recovery-file-store-'));

test('commits survive reopening and honor compare-and-swap atomically', async()=>{
  const d=dir();
  try{
    const a=fileStore(join(d,'journal.json'));
    await a.commit([{type:'put',key:'k/a',value:'1',expect:null}]);
    await assert.rejects(a.commit([{type:'put',key:'k/b',value:'2',expect:null},{type:'put',key:'k/a',value:'3',expect:'stale'}]),/write conflict/);
    const b=fileStore(join(d,'journal.json'));
    assert.equal(await b.get('k/a'),'1');
    assert.equal(await b.get('k/b'),undefined);
    assert.deepEqual(await b.list('k/'),[['k/a','1']]);
    assert.deepEqual(readdirSync(d),['journal.json']);
  }finally{rmSync(d,{recursive:true,force:true});}
});

test('a corrupt journal file is an error, never an empty store', async()=>{
  const d=dir();
  try{
    writeFileSync(join(d,'journal.json'),'{"truncated');
    assert.throws(()=>fileStore(join(d,'journal.json')),/corrupt/);
  }finally{rmSync(d,{recursive:true,force:true});}
});
