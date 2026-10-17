import {participantLedger,expectedAfter} from './ledger-view.mjs';

// Genuine-network executor for RecoveryProbe, shared by the Node and browser
// harnesses. Everything environment-specific is injected: the Midnight.js call
// builder, the unproven-transaction codec, the submission route (protected
// wallet in Node, Lace in the browser) and an indexer GraphQL fetcher.
//
// It reads only public ledger state and never logs witness material.
export const TX_QUERY='query($offset: TransactionOffset!){transactions(offset:$offset){hash block{height} ... on RegularTransaction{identifiers transactionResult{status}}}}';

export function createProbeRuntime({
  compiledContract,contractAddress,privateStateId='recovery-probe',
  participantId,            // public identity hash of this participant (Uint8Array)
  providers,                // publicDataProvider, zkConfigProvider, walletProvider (key getters only)
  createUnprovenCallTx,     // midnight-js-contracts
  deserializeUnproven,      // Uint8Array -> UnprovenTransaction
  submitUnproven,           // (unprovenTx) -> Promise<txId>; proves, balances, submits
  readLedger,               // generated `ledger(state.data)` reader
  bind,                     // generated pure circuit: (secret, round) -> Uint8Array
  indexerQuery,             // (query, variables) -> Promise<data>
}) {
  const queryLedger=async()=>{
    const state=await providers.publicDataProvider.queryContractState(contractAddress);
    if(state===null)throw Error('contract state is not visible on the indexer');
    return participantLedger(readLedger(state.data),participantId);
  };
  return {
    queryLedger,
    async build(privateState,circuit) {
      const base=await queryLedger();
      const holder={...providers,privateStateProvider:{get:async()=>privateState,setContractAddress(){},set:async()=>{throw Error('private state is persisted only by the journal');}}};
      const call=await createUnprovenCallTx(holder,{compiledContract,contractAddress,circuitId:circuit,privateStateId,args:[]});
      const next=call.private.nextPrivateState;
      return {
        base,
        expected:expectedAfter({circuit,base,next,bind}),
        nextPrivateState:next,
        payload:{circuit,unprovenTx:call.private.unprovenTx.serialize()},
      };
    },
    async submit(entry) {
      try{return await submitUnproven(deserializeUnproven(entry.payload.unprovenTx),entry.payload.circuit);}
      catch(error) {
        // Proving and balancing happen before anything leaves this machine.
        if(error?.phase==='before-submit')error.notSubmitted=true;
        throw error;
      }
    },
    async observe(txId) {
      const data=await indexerQuery(TX_QUERY,{offset:{identifier:txId}});
      const [tx]=data?.transactions??[];
      if(!tx)return null;
      const status=tx.transactionResult?.status;
      if(status==='SUCCESS')return {status:'finalized',block:tx.block?.height};
      if(status)return {status:'failed',reason:String(status)};
      return null;
    },
  };
}
