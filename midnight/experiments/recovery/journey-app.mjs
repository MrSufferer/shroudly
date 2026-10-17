import {randomBytes} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openJournal,sessionKeyFromKit} from './journal.mjs';
import {runAction,reconcile} from './actions.mjs';
import {exportKit,restoreKit,generateKitKey} from './kit.mjs';
import {fileStore} from './file-store.mjs';
import {createProbeRuntime} from './probe-runtime.mjs';
import {isFreshAgainst} from './ledger-view.mjs';
import {compiledProbe,ledger,pureCircuits,toHex,nodeProviders,indexerFetcher} from './journey-env.mjs';
import {fromHex} from './codec.mjs';

// The participant application of the live Preprod journey. It owns the
// encrypted journal; the parent process plays the wallet (proving, balancing,
// submission), exactly as Lace is separate from the page. The app can be
// SIGKILLed at any stage without affecting an already handed-off submission.
// Outputs are explicit projections: never witness material, URLs or SDK errors.
const config=JSON.parse(process.argv[2]);
const send=message=>new Promise(resolve=>process.send(message,resolve));
const crash=stage=>{if(config.crashAt===stage)process.kill(process.pid,'SIGKILL');};

const participantDir=join(config.stateDir,config.name);
mkdirSync(participantDir,{recursive:true,mode:0o700});
const kitPath=join(participantDir,'kit.key');

async function main() {
  const metaPath=join(participantDir,'participant.json');
  let kitKey,secret;
  if(config.cmd==='init') {
    kitKey=generateKitKey();secret=randomBytes(32);
    writeFileSync(kitPath,kitKey,{mode:0o600});chmodSync(kitPath,0o600);
  } else if(config.cmd==='restore-kit') {
    // The kit alone carries the key and scope: a fresh directory models a new browser profile.
    const kit=JSON.parse(readFileSync(config.kitFile,'utf8'));
    kitKey=kit.key;
    writeFileSync(kitPath,kitKey,{mode:0o600});chmodSync(kitPath,0o600);
    writeFileSync(metaPath,JSON.stringify({participantId:kit.scope.participant}),{mode:0o600});
  } else kitKey=readFileSync(kitPath,'utf8');
  await run(kitKey,secret,metaPath);
}

async function run(kitKey,secretIn,metaPath) {
  const scopeOf=participant=>({network:'preprod',deployment:config.deployment,participant});
  // Public identity is stored beside the journal so a restart can scope storage before decrypting.
  const meta=existsSync(metaPath)?JSON.parse(readFileSync(metaPath,'utf8')):null;
  const participant=meta?.participantId??`0x${toHex(pureCircuits.identity(secretIn))}`;
  if(!meta)writeFileSync(metaPath,JSON.stringify({participantId:participant}),{mode:0o600});
  const scope=scopeOf(participant);
  const store=fileStore(join(participantDir,'journal.json'));
  const writer={assertHeld(){}}; // one child at a time; Chrome qualifies Web Locks exclusion separately
  const providers=await nodeProviders({indexerHttp:config.routes.http,indexerWs:config.routes.ws,keys:config.keys});
  const compiledContract=await compiledProbe();
  const ledgerProtocol=await import('@midnight-ntwrk/midnight-js-protocol/ledger');
  const {createUnprovenCallTx}=await import('@midnight-ntwrk/midnight-js-contracts');
  let pending=new Map(),nextId=1;
  process.on('message',message=>{const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);waiter(message);}});
  const rpc=(type,payload)=>new Promise(resolve=>{const id=nextId++;pending.set(id,resolve);process.send({type,id,...payload});});
  const idBytes=fromHex(participant.slice(2));
  const runtime=createProbeRuntime({
    compiledContract,contractAddress:config.deployment,participantId:idBytes,providers,createUnprovenCallTx,
    deserializeUnproven:bytes=>ledgerProtocol.Transaction.deserialize('signature','pre-proof','pre-binding',bytes),
    submitUnproven:async(tx,circuit)=>{
      const request=rpc('submit',{bytes:toHex(tx.serialize()),circuit});
      crash('handoff');
      const reply=await request;
      if(reply.error)throw Object.assign(Error(reply.error),{phase:reply.error==='before-submit'?'before-submit':'after-submit'});
      return reply.txId;
    },
    readLedger:ledger,bind:pureCircuits.bind,indexerQuery:indexerFetcher(config.routes.http),
  });
  const key=await sessionKeyFromKit(kitKey);
  const isFresh=async state=>isFreshAgainst(await runtime.queryLedger(),state,pureCircuits.bind);
  if(config.cmd==='restore-kit')await restoreKit({kitText:readFileSync(config.kitFile,'utf8'),store,scope});
  const journal=await openJournal({store,scope,key,writer,isFresh});
  const hooks={after:stage=>crash(stage)};
  const pollMs=config.pollMs??5000;
  const outcome={cmd:config.cmd,name:config.name};
  if(config.cmd==='init'){
    await journal.initialize({secret:secretIn,round:0n});
    outcome.generation='0';
  } else if(config.cmd==='act') {
    const result=await runAction({journal,executor:runtime,actionId:config.actionId,circuit:config.circuit,pollMs,maxPolls:config.maxPolls,hooks});
    Object.assign(outcome,result);
  } else if(config.cmd==='reconcile') {
    outcome.results=await reconcile({journal,executor:runtime,pollMs,maxPolls:config.maxPolls??1,hooks});
  } else if(config.cmd==='export-kit') {
    writeFileSync(join(participantDir,'recovery-kit.json'),await exportKit({journal,kitKey}),{mode:0o600});
  }
  const current=journal.current();
  const view=await runtime.queryLedger().catch(()=>null);
  outcome.journal={generation:current&&String(current.generation),privateRound:current&&String(current.privateState.round),unresolved:(await journal.unresolved()).map(e=>({actionId:e.actionId,status:e.status,circuit:e.circuit}))};
  outcome.ledger=view&&{round:String(view.round),registered:view.round>=0n};
  outcome.fresh=current&&view?isFreshAgainst(view,current.privateState,pureCircuits.bind):null;
  await send({type:'done',outcome});
}
main().then(()=>process.exit(0),async error=>{await send({type:'failed',category:error?.message?.slice(0,120)?.replace(/https?:\S+|0x[0-9a-fA-F]{40,}/g,'<redacted>')??'unknown'});process.exit(1);});
