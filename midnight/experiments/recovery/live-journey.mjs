import {fork} from 'node:child_process';
import * as Rx from 'rxjs';
import {mkdirSync,mkdtempSync,rmdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {openWalletWithProgress} from './open-wallet.mjs';
import {compiledProbe,nodeProviders,indexerFetcher,LOCK} from './journey-env.mjs';
import {fromHex} from './codec.mjs';
import {TX_QUERY} from './probe-runtime.mjs';
import {assessJourney} from './journey-assess.mjs';
import {abortSummary,errorDetail} from './error-detail.mjs';
import {dustView,waitForIndexerAtNode,waitForFreshDust,nodeFinalizedHeight,indexerTipHeight} from './dust-freshness.mjs';

// Live Preprod journey orchestrator (Node participant, protected wallet as the
// wallet service). Output is a sanitized evidence record: public transaction
// identifiers, ledger rounds, outcomes and timings only. Child stdio is
// discarded; SDK errors are recorded only as redacted cause chains
// (error-detail.mjs), never raw, so no URL, key, token or secret is printed.
//
// usage: node live-journey.mjs <protected-env-file> [stateDir]
// Supervisor: run the journey in a worker whose stdio is discarded, because SDK
// dependencies log connection URLs and errors. Only explicit IPC projections print.
if(process.argv[2]!=='--worker') {
  const worker=fork(fileURLToPath(import.meta.url),['--worker',...process.argv.slice(2)],{stdio:['ignore','ignore','ignore','ipc']});
  worker.on('message',message=>console.log(JSON.stringify(message)));
  worker.on('exit',(code,signal)=>{console.log(JSON.stringify({workerExit:signal??code}));process.exit(code??1);});
  await new Promise(()=>{});
}
const [,,,envPath,stateArg]=process.argv;
if(!envPath)throw Error('Pass the protected local environment file path');
const stateDir=stateArg??mkdtempSync(join(tmpdir(),'shroudly-recovery-journey-'));
mkdirSync(stateDir,{recursive:true,mode:0o700});chmodSync(stateDir,0o700);
const here=fileURLToPath(new URL('.',import.meta.url));
const evidence={format:'shroudly-recovery-live-preprod-node-v1',network:'preprod',participantApp:'node (not Lace)',walletService:'protected wallet in this parent process',startedAt:new Date().toISOString(),steps:[],submissions:[]};
const started=Date.now();
const step=(name,data={})=>{const entry={name,atMs:Date.now()-started,...data};evidence.steps.push(entry);process.send?.(JSON.parse(JSON.stringify(entry,(_,v)=>typeof v==='bigint'?v.toString():v)));};

async function acquireLock() {
  for(;;) {
    try{mkdirSync(LOCK);return;}catch(error){if(error.code!=='EEXIST')throw error;await sleep(5000);}
  }
}
const releaseLock=()=>{try{rmdirSync(LOCK);}catch{}};
// Another agent may have spent shared DUST while this process waited for the lock.
const trace=(stage,data={})=>process.send?.({submitStage:stage,atMs:Date.now()-started,...data});

const opened=await openWalletWithProgress(envPath,{timeoutMs:7_200_000,onProgress:p=>process.send?.({syncProgress:p,atMs:Date.now()-started})})
  .catch(error=>{process.send?.({result:'aborted',abortCategory:'wallet-not-synchronized',abortDetail:errorDetail(error),stage:error?.stage,attempts:error?.attempts,atMs:Date.now()-started},()=>process.exit(1));return new Promise(()=>{});});
let dustFunded=null;try{dustFunded=opened.state.dust.balance(new Date())>0n;}catch{}
step('wallet-synchronized',{fromCache:opened.fromCache,dustFunded});
const keys={coinPublicKey:opened.shielded.coinPublicKey,encryptionPublicKey:opened.shielded.encryptionPublicKey};
const routes={http:opened.configuration.indexerClientConnection.indexerHttpUrl,ws:opened.configuration.indexerClientConnection.indexerWsUrl};
const providers=await nodeProviders({indexerHttp:routes.http,indexerWs:routes.ws,keys});
const ledgerProtocol=await import('@midnight-ntwrk/midnight-js-protocol/ledger');
const contracts=await import('@midnight-ntwrk/midnight-js-contracts');
const query=indexerFetcher(routes.http);

// A wallet session balances only its first transaction: on Preprod a second
// balance in the same session busy-looped (GC-bound) for >8 min in two runs, so
// every submission opens a fresh session restored from the owner-only cache.
// The startup session stays open only for its loopback provider routes.
await opened.wallet.stop().catch(()=>{});
const walletProviderFor=session=>({
  ...providers.walletProvider,
  balanceTx:async(tx,ttl=new Date(Date.now()+30*60*1000))=>{
    trace('balancing',dustView(await Rx.firstValueFrom(session.wallet.state())));
    const recipe=await session.wallet.balanceUnboundTransaction(tx,{shieldedSecretKeys:session.shielded,dustSecretKey:session.dust},{ttl});
    const finalized=await session.wallet.finalizeRecipe(recipe);
    trace('balanced');
    return finalized;
  },
});
// Opened after taking the lock, so it observes every earlier holder's spend,
// provided the indexer has caught up with the node: the wallet only counts
// itself synced against the indexer tip. Both waits are bounded and traced;
// if they expire the session is used anyway and the trace shows the view.
async function signingSession() {
  const session=await openWalletWithProgress(envPath,{timeoutMs:1_200_000});
  trace('session-synced',dustView(session.state));
  const rpcHttp=String(session.configuration.relayURL).replace(/^ws/,'http');
  const caughtUp=await waitForIndexerAtNode({nodeHeight:nodeFinalizedHeight(rpcHttp),indexerHeight:indexerTipHeight(indexerFetcher(session.configuration.indexerClientConnection.indexerHttpUrl))});
  trace('indexer-at-node',caughtUp);
  const dust=await waitForFreshDust({syncedState:()=>session.wallet.waitForSyncedState()});
  trace(dust.ready?'dust-ready':'dust-wait-expired',{...dust.view,waitedMs:dust.waitedMs});
  return session;
}
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
  trace('lock-acquired',{circuit:message.circuit});
  let handedOff=false,txId,session;
  try{
    try{session=await signingSession();}
    catch(error){trace('session-failed',{detail:errorDetail(error)});child.connected&&child.send({id:message.id,error:'before-submit'});evidence.submissions.push({...counted,outcome:'not-submitted'});return;}
    const walletProvider=walletProviderFor(session);
    const unprovenTx=ledgerProtocol.Transaction.deserialize('signature','pre-proof','pre-binding',fromHex(message.bytes));
    const midnightProvider={submitTx:async tx=>{handedOff=true;trace('handing-off');return session.wallet.submitTransaction(tx);}};
    try{txId=await Promise.race([contracts.submitTxAsync({...providers,walletProvider,midnightProvider},{unprovenTx,circuitId:message.circuit}),sleep(1_200_000).then(()=>{throw Error('submit-timeout');})]);}
    catch(error){const detail=errorDetail(error);trace('submit-failed',{timeout:error?.message==='submit-timeout',handedOff,detail});child.connected&&child.send({id:message.id,error:handedOff?'after-submit':'before-submit'});evidence.submissions.push({...counted,outcome:handedOff?'unknown':'not-submitted',detail});return;}
    evidence.submissions.push({...counted,txId,outcome:'handed-off'});
    child.connected&&child.send({id:message.id,txId});
    trace('handed-off');
    const status=await waitFinal(txId);
    trace('final',{status});
    evidence.submissions.at(-1).finalStatus=status;
  } finally{await session?.close();releaseLock();}
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
  let session;
  try{
    session=await signingSession();
    const walletProvider=walletProviderFor(session);
    const compiledContract=await compiledProbe();
    const midnightProvider={submitTx:async tx=>{trace('handing-off',{circuit:'deploy'});return session.wallet.submitTransaction(tx);}};
    const deployed=await contracts.deployContract({...providers,walletProvider,midnightProvider,privateStateProvider:shim()},{compiledContract,args:[]});
    return {address:deployed.deployTxData.public.contractAddress,txId:deployed.deployTxData.public.txId};
  } finally{await session?.close();releaseLock();}
}

try{
  if(dustFunded===false)throw Error('no-dust-for-fees');
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
  evidence.assessment=assessJourney(evidence);
  evidence.result=evidence.assessment.passed?'completed':'failed-checks';
} catch(error) {
  evidence.result='aborted';Object.assign(evidence,abortSummary(error));
} finally{
  evidence.finishedAt=new Date().toISOString();
  await opened.close().catch(()=>{});
  const out=join(here,'results','live-preprod-node.json');
  mkdirSync(join(here,'results'),{recursive:true});
  writeFileSync(out,JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
  process.send?.({result:evidence.result,abortCategory:evidence.abortCategory,abortDetail:evidence.abortDetail,failures:evidence.assessment?.failures,steps:evidence.steps.length,stateDir});
  process.exit(evidence.result==='completed'?0:1);
}
