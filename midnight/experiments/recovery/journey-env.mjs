
import {fileURLToPath} from 'node:url';
import {Contract,ledger,pureCircuits} from '../../managed/recovery-probe/contract/index.js';
import {witnesses} from './probe-witnesses.mjs';
import {toHex} from './codec.mjs';

export const managedDirectory=fileURLToPath(new URL('../../managed/recovery-probe/',import.meta.url));
export const LOCK='/tmp/shroudly-wallet.lock';
export {ledger,pureCircuits,toHex};

const attach=(fn,self,value)=>{try{return fn(self,value);}catch{return fn(value)(self);}};
export async function compiledProbe() {
  const compact=await import('@midnight-ntwrk/midnight-js-protocol/compact-js');
  let compiled=compact.CompiledContract.make('RecoveryProbe',Contract);
  compiled=attach(compact.CompiledContract.withWitnesses,compiled,witnesses);
  return attach(compact.CompiledContract.withCompiledFileAssets,compiled,managedDirectory);
}

// Public-key-only wallet view for building (not balancing) transactions.
export const keyWalletProvider=keys=>({getCoinPublicKey:()=>keys.coinPublicKey,getEncryptionPublicKey:()=>keys.encryptionPublicKey});

// Indexer GraphQL over the loopback route that attaches provider authentication.
export const indexerFetcher=url=>async(query,variables)=>{
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw Error('indexer request failed');
  const body=await response.json();
  if(body.errors?.length)throw Error('indexer query rejected');
  return body.data;
};

export async function nodeProviders({indexerHttp,indexerWs,keys}) {
  const [{setNetworkId},{indexerPublicDataProvider},{NodeZkConfigProvider},{httpClientProofProvider}]=await Promise.all([
    import('@midnight-ntwrk/midnight-js-network-id'),
    import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
  ]);
  setNetworkId('preprod');
  const zkConfigProvider=new NodeZkConfigProvider(managedDirectory);
  return {
    publicDataProvider:indexerPublicDataProvider(indexerHttp,indexerWs),
    zkConfigProvider,
    proofProvider:httpClientProofProvider('http://127.0.0.1:6300',zkConfigProvider,{timeout:300000}),
    walletProvider:keyWalletProvider(keys),
  };
}
