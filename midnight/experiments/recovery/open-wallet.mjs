import * as sdk from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';
import {providerProxy} from '../custody/provider-proxy.mjs';
import {protectedConfiguration} from '../custody/protected-wallet.mjs';

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
  try{
    wallet=await sdk.WalletFacade.init({configuration,
      shielded:cfg=>sdk.ShieldedWallet(cfg).startWithSecretKeys(shielded),
      unshielded:cfg=>sdk.UnshieldedWallet(cfg).startWithPublicKey(sdk.PublicKey.fromKeyStore(keystore)),
      dust:cfg=>sdk.DustWallet(cfg).startWithSecretKey(dust,ledger.LedgerParameters.initialParameters().dust),
    });
    await wallet.start(shielded,dust);
    const subscription=wallet.state().pipe(Rx.throttleTime(15000,undefined,{leading:true,trailing:true})).subscribe(state=>{try{onProgress(progressOf(state));}catch{}});
    let timer;
    const state=await Promise.race([
      wallet.waitForSyncedState(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('sync timeout'),{stage:'synchronization'})),timeoutMs);}),
    ]).finally(()=>{clearTimeout(timer);subscription.unsubscribe();});
    return {wallet,shielded,dust,keystore,configuration,state,proxy,close};
  }catch(error){
    await close();
    throw Object.assign(Error('protected wallet did not synchronize'),{stage:error?.stage??'initialization'});
  }
}
