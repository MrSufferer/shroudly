// Action lifecycle over the durable journal. The executor is the only network
// boundary: build(privateState) -> {base,expected,nextPrivateState,payload},
// submit(entry) -> txId, observe(txId) -> {status,...}|null, queryLedger() -> {round,commitment}.
//
// Rules: nothing is submitted until prepare() is durable; 'submitting' is
// written before the handoff so a crash leaves a recorded unknown; observation
// timeouts and indexer absence never mark an action failed; only a definitive
// failure report with an unchanged ledger abandons an action.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const same=(a,b)=>a.commitment===b.commitment&&a.round===b.round;

export async function runAction({journal,executor,actionId,pollMs=2000,maxPolls=Infinity,hooks={},circuit='advance'}) {
  const state=journal.current();
  if(state===null)throw Error('private state is not initialized');
  const built=await executor.build(state.privateState);
  const entry=await journal.prepare({actionId,circuit,...built});
  await hooks.after?.('prepared');
  return settle({journal,executor,entry,pollMs,maxPolls,hooks});
}

export async function reconcile({journal,executor,pollMs=2000,maxPolls=Infinity,hooks={}}) {
  const results=[];
  for(const entry of await journal.unresolved())results.push({actionId:entry.actionId,...await settle({journal,executor,entry,pollMs,maxPolls,hooks})});
  return results;
}

async function settle({journal,executor,entry,pollMs,maxPolls,hooks}) {
  const id=entry.actionId;
  const finish=async(observation)=>{await journal.complete(id,observation);return {outcome:'completed'};};
  let fresh=await executor.queryLedger();
  if(same(fresh,entry.expected))return finish({via:'ledger'});
  if(!same(fresh,entry.base))return {outcome:'conflict',reason:'ledger moved to an unrelated state'};

  if(entry.status==='prepared') {
    entry=await journal.transition(id,'submitting');
    await hooks.after?.('submitting');
    let txId;
    try{txId=await executor.submit(entry);}
    catch(error) {
      if(error?.notSubmitted===true){await journal.transition(id,'prepared');return {outcome:'not-submitted',reason:'executor confirmed nothing was submitted'};}
      return {outcome:'pending',reason:'submission outcome unknown'};
    }
    entry=await journal.transition(id,'submitted',{txId});
    await hooks.after?.('submitted');
  }
  if(entry.status==='submitting')return {outcome:'pending',reason:'handoff outcome unknown; resubmission is blocked'};

  for(let poll=0;poll<maxPolls;poll+=1) {
    if(poll>0)await sleep(pollMs);
    let observation=null;
    try{observation=await executor.observe(entry.txId);}catch{observation=null;}
    fresh=await executor.queryLedger().catch(()=>fresh);
    if(same(fresh,entry.expected)){await hooks.after?.('finalized');return finish({via:observation?.status==='finalized'?'indexer':'ledger',txId:entry.txId});}
    if(!same(fresh,entry.base))return {outcome:'conflict',reason:'ledger moved to an unrelated state'};
    if(observation?.status==='failed'){await journal.transition(id,'abandoned',{reason:'transaction failed on ledger'});return {outcome:'abandoned'};}
  }
  return {outcome:'pending',reason:'finality not yet observed; the original action is still tracked'};
}
