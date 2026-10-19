// Lace (DApp Connector 4.0.1) adapter for the recovery harness. Environment
// neutral: the ledger library and codecs are injected so Node tests and the
// browser bundle exercise the same decisions.
const LACE=/lace/i;

export function discoverWallets(midnight) {
  if(!midnight||typeof midnight!=='object')return [];
  return Object.entries(midnight)
    .filter(([,wallet])=>wallet&&typeof wallet.connect==='function'&&(LACE.test(String(wallet.rdns))||LACE.test(String(wallet.name))))
    .map(([key,wallet])=>({key,rdns:String(wallet.rdns),name:String(wallet.name),apiVersion:String(wallet.apiVersion),wallet}));
}

export function summarizeConfiguration(configuration) {
  const prover=configuration.proverServerUri;
  let proverLoopback=null;
  if(typeof prover==='string'&&prover) {
    try{proverLoopback=['127.0.0.1','localhost','[::1]'].includes(new URL(prover).hostname);}catch{proverLoopback=false;}
  }
  return {networkId:String(configuration.networkId),proverLoopback,proverConfigured:typeof prover==='string'&&prover.length>0};
}

// Lace rejects with an APIError whose message is just "APIError"; keep the call name and its code.
export const labelled=async(call,fn)=>{
  try{return await fn();}
  catch(e){throw Error(`${call}: ${[e?.code,e?.reason??e?.message].filter(Boolean).join(' ').slice(0,80)}`);}
};

export async function connectLace({midnight,networkId='preprod',unlockTimeoutMs=300_000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const [candidate]=discoverWallets(midnight);
  if(!candidate)throw Error('Lace was not found in window.midnight');
  let api;
  try{api=await candidate.wallet.connect(networkId);}
  catch{throw Error('Lace connection was rejected or failed');}
  // A previously approved origin connects at once even while Lace is locked; wait for the Operator to unlock.
  let status;
  for(const deadline=Date.now()+unlockTimeoutMs;;) {
    try{status=await labelled('getConnectionStatus',()=>api.getConnectionStatus());break;}
    catch(e){if(!/locked/i.test(e.message)||Date.now()>deadline)throw e;await sleep(2000);}
  }
  if(status?.status!=='connected')throw Error('Lace is not connected');
  if(status.networkId!==networkId)throw Error('Lace is connected to the wrong network');
  const configuration=await labelled('getConfiguration',()=>api.getConfiguration());
  if(configuration?.networkId!==networkId)throw Error('Lace is connected to the wrong network');
  return {api,rdns:candidate.rdns,name:candidate.name,apiVersion:candidate.apiVersion,configuration};
}

export const bindingChallenge=scope=>`shroudly-account-binding|v1|${scope.network}|${scope.deployment}|${scope.participant}`;

const textBytes=value=>new TextEncoder().encode(value);
const hexBytes=value=>/^(0x)?([0-9a-f]{2})+$/i.test(value)?Uint8Array.from(value.replace(/^0x/i,'').match(/../g),h=>parseInt(h,16)):null;

// The wallet signs the scope challenge with its unshielded key. The signature
// must verify against the verifying key the same wallet reports; the exact
// message framing is wallet-defined, so accepted framings are limited to the
// challenge itself or the signed `data` that must contain the challenge.
export async function verifyBinding({api,scope,ledger}) {
  const challenge=bindingChallenge(scope);
  const signed=await api.signData(challenge,{encoding:'text',keyType:'unshielded'});
  if(typeof signed?.data!=='string'||!signed.data.includes(challenge))throw Error('account binding signature did not verify');
  const candidates=[textBytes(challenge),textBytes(signed.data),hexBytes(signed.data)].filter(Boolean);
  const verified=candidates.some(bytes=>{try{return ledger.verifySignature(signed.verifyingKey,bytes,signed.signature);}catch{return false;}});
  if(!verified)throw Error('account binding signature did not verify');
  const {unshieldedAddress}=await api.getUnshieldedAddress();
  return {address:unshieldedAddress,verifyingKey:signed.verifyingKey,challenge,signature:signed.signature};
}

// Prove (wallet-delegated, local), balance (wallet pays), then hand off. Any
// failure before submitTransaction means nothing left the wallet; after it the
// outcome is unknown until reconciliation establishes it.
export function walletSubmitter({api,zk,toHex,fromHex,costModel,finalize}) {
  return async(unprovenTx)=>{
    let balancedHex,txId;
    try{
      const provingProvider=await api.getProvingProvider(zk.asKeyMaterialProvider());
      const proven=await unprovenTx.prove(provingProvider,costModel);
      ({tx:balancedHex}=await api.balanceUnsealedTransaction(toHex(proven.serialize())));
      [txId]=finalize(fromHex(balancedHex)).identifiers();
      if(typeof txId!=='string')throw Error('no transaction identifier');
    }catch{throw Object.assign(Error('wallet did not produce a submittable transaction'),{phase:'before-submit'});}
    try{await api.submitTransaction(balancedHex);}
    catch{throw Object.assign(Error('wallet submission outcome is unknown'),{phase:'after-submit'});}
    return txId;
  };
}
