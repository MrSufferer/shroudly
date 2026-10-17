import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../../managed/custody-probe/contract/index.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { createHash } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const bytes=n=>new Uint8Array(32).fill(n);
// Synthetic, public test-only fixture: never a protected wallet or participant.
const witnesses=Object.fromEntries(['owner','first','second','third'].map((name,i)=>[name,({privateState})=>[privateState,bytes(i+1)]]));
witnesses.spendable=()=>{throw Error('network-qualified coin required');};
witnesses.recipient=()=>{throw Error('no release in this local proof probe');};
const contract=new Contract(witnesses);
let state=contract.initialState(RT.createConstructorContext({},'0'.repeat(64))).currentContractState;
const managed=new URL('../../managed/custody-probe/',import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
const artifacts={};
for(const directory of ['contract','keys','zkir'])for(const name of readdirSync(new URL(`${directory}/`,managed)).sort()){
  if(name.endsWith('.map')||name.endsWith('.d.ts'))continue;
  artifacts[`${directory}/${name}`]=hash(readFileSync(new URL(`${directory}/${name}`,managed)));
}
const sourceHash=hash(readFileSync(new URL('./CustodyProbe.compact',import.meta.url)));
const provider=httpClientProvingProvider('http://127.0.0.1:6300',new NodeZkConfigProvider(managed.pathname),{timeout:120000});
const results=[];
for(const [circuit,args]of [['seed',[]],['allocateYield',[1n,0n,1n]]]){
  const started=performance.now();
  const call=contract.impureCircuits[circuit](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,{}),...args);
  const p=call.proofData;
  const preimage=RT.proofDataIntoSerializedPreimage(p.input,p.output,p.publicTranscript,p.privateTranscriptOutputs,circuit);
  try{
    const proof=await provider.prove(preimage,circuit);
    results.push({circuit,proved:true,proofBytes:proof.byteLength,proofSha256:hash(proof),elapsedMs:Math.round(performance.now()-started)});
  }catch{
    results.push({circuit,proved:false,category:'local-proof-request-failed',elapsedMs:Math.round(performance.now()-started)});
    process.exitCode=1;break;
  }
  state=call.context.currentQueryContext.state;
}
console.log(JSON.stringify({format:'shroudly-custody-local-proof-v1',checkedAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash,artifacts,fixture:'synthetic-public-values',networkTransactions:0,releaseQualified:false,results},null,2));
