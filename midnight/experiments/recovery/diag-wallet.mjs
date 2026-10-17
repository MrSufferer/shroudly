import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Prints only numeric sync progress and stage categories; child output is discarded.
if(process.argv[2]==='--worker'){
  const started=Date.now();
  try{
    const {openWalletWithProgress}=await import('./open-wallet.mjs');
    const opened=await openWalletWithProgress(process.argv[3],{timeoutMs:Number(process.argv[4]),onProgress:p=>process.send?.({ms:Date.now()-started,...p})});
    process.send?.({stage:'synchronized',ms:Date.now()-started,night:Object.values(opened.state.unshielded.balances).some(v=>v>0n),dust:opened.state.dust.balance(new Date())>0n});
    await opened.close();
  }catch(error){process.send?.({stage:`failed-${error?.stage??'unknown'}`,ms:Date.now()-started});}
  process.exit();
}else{
  const child=fork(fileURLToPath(import.meta.url),['--worker',process.argv[2],process.argv[3]??'1500000'],{stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',m=>console.log(JSON.stringify(m)));
  const timer=setTimeout(()=>child.kill('SIGKILL'),Number(process.argv[4]??1600000));
  child.on('exit',()=>{clearTimeout(timer);console.log('{"exit":true}');});
}
