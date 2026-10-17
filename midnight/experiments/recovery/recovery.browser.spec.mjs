import {test,expect,chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {startStaticServer} from './static-server.mjs';

// Real desktop Chrome, synthetic data only. Qualifies IndexedDB durability,
// atomic commits, Web Locks exclusion and abrupt-kill recovery.
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results={format:'shroudly-recovery-browser-qualification-v1',synthetic:true};
let server;
test.beforeAll(async()=>{server=await startStaticServer();});
test.afterAll(async()=>{
  await server.close();
  mkdirSync(new URL('./results/',import.meta.url),{recursive:true});
  writeFileSync(new URL('./results/browser-qualification.json',import.meta.url),JSON.stringify({...results,checkedAt:new Date().toISOString()},null,2)+'\n');
});

async function openPage(context) {
  const page=await context.newPage();
  await page.goto(server.url);
  await page.waitForFunction(()=>window.recoveryReady===true);
  return page;
}
async function launchRawChrome(dir) {
  const child=spawn(CHROME,[`--user-data-dir=${dir}`,'--remote-debugging-port=0','--headless=new','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  const file=join(dir,'DevToolsActivePort');
  for(let i=0;i<100;i+=1){
    try{
      const [port]=readFileSync(file,'utf8').split('\n');
      const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      return {child,browser};
    }catch{await sleep(100);}
  }
  child.kill('SIGKILL');throw Error('Chrome did not start');
}
const SCOPE={network:'preprod',deployment:'dep-A',participant:'p-1'};

test('storage qualification: IndexedDB strict durability and Web Locks are available; persistence is recorded', async({browser})=>{
  const context=await browser.newContext();
  const page=await openPage(context);
  const observed=await page.evaluate(async()=>{
    const q=await window.recovery.qualifyStorage({indexedDB,storage:navigator.storage,locks:navigator.locks});
    return q;
  });
  results.storage={...observed,chrome:browser.version()};
  expect(observed.indexedDB).toBe(true);
  expect(observed.strictDurability).toBe(true);
  expect(observed.webLocks).toBe(true);
  await context.close();
});

test('IndexedDB commits are atomic compare-and-swap writes', async({browser})=>{
  const context=await browser.newContext();
  const page=await openPage(context);
  const outcome=await page.evaluate(async()=>{
    const store=await window.recovery.idbStore({indexedDB,name:'atomic-'+Math.random()});
    await store.commit([{type:'put',key:'k/a',value:'1',expect:null}]);
    let conflict=false;
    try{await store.commit([{type:'put',key:'k/b',value:'2',expect:null},{type:'put',key:'k/a',value:'3',expect:'stale'}]);}catch{conflict=true;}
    return {conflict,a:await store.get('k/a'),b:await store.get('k/b')??null,listed:(await store.list('k/')).length};
  });
  expect(outcome).toEqual({conflict:true,a:'1',b:null,listed:1});
  await context.close();
});

test('two tabs: one writer at a time; closing the writer releases exclusion and the journal stays unresolved', async({browser})=>{
  const context=await browser.newContext();
  const first=await openPage(context),second=await openPage(context);
  const boot=(page,db)=>page.evaluate(async({db,scope})=>{
    const r=window.recovery;
    const writer=await r.acquireWriter({locks:navigator.locks,scope});
    const store=await r.idbStore({indexedDB,name:db});
    const journal=await r.openJournal({store,scope,key:await r.sessionKeyFromKit('0x'+'09'.repeat(32)),writer});
    window.__w={writer,journal};
    if(journal.current()===null){
      await journal.initialize({secret:new Uint8Array(32).fill(7),round:0n});
      await journal.prepare({actionId:'a1',circuit:'advance',base:{round:0n,commitment:'0x00'},expected:{round:1n,commitment:'0x01'},nextPrivateState:{secret:new Uint8Array(32).fill(7),round:1n}});
    }
    return true;
  },{db,scope:SCOPE});
  await boot(first,'two-tabs');
  await expect(boot(second,'two-tabs')).rejects.toThrow(/active writer/);
  await first.evaluate(()=>window.__w.writer.release());
  await first.close();
  await sleep(200);
  const reopened=await second.evaluate(async({scope})=>{
    const r=window.recovery;
    const writer=await r.acquireWriter({locks:navigator.locks,scope});
    const journal=await r.openJournal({store:await r.idbStore({indexedDB,name:'two-tabs'}),scope,key:await r.sessionKeyFromKit('0x'+'09'.repeat(32)),writer});
    return (await journal.unresolved()).map(e=>e.actionId);
  },{scope:SCOPE});
  expect(reopened).toEqual(['a1']);
  results.writerExclusion={sameBrowserSecondTabRejected:true,releaseAllowsNewWriterAndKeepsUnresolvedAction:true};
  await context.close();
});

test('an abrupt browser kill after prepare preserves the encrypted journal and witness state', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shroudly-recovery-'));
  try{
    let raw=await launchRawChrome(dir);
    let context=raw.browser.contexts()[0];
    let page=await openPage(context);
    const kitKey=await page.evaluate(()=>window.recovery.generateKitKey());
    await page.evaluate(async({kitKey,scope})=>{
      const r=window.recovery;
      const writer=await r.acquireWriter({locks:navigator.locks,scope});
      const journal=await r.openJournal({store:await r.idbStore({indexedDB,name:'crash'}),scope,key:await r.sessionKeyFromKit(kitKey),writer});
      await journal.initialize({secret:new Uint8Array(32).fill(7),round:0n});
      await journal.prepare({actionId:'a1',circuit:'advance',base:{round:0n,commitment:'0x00'},expected:{round:1n,commitment:'0x01'},nextPrivateState:{secret:new Uint8Array(32).fill(7),round:1n}});
    },{kitKey,scope:SCOPE});
    raw.child.kill('SIGKILL');
    await sleep(500);
    rmSync(join(dir,'SingletonLock'),{force:true});rmSync(join(dir,'DevToolsActivePort'),{force:true});
    raw=await launchRawChrome(dir);
    context=raw.browser.contexts()[0];
    page=await openPage(context);
    const recovered=await page.evaluate(async({kitKey,scope})=>{
      const r=window.recovery;
      const writer=await r.acquireWriter({locks:navigator.locks,scope});
      const journal=await r.openJournal({store:await r.idbStore({indexedDB,name:'crash'}),scope,key:await r.sessionKeyFromKit(kitKey),writer});
      const [entry]=await journal.unresolved();
      return {generation:Number(journal.current().generation),round:Number(journal.current().privateState.round),secretBytes:journal.current().privateState.secret.length,status:entry.status,nextRound:Number(entry.nextPrivateState.round)};
    },{kitKey,scope:SCOPE});
    expect(recovered).toEqual({generation:0,round:0,secretBytes:32,status:'prepared',nextRound:1});
    results.abruptKill={signal:'SIGKILL',preparedEntrySurvived:true,witnessStateSurvived:true};
    raw.child.kill('SIGKILL');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('storage write failure (quota) blocks preparation so nothing can be submitted', async({browser})=>{
  const context=await browser.newContext();
  const page=await openPage(context);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin',{origin:server.url,quotaSize:1});
  const outcome=await page.evaluate(async({scope})=>{
    const r=window.recovery;
    const writer=await r.acquireWriter({locks:navigator.locks,scope});
    const journal=await r.openJournal({store:await r.idbStore({indexedDB,name:'quota'}),scope,key:await r.sessionKeyFromKit('0x'+'09'.repeat(32)),writer});
    let submitted=0;
    const executor={
      build:async state=>({base:{round:0n,commitment:'0x00'},expected:{round:1n,commitment:'0x01'},nextPrivateState:{...state,round:1n},payload:'x'.repeat(5_000_000)}),
      submit:async()=>{submitted+=1;return '0x'+'a'.repeat(64);},
      observe:async()=>null,queryLedger:async()=>({round:0n,commitment:'0x00'}),
    };
    try{await journal.initialize({secret:new Uint8Array(32).fill(7),round:0n});}catch(error){return {failedAt:'initialize',submitted,message:String(error.message)};}
    try{await r.runAction({journal,executor,actionId:'a1',pollMs:0,maxPolls:1});}catch(error){return {failedAt:'run',submitted,message:String(error.message)};}
    return {failedAt:null,submitted};
  },{scope:SCOPE});
  results.quotaFailure={...outcome,message:undefined};
  expect(outcome.failedAt).not.toBeNull();
  expect(outcome.submitted).toBe(0);
  await context.close();
});
