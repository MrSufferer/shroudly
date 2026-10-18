import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encode,decode} from './codec.mjs';
import {witnesses} from './probe-witnesses.mjs';

// Behavior seam: private state as the journal stores and reloads it, handed to
// the secretKey witness that compact-runtime checks as Bytes<32>.
const roundTrip=privateState=>decode(encode({schema:1,value:{generation:0n,privateState}})).value.privateState;
const secretOf=privateState=>witnesses.secretKey({privateState})[1];

test('a Node Buffer secret reaches the witness as an exact 32-byte Uint8Array after a journal round trip',()=>{
  const secret=randomBytes(32);
  const value=secretOf(roundTrip({secret,round:0n}));
  assert.equal(Object.getPrototypeOf(value),Uint8Array.prototype);
  assert.equal(value.length,32);
  assert.deepEqual([...value],[...secret]);
});

test('the witness returns a fresh exact Uint8Array even when the in-memory secret is a Buffer',()=>{
  const secret=randomBytes(32);
  const value=secretOf({secret,round:0n});
  assert.equal(Object.getPrototypeOf(value),Uint8Array.prototype);
  assert.notEqual(value,secret);
  assert.deepEqual([...value],[...secret]);
});

test('a secret that is not 32 raw bytes is refused at the witness, not passed to the runtime',()=>{
  // The shape the pre-433cdd5 codec restored: Buffer.toJSON output.
  const legacy=JSON.parse(JSON.stringify({secret:randomBytes(32)})).secret;
  assert.throws(()=>secretOf({secret:legacy,round:0n}),/not 32 bytes/);
  assert.throws(()=>secretOf({secret:new Uint8Array(31),round:0n}),/not 32 bytes/);
  assert.throws(()=>secretOf({round:0n}),/not 32 bytes/);
});

test('the generated circuits accept a journal-restored secret under the real Bytes<32> check',async()=>{
  const RT=await import('@midnight-ntwrk/compact-runtime');
  const {Contract,ledger,pureCircuits}=await import('../../managed/recovery-probe/contract/index.js');
  const contract=new Contract(witnesses);
  let state=contract.initialState(RT.createConstructorContext(undefined,'0'.repeat(64))).currentContractState.data;
  const call=(circuit,privateState)=>{
    const {context}=contract.impureCircuits[circuit](RT.createCircuitContext(RT.sampleContractAddress(),'0'.repeat(64),state,privateState));
    state=context.currentQueryContext.state;
    return context.currentPrivateState;
  };
  const secret=randomBytes(32);
  const registered=call('register',roundTrip({secret,round:0n}));
  const advanced=call('advance',roundTrip(registered));
  assert.equal(advanced.round,1n);
  const id=pureCircuits.identity(Uint8Array.from(secret));
  assert.equal(ledger(state).rounds.lookup(id),1n);
});

test('the live call builder (Midnight.js createUnprovenCallTx) builds register from a journal-restored secret, offline',async()=>{
  const {compiledProbe,managedDirectory,ledger,pureCircuits}=await import('./journey-env.mjs');
  const {createProbeRuntime}=await import('./probe-runtime.mjs');
  const {setNetworkId}=await import('@midnight-ntwrk/midnight-js-network-id');
  const L=await import('@midnight-ntwrk/midnight-js-protocol/ledger');
  const {NodeZkConfigProvider}=await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');
  const {createUnprovenDeployTx,createUnprovenCallTx}=await import('@midnight-ntwrk/midnight-js-contracts');
  setNetworkId('preprod');
  // Throwaway keys and a local deployment: nothing here touches a network.
  const keys=L.ZswapSecretKeys.fromSeed(randomBytes(32));
  const walletProvider={getCoinPublicKey:()=>keys.coinPublicKey,getEncryptionPublicKey:()=>keys.encryptionPublicKey};
  const zkConfigProvider=new NodeZkConfigProvider(managedDirectory);
  const compiledContract=await compiledProbe();
  const deployed=await createUnprovenDeployTx({zkConfigProvider,walletProvider},{compiledContract,initialPrivateState:{secret:new Uint8Array(32),round:0n}});
  const contractState=deployed.public.initialContractState;
  const publicDataProvider={
    queryContractState:async()=>contractState,
    queryZSwapAndContractState:async()=>[new L.ZswapChainState(),contractState,L.LedgerParameters.initialParameters()],
  };
  const secret=randomBytes(32);
  const runtime=createProbeRuntime({
    compiledContract,contractAddress:deployed.public.contractAddress,
    participantId:pureCircuits.identity(Uint8Array.from(secret)),
    providers:{publicDataProvider,zkConfigProvider,walletProvider},createUnprovenCallTx,
    readLedger:ledger,bind:pureCircuits.bind,
  });
  const built=await runtime.build(roundTrip({secret,round:0n}),'register');
  assert.equal(built.expected.round,0n);
  assert.equal(built.expected.commitment,`0x${Buffer.from(pureCircuits.bind(Uint8Array.from(secret),0n)).toString('hex')}`);
  assert.ok(built.payload.unprovenTx.length>0);
});
