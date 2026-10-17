import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';

// Serialized sub-wallet sync state (no seed is stored; keys are supplied at
// start). Kept outside the repository in owner-only files. An optimization only:
// a missing or partial cache means a full resynchronization.
const PARTS=['shielded','unshielded','dust'];

export function loadWalletCache(dirs) {
  for(const dir of dirs) {
    if(!dir||!PARTS.every(p=>existsSync(join(dir,`${p}.json`))))continue;
    try{return Object.fromEntries(PARTS.map(p=>[p,readFileSync(join(dir,`${p}.json`),'utf8')]));}catch{}
  }
  return {};
}

export function saveWalletCache(dir,parts) {
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  for(const p of PARTS) {
    if(typeof parts[p]!=='string')continue;
    const file=join(dir,`${p}.json`);
    writeFileSync(`${file}.tmp`,parts[p],{mode:0o600});
    renameSync(`${file}.tmp`,file);
  }
}
