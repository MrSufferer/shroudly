import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {startRelay} from './relay.mjs';
import {protectedConfiguration} from '../../custody/protected-wallet.mjs';

// Operator-run driver for the genuine browser journey. Modes:
//   preflight  headless Chrome, no wallet: proves the bundle builds a real unproven call against Preprod.
//   lace       headed Chrome with the Operator's Lace profile: the full lifecycle. The Operator approves
//              Lace prompts; the driver prints "OPERATOR ACTION" before each wait.
//
// usage: node lace-journey.mjs <protected-env-file> <preflight|lace> <contract-address>
// Output: sanitized evidence JSON only. Page console, URLs, keys, addresses and kits are never printed.
const [,,envPath,mode,contract]=process.argv;
if(!envPath||!['preflight','lace'].includes(mode)||!/^[0-9a-f]{64}$/.test(contract??''))throw Error('usage: lace-journey.mjs <protected-env-file> <preflight|lace> <64-hex contract address>');
const here=fileURLToPath(new URL('.',import.meta.url));
const PORT=4177;                       // fixed so the Operator's one-time Lace site approval persists
const LOCK='/tmp/shroudly-wallet.lock';
const evidence={format:`shroudly-recovery-browser-${mode}-v1`,network:'preprod',contract,startedAt:new Date().toISOString(),steps:[]};
const step=(name,data={})=>{evidence.steps.push({name,at:new Date().toISOString(),...data});console.log(JSON.stringify({step:name,...data}));};
const operator=message=>console.log(`OPERATOR ACTION: ${message}`);

let held=false;
async function acquireLock() {for(;;){try{mkdirSync(LOCK);held=true;return;}catch(e){if(e.code!=='EEXIST')throw e;await sleep(5000);}}}
const releaseLock=()=>{if(!held)return;held=false;try{rmdirSync(LOCK);}catch{}};

// Credential access: the relay holds the token; the seed is zeroed immediately and unused here.
const {env,token,seed}=protectedConfiguration(envPath);
seed.fill(0);
if(!existsSync(join(here,'dist/index.html')))execFileSync(process.execPath,[fileURLToPath(new URL('../../../node_modules/vite/bin/vite.js',import.meta.url)),'build','-c',join(here,'vite.config.mjs')],{stdio:'ignore'});
const ledger=await import('@midnight-ntwrk/ledger-v8');
const preflightSecret=ledger.ZswapSecretKeys.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
const relay=await startRelay({
  port:PORT,distDirectory:join(here,'dist'),managedDirectory:fileURLToPath(new URL('../../../managed',import.meta.url)),token,
  publicConfig:{contract,preflightKeys:{coinPublicKey:preflightSecret.coinPublicKey,encryptionPublicKey:preflightSecret.encryptionPublicKey}},
});
const userDataDir=env.MIDNIGHT_CHROME_USER_DATA_DIR;
let context;
const sanitize=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const freshPage=async()=>{
  const page=await context.newPage();
  const stages=[];
  page.on('console',message=>{const text=message.text();if(text.startsWith('HARNESS:'))stages.push(text.slice(8));});
  await page.goto(relay.url);
  await page.waitForFunction(()=>globalThis.harnessReady===true,null,{timeout:60000});
  page.stages=stages;
  return page;
};
const call=(page,fn,arg)=>page.evaluate(fn,arg);

try{
  if(mode==='preflight') {
    context=await (await chromium.launch({channel:'chrome',headless:true})).newContext();
    const page=await freshPage();
    step('no-wallet-connect-refused',{message:await call(page,async()=>{try{await globalThis.harness.connect();return 'connected';}catch(e){return e.message;}})});
    step('real-unproven-call-built',sanitize(await call(page,()=>globalThis.harness.preflightBuild())));
    evidence.result='completed';
  } else {
    if(!userDataDir||!existsSync(userDataDir))throw Error('Chrome profile directory is not configured');
    context=await chromium.launchPersistentContext(userDataDir,{channel:'chrome',headless:false,ignoreDefaultArgs:['--disable-extensions'],viewport:null});
    let page=await freshPage();
    step('storage',sanitize(await call(page,()=>globalThis.harness.storage())));
    operator('Unlock Lace if it is locked, then approve the connection request for http://127.0.0.1:4177 on Preprod.');
    step('connected',sanitize(await call(page,()=>globalThis.harness.connect())));
    const funding=sanitize(await call(page,()=>globalThis.harness.funding()));
    step('funding',funding);
    if(!funding.dustPositive)throw Error('Lace account has no DUST; fund and register DUST in Lace, then rerun');
    operator('Approve the account-binding signature request in Lace.');
    const participant=sanitize(await call(page,()=>globalThis.harness.createParticipant()));
    const kitDir=mkdtempSync(join(tmpdir(),'shroudly-kit-'));chmodSync(kitDir,0o700);
    const kitPath=join(kitDir,'kit.json');
    writeFileSync(kitPath,participant.kitText,{mode:0o600});
    step('participant-created-and-bound',{participantId:participant.participantId,addressDigest:participant.addressDigest});
    const run=async(circuit,actionId)=>{
      await acquireLock();
      try{operator(`Approve the Lace transaction request for ${circuit} (${actionId}).`);return sanitize(await call(page,a=>globalThis.harness.run(a.circuit,a.id),{circuit,id:actionId}));}
      finally{releaseLock();}
    };
    step('register',await run('register','register-1'));
    const afterRegisterKit=await call(page,()=>globalThis.harness.exportKit());

    // Interrupt at each stage by freezing the page at the stage, then closing it: a real tab loss.
    const crashScenarios=[['prepared','advance-1'],['submitted','advance-2'],['finalized','advance-3'],['handoff','advance-4']];
    for(const [stage,actionId] of crashScenarios) {
      await acquireLock();
      try{
        await page.evaluate(s=>{globalThis.__crashAt=s;},stage);
        operator(`Approve the Lace transaction request if prompted (${actionId}, tab will be closed at "${stage}").`);
        page.evaluate(a=>globalThis.harness.run('advance',a),actionId).catch(()=>{});
        for(let i=0;i<1800&&!page.stages.some(s=>s==='crashpoint');i+=1)await sleep(1000);
        step(`crashpoint-${stage}`,{reached:page.stages.includes('crashpoint')});
        await sleep(stage==='handoff'?20000:500);   // let a handed-off submission settle independently of the page
        await page.close();
        page=await freshPage();
        step(`restart-unlock-${stage}`,sanitize(await call(page,k=>globalThis.harness.unlock(k),readFileSync(kitPath,'utf8'))));
        await page.evaluate(()=>{globalThis.__maxPolls=240;});
        step(`restart-reconcile-${stage}`,sanitize(await call(page,()=>globalThis.harness.reconcile())));
      } finally{releaseLock();}
    }

    // Restore the complete witness material from the kit into a cleared browser database.
    const kitNow=await call(page,()=>globalThis.harness.exportKit());
    writeFileSync(kitPath,kitNow,{mode:0o600});
    await call(page,()=>globalThis.harness.lock());
    await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.deleteDatabase('shroudly-recovery-v1');r.onsuccess=r.onerror=r.onblocked=()=>resolve();}));
    step('restore-current-kit',sanitize(await call(page,k=>globalThis.harness.restore(k),kitNow)));
    step('restored-state',sanitize(await call(page,k=>globalThis.harness.unlock(k),kitNow)));
    step('advance-from-restored-kit',await run('advance','advance-5'));

    // A second tab must not become a second writer while this one holds the account.
    const second=await freshPage();
    step('second-tab-writer-refused',{message:await call(second,async k=>{try{await globalThis.harness.unlock(k);return 'unlocked';}catch(e){return e.message;}},kitNow)});
    await second.close();

    // An older kit decrypts but is stale against the ledger: new actions stay blocked.
    await call(page,()=>globalThis.harness.lock());
    await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.deleteDatabase('shroudly-recovery-v1');r.onsuccess=r.onerror=r.onblocked=()=>resolve();}));
    step('restore-older-kit',sanitize(await call(page,k=>globalThis.harness.restore(k),afterRegisterKit)));
    step('older-kit-unlocked',sanitize(await call(page,k=>globalThis.harness.unlock(k),afterRegisterKit)));
    step('older-kit-action-blocked',{message:await call(page,async()=>{try{await globalThis.harness.run('advance','stale-1');return 'ran';}catch(e){return e.message;}})});
    rmSync(kitDir,{recursive:true,force:true});
    evidence.result='completed';
  }
} catch(error) {
  evidence.result='aborted';
  evidence.abortCategory=String(error?.message??'unknown').slice(0,120).replace(/https?:\S+|0x[0-9a-fA-F]{40,}/g,'<redacted>');
} finally{
  releaseLock();
  evidence.finishedAt=new Date().toISOString();
  await context?.close().catch(()=>{});
  await relay.close();
  mkdirSync(join(here,'../results'),{recursive:true});
  writeFileSync(join(here,`../results/browser-${mode}.json`),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({result:evidence.result,abortCategory:evidence.abortCategory}));
  process.exit(evidence.result==='completed'?0:1);
}
