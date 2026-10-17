import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import * as contracts from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { ZswapChainState, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { readContractLedger } from './runtime-state.mjs';
import { Contract, ledger as readLedger } from '../../managed/custody-probe/contract/index.js';
const submitSingleCall = contracts.submitCallTx;
setNetworkId('preprod');
const bytes = n => new Uint8Array(32).fill(n);
test('generated reserve seed reaches proving through the runner without mixing StateValue classes', async () => {
  const witnesses = Object.fromEntries(['owner','first','second','third'].map((name,i)=>[name,({privateState})=>[privateState,bytes(i+1)]]));
  witnesses.spendable = () => { throw Error('unused'); };
  witnesses.recipient = () => { throw Error('unused'); };
  let compiledContract = CompiledContract.make('CustodyProbe', Contract);
  compiledContract = CompiledContract.withWitnesses(witnesses)(compiledContract);
  compiledContract = CompiledContract.withCompiledFileAssets(new URL('../../managed/custody-probe/',import.meta.url).pathname)(compiledContract);
  const zkConfigProvider = new NodeZkConfigProvider(new URL('../../managed/custody-probe/',import.meta.url).pathname);
  const key = '0'.repeat(64);
  const deployed = await contracts.createUnprovenDeployTxFromVerifierKeys(zkConfigProvider,key,{compiledContract,initialPrivateState:{}},key);
  let state = RT.ContractState.deserialize(deployed.public.initialContractState.serialize());
  assert.equal(readContractLedger(readLedger, state).seeded, false);
  let reachedProof = false;
  const providers = {
    zkConfigProvider,
    walletProvider:{getCoinPublicKey:()=>key,getEncryptionPublicKey:()=>key},
    publicDataProvider:{queryZSwapAndContractState:async()=>[new ZswapChainState(),state,LedgerParameters.initialParameters()]},
    privateStateProvider:{setContractAddress(){},get:async()=>({})},
    proofProvider:{proveTx:async()=>{reachedProof=true;throw Error('test proof boundary');}},
  };
  await assert.rejects(submitSingleCall(providers,{compiledContract,contractAddress:deployed.public.contractAddress,circuitId:'seed',privateStateId:'CustodyProbe'}),/test proof boundary/);
  assert.equal(reachedProof,true);
  state = RT.ContractState.deserialize(state.serialize());
  await assert.rejects(submitSingleCall(providers,{compiledContract,contractAddress:deployed.public.contractAddress,circuitId:'allocateYield',args:[1n,0n,1n],privateStateId:'CustodyProbe'}),/test proof boundary/);
});
