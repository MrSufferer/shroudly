import {fork} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {openWalletWithProgress} from './open-wallet.mjs';
import {compiledProbe,nodeProviders,indexerFetcher,LOCK} from './journey-env.mjs';
import {fromHex} from './codec.mjs';
import {TX_QUERY} from './probe-runtime.mjs';

// Live Preprod journey orchestrator (Node participant, protected wallet as the
// wallet service). Output is a sanitized evidence record: public transaction
// identifiers, ledger rounds, outcomes and timings only. Child stdio is
// discarded; nothing here prints URLs, keys, secrets or SDK errors.
//
// usage: node live-journey.mjs <protected-env-file> [stateDir]
const [,,envPath,stateArg]=process.argv;
if(!envPath)throw Error('Pass the protected local environment file path');
const stateDir=stateArg??mkdtempSync(join(tmpdir(),'shroudly-recovery-journey-'));
mkdirSync(stateDir,{recursive:true,mode:0o700});chmodSync(stateDir,0o700);
const here=fileURLToPath(new URL('.',import.meta.url));
const evidence={format:'shroudly-recovery-live-preprod-node-v1',network:'preprod',participantApp:'node (not Lace)',walletService:'protected wallet in this parent process',startedAt:new Date().toISOString(),steps:[],submissions:[]};
const started=Date.now();
const step=(name,data={})=>{evidence.steps.push({name,atMs:Date.now()-started,...data});};

async function acquireLock() {
  for(;;) {
    try{mkdirSync(LOCK);return;}catch(error){if(error.code!=='EEXIST')throw error;await sleep(5000);}
  }
}
const releaseLock=()=>{try{rmdirSync(LOCK);}catch{}};

const opened=await openWalletWithProgress(envPath,{timeoutMs:3_000_000});
step('wallet-synchronized');
const keys={coinPublicKey:opened.shielded.coinPublicKey,encryptionPublicKey:opened.shielded.encryptionPublicKey};
const routes={http:opened.configuration.indexerClientConnection.indexerHttpUrl,ws:opened.configuration.indexerClientConnection.indexerWsUrl};
const providers=await nodeProviders({indexerHttp:routes.http,indexerWs:routes.ws,keys});
const ledgerProtocol=await import('@midnight-ntwrk/midnight-js-protocol/ledger');
const contracts=await import('@midnight-ntwrk/midnight-js-contracts');
const query=indexerFetcher(routes.http);

const walletProvider={
  ...providers.walletProvider,
  balanceTx:async(tx,ttl=new Date(Date.now()+30*60*1000))=>{
    const recipe=await opened.wallet.balanceUnboundTransaction(tx,{shieldedSecretKeys:opened.shielded,dustSecretKey:opened.dust},{ttl});
    return opened.wallet.finalizeRecipe(recipe);
  },
};
const shim=()=>{
  const signing=new Map();
  return {setContractAddress(){},setSigningKey:async(a,k)=>{signing.set(a,k);},getSigningKey:async a=>signing.get(a)??null,get:async()=>null,set:async()=>{}};
};

async function waitFinal(txId,timeoutMs=900000) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    const data=await query(TX_QUERY,{offset:{identifier:txId}}).catch(()=>null);
    const [tx]=data?.transactions??[];
    if(tx?.transactionResult?.status)return tx.transactionResult.status;
    await sleep(5000);
  }
  return 'timeout';
}

// Wallet-side submission service. The lock covers prove -> submit -> finality
// so that concurrent agents never spend the same DUST coins.
async function submitForApp(message,child) {
  const counted={circuit:message.circuit,at:Date.now()-started};
  await acquireLock();
  let handedOff=false,txId;
  try{
    const unprovenTx=ledgerProtocol.Transaction.deserialize('signature','pre-proof','pre-binding',fromHex(message.bytes));
    const midnightProvider={submitTx:async tx=>{handedOff=true;return opened.wallet.submitTransaction(tx);}};
    try{txId=await contracts.submitTxAsync({...providers,walletProvider,midnightProvider},{unprovenTx,circuitId:message.circuit});}
    catch{child.connected&&child.send({id:message.id,error:handedOff?'after-submit':'before-submit'});evidence.submissions.push({...counted,outcome:handedOff?'unknown':'not-submitted'});return;}
    evidence.submissions.push({...counted,txId,outcome:'handed-off'});
    child.connected&&child.send({id:message.id,txId});
    const status=await waitFinal(txId);
    evidence.submissions.at(-1).finalStatus=status;
  } finally{releaseLock();}
}

function app(config) {
  return new Promise(resolve=>{
    const child=fork(join(here,'journey-app.mjs'),[JSON.stringify({stateDir,routes,keys,deployment:evidence.deployment,...config})],{stdio:['ignore','ignore','ignore','ipc']});
    const result={config:{cmd:config.cmd,name:config.name,circuit:config.circuit,crashAt:config.crashAt}};
    const work=[];
    child.on('message',message=>{
      if(message.type==='submit')work.push(submitForApp(message,child));
      if(message.type==='done')result.outcome=message.outcome;
      if(message.type==='failed')result.failed=message.category;
    });
    child.on('exit',(code,signal)=>{result.exit=signal??code;Promise.allSettled(work).then(()=>resolve(result));});
  });
}
const record=(name,result)=>{step(name,{exit:result.exit,failed:result.failed,outcome:result.outcome});return result;};

async function deploy() {
  await acquireLock();
  try{
    const compiledContract=await compiledProbe();
    const midnightProvider={submitTx:tx=>opened.wallet.submitTransaction(tx)};
    const deployed=await contracts.deployContract({...providers,walletProvider,midnightProvider,privateStateProvider:shim()},{compiledContract,args:[]});
    return {address:deployed.deployTxData.public.contractAddress,txId:deployed.deployTxData.public.txId};
  } finally{releaseLock();}
}

try{
  if(existsSync(join(stateDir,'deployment.json'))) {
    const saved=JSON.parse(readFileSync(join(stateDir,'deployment.json'),'utf8'));
    evidence.deployment=saved.address;evidence.deploymentTx=saved.txId;
  } else {
    const deployed=await deploy();
    evidence.deployment=deployed.address;evidence.deploymentTx=deployed.txId;
    writeFileSync(join(stateDir,'deployment.json'),JSON.stringify(deployed));
  }
  step('deployed',{contract:evidence.deployment,txId:evidence.deploymentTx});

  record('init-alice',await app({cmd:'init',name:'alice'}));
  record('register',await app({cmd:'act',name:'alice',circuit:'register',actionId:'register-1'}));
  record('export-kit-after-register',await app({cmd:'export-kit',name:'alice'}));
  writeFileSync(join(stateDir,'kit-after-register.json'),readFileSync(join(stateDir,'alice','recovery-kit.json')),{mode:0o600});

  record('crash-before-submission',await app({cmd:'act',name:'alice',circuit:'advance',actionId:'advance-1',crashAt:'prepared'}));
  record('restart-reconcile-original',await app({cmd:'reconcile',name:'alice',maxPolls:200}));

  record('crash-during-observation',await app({cmd:'act',name:'alice',circuit:'advance',actionId:'advance-2',crashAt:'submitted'}));
  record('restart-reconcile-observed',await app({cmd:'reconcile',name:'alice',maxPolls:200}));

  record('crash-after-finality',await app({cmd:'act',name:'alice',circuit:'advance',actionId:'advance-3',crashAt:'finalized'}));
  record('restart-reconcile-persist',await app({cmd:'reconcile',name:'alice',maxPolls:5}));

  record('crash-during-handoff',await app({cmd:'act',name:'alice',circuit:'advance',actionId:'advance-4',crashAt:'handoff'}));
  record('restart-reconcile-handoff',await app({cmd:'reconcile',name:'alice',maxPolls:200}));

  record('export-kit-current',await app({cmd:'export-kit',name:'alice'}));
  record('restore-current-kit-fresh-profile',await app({cmd:'restore-kit',name:'alice-restored',kitFile:join(stateDir,'alice','recovery-kit.json')}));
  record('advance-from-restored-kit',await app({cmd:'act',name:'alice-restored',circuit:'advance',actionId:'advance-5'}));
  record('restore-older-kit-is-stale',await app({cmd:'restore-kit',name:'alice-stale',kitFile:join(stateDir,'kit-after-register.json')}));
  record('stale-kit-cannot-act',await app({cmd:'act',name:'alice-stale',circuit:'advance',actionId:'stale-1',maxPolls:1}));

  record('init-bob-same-deployment',await app({cmd:'init',name:'bob'}));
  record('bob-unregistered-while-alice-registered',await app({cmd:'reconcile',name:'bob',maxPolls:1}));
  evidence.result='completed';
} catch(error) {
  evidence.result='aborted';evidence.abortCategory=error?.message?.slice(0,80)?.replace(/https?:\S+|0x[0-9a-fA-F]{40,}/g,'<redacted>');
} finally{
  evidence.finishedAt=new Date().toISOString();
  await opened.close().catch(()=>{});
  const out=join(here,'results','live-preprod-node.json');
  mkdirSync(join(here,'results'),{recursive:true});
  writeFileSync(out,JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
  console.log(JSON.stringify({result:evidence.result,steps:evidence.steps.length,stateDir}));
  process.exit(evidence.result==='completed'?0:1);
}
