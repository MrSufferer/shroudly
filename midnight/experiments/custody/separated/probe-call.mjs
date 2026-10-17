import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const directory = mkdtempSync(join(tmpdir(),'custody-authenticated-call-'));
try {
  const source = name => new URL(name,import.meta.url).pathname;
  const compile = (name,target) => spawnSync('compact',['compile','--skip-zk',source(name),join(directory,target)],{encoding:'utf8'});
  const asset = compile('AuthenticatedAsset.compact','AuthenticatedAsset');
  if(asset.status !== 0) throw Error('external target compilation failed');
  const result = compile('CrossContractPool.compact','CrossContractPool');
  const rejected = result.status !== 0 && /cross-contract calls are not yet supported/.test(result.stderr);
  console.log(JSON.stringify({format:'shroudly-authenticated-call-feasibility-v1',checkedAt:new Date().toISOString(),compiler:spawnSync('compact',['compile','--version'],{encoding:'utf8'}).stdout.trim(),ledger:spawnSync('compact',['compile','--ledger-version'],{encoding:'utf8'}).stdout.trim(),externalTargetCompiled:true,rejected,reason:rejected?'cross-contract calls are not yet supported':'unexpected compiler result',sources:Object.fromEntries(['AuthenticatedAsset.compact','CrossContractPool.compact'].map(name=>[name,createHash('sha256').update(readFileSync(source(name))).digest('hex')]))},null,2));
  process.exitCode = rejected ? 0 : 1;
} finally {rmSync(directory,{recursive:true,force:true});}
