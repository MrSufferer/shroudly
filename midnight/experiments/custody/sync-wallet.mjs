import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Child stdout/stderr never enter evidence: SDKs may log sensitive URLs/errors.
if(process.argv[2]==='--worker'){
  let opened;
  try{
    const {openProtectedWallet}=await import('./protected-wallet.mjs');
    let last=0;opened=await openProtectedWallet(process.argv[3],undefined,progress=>{if(Date.now()-last>20000){last=Date.now();process.send?.({progress});}},process.env.SHROUDLY_CUSTODY_WALLET_CACHE||'/tmp/shroudly-custody-wallet-cache');
    const night=Object.values(opened.state.unshielded.balances).some(value=>value>0n);
    const dust=opened.state.dust.balance(new Date())>0n;
    process.send?.({synchronized:true,nightFunded:night,dustFunded:dust});
  }catch(error){process.send?.({synchronized:false,category:'protected-wallet-not-established',stage:['initialization','startup','synchronization'].includes(error?.stage)?error.stage:'configuration',timedOut:error?.timedOut===true});}
  finally{await opened?.close().catch(()=>{});process.exit();}
}else{
  if(!process.argv[2])throw Error('Pass the protected local environment file path');
  const started=Date.now();
  const child=fork(fileURLToPath(import.meta.url),['--worker',process.argv[2]],{stdio:['ignore','ignore','ignore','ipc']});
  let observation;
  const timer=setTimeout(()=>child.kill('SIGKILL'),960000);
  child.on('message',message=>{
    if(message?.progress){console.error(JSON.stringify({progress:message.progress,at:new Date().toISOString()}));return;}
    // Explicit projection only; never print arbitrary child data.
    observation=message?.synchronized===true?{synchronized:true,nightFunded:message.nightFunded===true,dustFunded:message.dustFunded===true}:{synchronized:false,category:'protected-wallet-not-established',stage:['initialization','startup','synchronization','configuration'].includes(message?.stage)?message.stage:'configuration',timedOut:message?.timedOut===true};
  });
  child.on('exit',()=>{
    clearTimeout(timer);
    const result=observation??{synchronized:false,category:'worker-exited-without-observation'};
    console.log(JSON.stringify({format:'shroudly-custody-wallet-sync-v1',checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,...result,networkTransactions:0,releaseQualified:false},null,2));
    process.exitCode=result.synchronized?0:1;
  });
}
