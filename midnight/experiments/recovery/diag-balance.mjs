import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Dry-run balance diagnostic: opens a wallet session from the owner-only cache,
// builds a fresh RecoveryProbe deploy (default) or, given a journey state dir,
// restores kit-after-register.json into a fresh profile and prepares an advance
// through journey-app.mjs; either is balanced, but the submit hook
// throws, so nothing reaches the network and no DUST is spent. Prints only
// numeric DUST views, timings, RSS samples and a redacted cause chain plus the
// names of wasm frames from the deepest error. Child stdio is discarded.
//
// usage: node diag-balance.mjs <protected-env-file> [timeoutMs] [journeyStateDir]
if(process.argv[2]!=='--worker') {
  const child=fork(fileURLToPath(import.meta.url),['--worker',...process.argv.slice(2)],{stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',m=>console.log(JSON.stringify(m)));
  const timer=setTimeout(()=>{console.log('{"killed":"timeout"}');child.kill('SIGKILL');},Number(process.argv[3]??1_800_000));
  child.on('exit',code=>{clearTimeout(timer);console.log(JSON.stringify({workerExit:code}));process.exit(0);});
} else {
  const envPath=process.argv[3];
  const started=Date.now();
  const send=(stage,data={})=>process.send?.({stage,atMs:Date.now()-started,...data});
  const rss=setInterval(()=>send('rss',{mb:Math.round(process.memoryUsage().rss/1e6)}),30000);
  Error.stackTraceLimit=200;
  const {openWalletWithProgress}=await import('./open-wallet.mjs');
  const {compiledProbe,nodeProviders}=await import('./journey-env.mjs');
  const {dustView}=await import('./dust-freshness.mjs');
  const {errorDetail}=await import('./error-detail.mjs');
  const Rx=await import('rxjs');
  const contracts=await import('@midnight-ntwrk/midnight-js-contracts');
  const FIBER_CAUSE=Symbol.for('effect/Runtime/FiberFailure/Cause');
  const failedIn=c=>c&&(c.error??c.defect??failedIn(c.left)??failedIn(c.right));
  const deepest=e=>{let last=e;for(let i=0;e&&i<8;i++){last=e;e=typeof e==='object'?(e.cause??failedIn(e[FIBER_CAUSE])):undefined;}return last;};
  // Wasm frames are stripped, so keep the JS frames around them, trimmed to package-relative paths.
  const wasmFrames=e=>String(e?.stack??'').split('\n').filter(l=>/^\s*at /.test(l)).slice(0,40).map(l=>l.replace(/\/\S*\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/g,'').replace(/\/\S*\/midnight\/experiments\//g,'')).map(l=>l.trim().replace(/\(.*?(wasm:\/\/[^)]*)\)/,'($1)').replace(/\/Users\/\S+\//g,'')).map(l=>l.replace(/[0-9a-f]{24,}/gi,'<hex>'));
  try {
    const session=await openWalletWithProgress(envPath,{timeoutMs:1_200_000});
    send('session-synced',dustView(session.state));
    const keys={coinPublicKey:session.shielded.coinPublicKey,encryptionPublicKey:session.shielded.encryptionPublicKey};
    const providers=await nodeProviders({indexerHttp:session.configuration.indexerClientConnection.indexerHttpUrl,indexerWs:session.configuration.indexerClientConnection.indexerWsUrl,keys});
    const walletProvider={...providers.walletProvider,balanceTx:async(tx,ttl=new Date(Date.now()+30*60*1000))=>{
      send('balancing',dustView(await Rx.firstValueFrom(session.wallet.state())));
      const recipe=await session.wallet.balanceUnboundTransaction(tx,{shieldedSecretKeys:session.shielded,dustSecretKey:session.dust},{ttl});
      send('recipe-built');
      const finalized=await session.wallet.finalizeRecipe(recipe);
      send('balanced');
      return finalized;
    }};
    const midnightProvider={submitTx:async()=>{throw Error('dry-run-no-submit');}};
    const report=error=>{
      const dry=/dry-run-no-submit/.test(String(error?.message))||/dry-run-no-submit/.test(errorDetail(error));
      send(dry?'balance-ok-not-submitted':'balance-failed',{detail:errorDetail(error),wasm:dry?[]:wasmFrames(deepest(error))});
    };
    const stateDir=process.argv[5];
    if(stateDir) {
      const {fork:forkApp}=await import('node:child_process');
      const {readFileSync}=await import('node:fs');
      const {join}=await import('node:path');
      const ledgerProtocol=await import('@midnight-ntwrk/midnight-js-protocol/ledger');
      const {fromHex}=await import('./codec.mjs');
      const deployment=JSON.parse(readFileSync(join(stateDir,'deployment.json'),'utf8')).address;
      const routes={http:session.configuration.indexerClientConnection.indexerHttpUrl,ws:session.configuration.indexerClientConnection.indexerWsUrl};
      const app=config=>new Promise(resolve=>{
        const child=forkApp(fileURLToPath(new URL('./journey-app.mjs',import.meta.url)),[JSON.stringify({stateDir,routes,keys,deployment,...config})],{stdio:['ignore','ignore','ignore','ipc']});
        const out={};const work=[];
        child.on('message',m=>{
          if(m.type==='done')out.outcome=m.outcome;
          if(m.type==='failed')out.failed=m.category;
          if(m.type==='submit')work.push((async()=>{
            send('prepared',{circuit:m.circuit,bytes:m.bytes.length/2});
            const unprovenTx=ledgerProtocol.Transaction.deserialize('signature','pre-proof','pre-binding',fromHex(m.bytes));
            try{await contracts.submitTxAsync({...providers,walletProvider,midnightProvider},{unprovenTx,circuitId:m.circuit});send('unexpected-submit');}
            catch(error){report(error);}
            child.connected&&child.send({id:m.id,error:'before-submit'});
          })());
        });
        child.on('exit',code=>Promise.allSettled(work).then(()=>resolve({exit:code,...out})));
      });
      send('restore',await app({cmd:'restore-kit',name:'alice-diag',kitFile:join(stateDir,'kit-after-register.json')}));
      send('act',await app({cmd:'act',name:'alice-diag',circuit:'advance',actionId:'diag-1',maxPolls:1}));
      await session.close?.().catch(()=>{});
      clearInterval(rss);process.exit(0);
    }
    const shim={setContractAddress(){},setSigningKey:async()=>{},getSigningKey:async()=>null,get:async()=>null,set:async()=>{}};
    try {
      await contracts.deployContract({...providers,walletProvider,midnightProvider,privateStateProvider:shim},{compiledContract:await compiledProbe(),args:[]});
      send('unexpected-deploy-success');
    } catch(error) {report(error);}
    await session.close?.().catch(()=>{});
  } catch(error) {
    send('session-failed',{detail:errorDetail(error)});
  }
  clearInterval(rss);
  process.exit(0);
}
