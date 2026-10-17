// Reproducibility metadata only: never reads protected configuration or wallet state.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const hash = value => createHash('sha256').update(value).digest('hex');
export function evidenceManifest() {
  const artifacts = {};
  for (const name of ['custody-probe','separated-asset','separated-pool']) {
    for (const directory of ['contract','keys','zkir']) {
      const root = new URL(`../../managed/${name}/${directory}/`,import.meta.url);
      for (const file of readdirSync(root).sort()) {
        if (file.endsWith('.map') || file.endsWith('.d.ts')) continue;
        artifacts[`${name}/${directory}/${file}`] = hash(readFileSync(new URL(file,root)));
      }
    }
  }
  const sources = Object.fromEntries(['CustodyProbe.compact','separated/SeparatedAsset.compact','separated/SeparatedPool.compact','separated/CrossContractPool.compact','separated/AuthenticatedAsset.compact'].map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))]));
  const versions = Object.fromEntries(['@midnight-ntwrk/compact-runtime','@midnight-ntwrk/midnight-js-contracts','@midnight-ntwrk/midnight-js-protocol','@midnight-ntwrk/wallet-sdk','@midnight-ntwrk/ledger-v8'].map(name=>{
    let path = new URL(import.meta.resolve(name)).pathname;
    while (!path.endsWith('/package.json')) {
      path = path.slice(0,path.lastIndexOf('/'));
      try { const pkg = JSON.parse(readFileSync(`${path}/package.json`,'utf8')); if(pkg.name === name) return [name,pkg.version]; } catch {}
    }
  }));
  const executionScripts = Object.fromEntries(['runtime-state.mjs','journey.mjs','protected-wallet.mjs','provider-proxy.mjs','wallet-cache.mjs','reconciliation.mjs','evidence-manifest.mjs','separated/probe-call.mjs'].map(name=>[name,hash(readFileSync(new URL(name,import.meta.url)))]));
  return {executionScripts,workingTreeDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length > 0,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,versions,sources,artifacts,lockfileSha256:hash(readFileSync(new URL('../../../pnpm-lock.yaml',import.meta.url)))};
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(evidenceManifest(),null,2));
