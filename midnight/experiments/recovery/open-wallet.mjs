import * as sdk from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';
import {providerProxy} from '../custody/provider-proxy.mjs';
import {protectedConfiguration} from '../custody/protected-wallet.mjs';
import {loadWalletCache,saveWalletCache} from './wallet-cache.mjs';

// Own cache first, then (read-only) the shared wallet's cache maintained by #23.
export const OWN_CACHE=process.env.SHROUDLY_RECOVERY_WALLET_CACHE||'/tmp/shroudly-recovery-wallet-cache';
const SHARED_CACHE=process.env.SHROUDLY_TIMING_WALLET_CACHE||'/tmp/shroudly-timing-wallet-cache';

// Variant of the protected bootstrap for the recovery journey: it exposes the
// loopback provider routes and numeric sync progress, and bounds each stage.
// It never logs credentials, URLs, addresses or SDK errors.
const num=value=>typeof value==='bigint'?Number(value):typeof value==='number'?value:null;
export const progressOf=state=>{
  const read=part=>{const p=part?.progress??part?.state?.progress;return p?{applied:num(p.appliedIndex),highest:num(p.highestIndex),connected:p.isConnected===true}:null;};
  return {shielded:read(state.shielded),unshielded:read(state.unshielded),dust:read(state.dust),synced:state.isSynced===true};
};

export async function openWalletWithProgress(path,{timeoutMs=1_800_000,onProgress=()=>{}}={}) {
  const {seed,configuration,token,endpoints}=protectedConfiguration(path);
  // At Preprod's floor fee price a call that moves no coins (advance) costs 0 DUST;
  // dust-wallet 4.2.0 then selects no DUST and re-prices the empty intent forever,
  // until wasm traps with `unreachable`. A nonzero overhead makes the first pass select DUST.
  configuration.costParameters={...configuration.costParameters,additionalFeeOverhead:1_000_000_000n};
  const hd=sdk.HDWallet.fromSeed(seed);seed.fill(0);
  if(hd.type!=='seedOk')throw Error('invalid deployment seed');
  const keys=hd.hdWallet.selectAccount(0).selectRoles([sdk.Roles.NightExternal,sdk.Roles.Dust,sdk.Roles.Zswap]).deriveKeysAt(0);
  hd.hdWallet.clear();
  if(keys.type!=='keysDerived')throw Error('wallet key derivation failed');
  const shielded=ledger.ZswapSecretKeys.fromSeed(keys.keys[sdk.Roles.Zswap]);
  const dust=ledger.DustSecretKey.fromSeed(keys.keys[sdk.Roles.Dust]);
  const keystore=sdk.createKeystore(keys.keys[sdk.Roles.NightExternal],'preprod');
  const proxy=await providerProxy({...endpoints,token});
  configuration.relayURL=new URL(proxy.rpc);
  configuration.indexerClientConnection={indexerHttpUrl:proxy.http,indexerWsUrl:proxy.ws};
  let wallet;
  const close=async()=>{try{await Promise.race([wallet?.stop(),new Promise(r=>setTimeout(r,10000))]);}catch{}await proxy.close();};
  // Provider WebSockets drop during long syncs. Sub-wallet state is checkpointed
  // and restored on reconnect so progress survives; it is also cached in owner-only
  // files outside the repository (no seed or secret key is serialized).
  const checkpoint=loadWalletCache([OWN_CACHE,SHARED_CACHE]);
  const fromCache=Boolean(checkpoint.dust);
  const persist=()=>{try{saveWalletCache(OWN_CACHE,checkpoint);}catch{}};
  const deadline=Date.now()+timeoutMs;
  for(let attempt=1;;attempt+=1) {
    let saver,subscription,timer;
    try{
      wallet=await sdk.WalletFacade.init({configuration,
        shielded:cfg=>checkpoint.shielded?sdk.ShieldedWallet(cfg).restore(checkpoint.shielded):sdk.ShieldedWallet(cfg).startWithSecretKeys(shielded),
        unshielded:cfg=>checkpoint.unshielded?sdk.UnshieldedWallet(cfg).restore(checkpoint.unshielded):sdk.UnshieldedWallet(cfg).startWithPublicKey(sdk.PublicKey.fromKeyStore(keystore)),
        dust:cfg=>checkpoint.dust?sdk.DustWallet(cfg).restore(checkpoint.dust):sdk.DustWallet(cfg).startWithSecretKey(dust,ledger.LedgerParameters.initialParameters().dust),
      });
      await wallet.start(shielded,dust);
      subscription=wallet.state().pipe(Rx.throttleTime(15000,undefined,{leading:true,trailing:true})).subscribe(state=>{try{onProgress({attempt,...progressOf(state)});}catch{}});
      const current=wallet;
      saver=setInterval(async()=>{
        for(const part of ['shielded','unshielded','dust']){try{checkpoint[part]=await current[part].serializeState();}catch{}}
        persist();
      },60000);
      const state=await Promise.race([
        wallet.waitForSyncedState(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('sync timeout'),{stage:'synchronization',final:true})),Math.max(0,deadline-Date.now()));}),
      ]);
      for(const part of ['shielded','unshielded','dust']){try{checkpoint[part]=await wallet[part].serializeState();}catch{}}
      persist();
      return {wallet,shielded,dust,keystore,configuration,state,proxy,close,fromCache};
    }catch(error){
      try{await Promise.race([wallet?.stop(),new Promise(r=>setTimeout(r,10000))]);}catch{}
      wallet=undefined;
      if(error?.final||attempt>=12||Date.now()>=deadline){
        await proxy.close();
        throw Object.assign(Error('protected wallet did not synchronize'),{stage:error?.stage??'synchronization',attempts:attempt});
      }
      onProgress({attempt,reconnecting:true});
      await new Promise(r=>setTimeout(r,15000));
    }finally{clearInterval(saver);clearTimeout(timer);subscription?.unsubscribe();}
  }
}
