import {setTimeout as delay} from 'node:timers/promises';

// Freshness guards run after the shared-wallet lock is taken and before a
// transaction is balanced. Another agent may have spent the shared DUST just
// before the lock was released; balancing with a coin the node already saw
// spent is rejected only at submission. Both waits are bounded and report
// rather than abort, so the caller records the view it balanced with.

// Sanitized DUST view: counts, booleans and the public sync gap only.
export const dustView=(state,now=new Date())=>{
  try{
    const dust=state.dust;
    const progress=dust.progress??dust.state?.progress;
    const gap=progress?Number(progress.highestRelevantWalletIndex-progress.appliedIndex):null;
    return {
      dustPositive:dust.balance(now)>0n,
      dustAvailable:(dust.availableCoins??[]).length,
      dustPending:(dust.pendingCoins??[]).length,
      dustSynced:progress?.isConnected===true&&gap===0,
      dustGap:gap,
    };
  }catch{return {};}
};
export const dustReady=view=>view.dustSynced===true&&view.dustPositive===true&&view.dustAvailable>0&&view.dustPending===0;

// The wallet counts itself synced against the indexer tip, so a lagging indexer
// hides a spend the node already finalized. Wait for the indexer to reach the
// node's finalized height (bounded; provider errors count as not caught up).
export async function waitForIndexerAtNode({nodeHeight,indexerHeight,timeoutMs=300000,intervalMs=5000,now=Date.now,sleep=delay}) {
  const started=now();
  let node=null,indexer=null;
  for(;;) {
    try{node=await nodeHeight();indexer=await indexerHeight();}catch{}
    if(Number.isFinite(node)&&Number.isFinite(indexer)&&indexer>=node)return {caughtUp:true,nodeHeight:node,indexerHeight:indexer,waitedMs:now()-started};
    if(now()-started+intervalMs>timeoutMs)return {caughtUp:false,nodeHeight:node,indexerHeight:indexer,waitedMs:now()-started};
    await sleep(intervalMs);
  }
}

// Re-read a freshly synced wallet state until DUST is synced, positive,
// available and not pending (bounded; a hanging read counts as not ready).
export async function waitForFreshDust({syncedState,timeoutMs=600000,intervalMs=10000,readTimeoutMs=120000,now=Date.now,sleep=delay}) {
  const started=now();
  let view={};
  for(;;) {
    let timer;
    try{
      const state=await Promise.race([syncedState(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('read timeout')),readTimeoutMs);})]);
      view=dustView(state);
    }catch{view={};}finally{clearTimeout(timer);}
    if(dustReady(view))return {ready:true,view,waitedMs:now()-started};
    if(now()-started+intervalMs>timeoutMs)return {ready:false,view,waitedMs:now()-started};
    await sleep(intervalMs);
  }
}

// Height probes over the token-free loopback routes.
export const nodeFinalizedHeight=rpcHttpUrl=>async()=>{
  const call=async(method,params=[])=>{
    const response=await fetch(rpcHttpUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw Error('node request failed');
    const body=await response.json();
    if(body.error)throw Error('node request rejected');
    return body.result;
  };
  const header=await call('chain_getHeader',[await call('chain_getFinalizedHead')]);
  return Number.parseInt(header.number,16);
};
export const indexerTipHeight=query=>async()=>(await query('query{block{height}}',{}))?.block?.height;
