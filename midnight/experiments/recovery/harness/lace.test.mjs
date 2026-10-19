import test from 'node:test';
import assert from 'node:assert/strict';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {discoverWallets,connectLace,summarizeConfiguration,bindingChallenge,verifyBinding,walletSubmitter} from './lace.mjs';

// The wallet is an external boundary: these tests exercise this module's own
// decisions (selection, network checks, signature verification, submission
// phase classification) with a scripted ConnectedAPI. They are not evidence of
// genuine Lace behavior; the live run provides that.
const configuration={networkId:'preprod',indexerUri:'https://i.example',indexerWsUri:'wss://i.example',substrateNodeUri:'wss://n.example',proverServerUri:'http://127.0.0.1:6300'};
const connected=(over={})=>({
  getConnectionStatus:async()=>({status:'connected',networkId:'preprod'}),
  getConfiguration:async()=>configuration,
  getUnshieldedAddress:async()=>({unshieldedAddress:'addr-1'}),
  getShieldedAddresses:async()=>({shieldedAddress:'s',shieldedCoinPublicKey:'c',shieldedEncryptionPublicKey:'e'}),
  ...over,
});
const wallet=(api,over={})=>({rdns:'io.lace.wallet',name:'Lace',apiVersion:'4.0.1',connect:async()=>api,...over});

test('only Lace instances are selected from window.midnight', ()=>{
  const found=discoverWallets({a:wallet(connected()),b:wallet(connected(),{rdns:'com.other',name:'Other'})});
  assert.deepEqual(found.map(w=>w.key),['a']);
});

test('connection requires the Preprod network and an active connection', async()=>{
  const ok=await connectLace({midnight:{a:wallet(connected())}});
  assert.equal(ok.configuration.networkId,'preprod');
  await assert.rejects(connectLace({midnight:{a:wallet(connected({getConfiguration:async()=>({...configuration,networkId:'mainnet'})}))}}),/wrong network/);
  await assert.rejects(connectLace({midnight:{a:wallet(connected({getConnectionStatus:async()=>({status:'disconnected'})}))}}),/not connected/);
  await assert.rejects(connectLace({midnight:{}}),/Lace was not found/);
  await assert.rejects(connectLace({midnight:{a:wallet(connected(),{connect:async()=>{throw Error('User rejected');}})}}),/rejected/);
});

test('a locked Lace is polled until the Operator unlocks it, and gives up after the timeout', async()=>{
  const locked=()=>Object.assign(Error('APIError'),{code:'Rejected',reason:'Wallet is locked. Please unlock the wallet first.'});
  let calls=0;
  const unlocksOnThird=connected({getConnectionStatus:async()=>{if(++calls<3)throw locked();return {status:'connected',networkId:'preprod'};}});
  await connectLace({midnight:{a:wallet(unlocksOnThird)},sleep:async()=>{}});
  assert.equal(calls,3);
  await assert.rejects(connectLace({midnight:{a:wallet(connected({getConnectionStatus:async()=>{throw locked();}}))},unlockTimeoutMs:0,sleep:async()=>{}}),/getConnectionStatus: Rejected Wallet is locked/);
});

test('configuration summary reports whether proving is participant-local without exposing endpoints', ()=>{
  assert.deepEqual(summarizeConfiguration(configuration),{networkId:'preprod',proverLoopback:true,proverConfigured:true});
  assert.deepEqual(summarizeConfiguration({...configuration,proverServerUri:'https://hosted.example'}),{networkId:'preprod',proverLoopback:false,proverConfigured:true});
  assert.deepEqual(summarizeConfiguration({...configuration,proverServerUri:undefined}),{networkId:'preprod',proverLoopback:null,proverConfigured:false});
});

test('account binding is accepted only for a genuine signature over the scope challenge', async()=>{
  const scope={network:'preprod',deployment:'dep',participant:'p'};
  const challenge=bindingChallenge(scope);
  const signing=ledger.sampleSigningKey();
  const vk=ledger.signatureVerifyingKey(signing);
  const sign=data=>({data,signature:ledger.signData(signing,new TextEncoder().encode(data)),verifyingKey:vk});
  const api=connected({signData:async data=>sign(data)});
  const binding=await verifyBinding({api,scope,ledger});
  assert.equal(binding.address,'addr-1');
  assert.equal(binding.challenge,challenge);
  const forged=connected({signData:async data=>({...sign(data),signature:ledger.signData(ledger.sampleSigningKey(),new TextEncoder().encode(data))})});
  await assert.rejects(verifyBinding({api:forged,scope,ledger}),/did not verify/);
  const wrongData=connected({signData:async()=>sign('something else')});
  await assert.rejects(verifyBinding({api:wrongData,scope,ledger}),/did not verify/);
});

test('failures before the wallet submits are reported as not submitted; submit failures are unknown', async()=>{
  const tx={prove:async()=>({serialize:()=>new Uint8Array([1])})};
  const codec={toHex:()=> '01',fromHex:()=>new Uint8Array([1]),costModel:{},finalize:()=>({identifiers:()=>['0x'+'ab'.repeat(32)]})};
  const zk={asKeyMaterialProvider:()=>({})};
  const declined=walletSubmitter({api:{getProvingProvider:async()=>({}),balanceUnsealedTransaction:async()=>{throw Error('User rejected');},submitTransaction:async()=>{throw Error('never');}},zk,...codec});
  await assert.rejects(declined(tx),error=>error.phase==='before-submit');
  const lost=walletSubmitter({api:{getProvingProvider:async()=>({}),balanceUnsealedTransaction:async()=>({tx:'01'}),submitTransaction:async()=>{throw Error('network hiccup');}},zk,...codec});
  await assert.rejects(lost(tx),error=>error.phase==='after-submit');
  let submitted=0;
  const fine=walletSubmitter({api:{getProvingProvider:async()=>({}),balanceUnsealedTransaction:async()=>({tx:'01'}),submitTransaction:async()=>{submitted+=1;}},zk,...codec});
  assert.equal(await fine(tx),'0x'+'ab'.repeat(32));
  assert.equal(submitted,1);
});
