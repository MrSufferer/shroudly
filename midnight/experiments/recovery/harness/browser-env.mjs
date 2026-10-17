import {Contract,ledger,pureCircuits} from '../../../managed/recovery-probe/contract/index.js';
import {witnesses} from '../probe-witnesses.mjs';
import {ZKConfigProvider,createProverKey,createVerifierKey,createZKIR} from '@midnight-ntwrk/midnight-js-types';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import * as compact from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as ledgerProtocol from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {createUnprovenCallTx} from '@midnight-ntwrk/midnight-js-contracts';

export {Contract,ledger,pureCircuits,ledgerProtocol,createUnprovenCallTx};

// Fetches the public compiled artifacts served by the harness relay. Prover
// keys are public circuit data, not secrets.
export class FetchZkConfigProvider extends ZKConfigProvider {
  constructor(base){super();this.base=base;}
  async bytes(path){
    const response=await fetch(`${this.base}/${path}`,{cache:'force-cache'});
    if(!response.ok)throw Error('compiled artifact unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }
  getProverKey(id){return this.bytes(`keys/${id}.prover`).then(createProverKey);}
  getVerifierKey(id){return this.bytes(`keys/${id}.verifier`).then(createVerifierKey);}
  getZKIR(id){return this.bytes(`zkir/${id}.bzkir`).then(createZKIR);}
}

export function compiledProbe() {
  // Witnesses are the participant's private state accessors; no file assets are
  // needed in the browser because proving is delegated to the wallet.
  return compact.CompiledContract.withWitnesses(compact.CompiledContract.make('RecoveryProbe',Contract),witnesses);
}

export function browserProviders({origin,keys}) {
  setNetworkId('preprod');
  const zkConfigProvider=new FetchZkConfigProvider(`${origin}/managed/recovery-probe`);
  return {
    zkConfigProvider,
    publicDataProvider:indexerPublicDataProvider(`${origin}/indexer`,`${origin.replace(/^http/,'ws')}/indexer-ws`),
    walletProvider:{getCoinPublicKey:()=>keys.coinPublicKey,getEncryptionPublicKey:()=>keys.encryptionPublicKey},
  };
}

export const indexerFetcher=origin=>async(query,variables)=>{
  const response=await fetch(`${origin}/indexer`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables})});
  if(!response.ok)throw Error('indexer request failed');
  const body=await response.json();
  if(body.errors?.length)throw Error('indexer query rejected');
  return body.data;
};
