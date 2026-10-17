import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWalletCache,saveWalletCache} from './wallet-cache.mjs';

const dir=()=>mkdtempSync(join(tmpdir(),'recovery-wallet-cache-'));
const complete=d=>{for(const p of ['shielded','unshielded','dust'])writeFileSync(join(d,`${p}.json`),`${p}-state`);return d;};

test('a synced wallet is resumed from the first complete cache, never from a partial one', ()=>{
  const partial=dir();writeFileSync(join(partial,'dust.json'),'dust-only');
  const full=complete(dir());
  assert.deepEqual(loadWalletCache([join(tmpdir(),'missing-cache-dir'),partial,full]),{shielded:'shielded-state',unshielded:'unshielded-state',dust:'dust-state'});
  assert.deepEqual(loadWalletCache([partial]),{});
});

test('a saved cache is private to the user and reloadable', ()=>{
  const d=join(dir(),'nested');
  saveWalletCache(d,{shielded:'s',unshielded:'u',dust:'d'});
  assert.equal(statSync(d).mode&0o777,0o700);
  assert.equal(statSync(join(d,'dust.json')).mode&0o777,0o600);
  assert.equal(readFileSync(join(d,'dust.json'),'utf8'),'d');
  assert.deepEqual(loadWalletCache([d]),{shielded:'s',unshielded:'u',dust:'d'});
});
