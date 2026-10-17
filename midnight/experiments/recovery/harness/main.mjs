import {Contract,ledger,pureCircuits,ledgerProtocol,createUnprovenCallTx} from './browser-env.mjs';
import {compiledProbe,browserProviders,indexerFetcher} from './browser-env.mjs';
import {openJournal,sessionKeyFromKit} from '../journal.mjs';
import {runAction,reconcile} from '../actions.mjs';
import {exportKit,restoreKit,generateKitKey} from '../kit.mjs';
import {idbStore,qualifyStorage} from '../idb-store.mjs';
import {acquireWriter} from '../writer-lock.mjs';
import {createProbeRuntime} from '../probe-runtime.mjs';
import {isFreshAgainst} from '../ledger-view.mjs';
import {connectLace,summarizeConfiguration,verifyBinding,walletSubmitter} from './lace.mjs';
import {toHex,fromHex} from '../codec.mjs';

void Contract;

// Participant-side harness for the genuine Lace journey. Everything it reports
// is an explicit projection: never witness material, keys, addresses or URLs.
const origin=location.origin;
const log=[];
const note=(event,data={})=>{log.push({event,at:Math.round(performance.now()),...data});console.log(`HARNESS:${event}`);};
const state={lace:null,session:null,config:null};
const sha=async text=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).slice(0,16);

async function config() {
  state.config??=await (await fetch(`${origin}/config.json`)).json();
  return state.config;
}
const freeze=()=>new Promise(()=>{});
const crashHooks=()=>({after:async stage=>{if(globalThis.__crashAt===stage){note('crashpoint',{stage});await freeze();}}});

async function newRuntime(session,wallet) {
  const keys=session.keys;
  const providers=browserProviders({origin,keys});
  const compiledContract=compiledProbe();
  const zk=providers.zkConfigProvider;
  const submitWithLace=walletSubmitter({
    api:wallet,zk,toHex,fromHex,costModel:ledgerProtocol.CostModel.initialCostModel(),
    finalize:bytes=>ledgerProtocol.Transaction.deserialize('signature','proof','binding',bytes),
  });
  return createProbeRuntime({
    compiledContract,contractAddress:session.deployment,participantId:session.participantIdBytes,providers,createUnprovenCallTx,
    deserializeUnproven:bytes=>ledgerProtocol.Transaction.deserialize('signature','pre-proof','pre-binding',bytes),
    submitUnproven:async tx=>{
      const pending=submitWithLace(tx);
      if(globalThis.__crashAt==='handoff'){note('crashpoint',{stage:'handoff'});await freeze();}
      return pending;
    },
    readLedger:ledger,bind:pureCircuits.bind,indexerQuery:indexerFetcher(origin),
  });
}

async function openSession({kitKey,participantId,secret,wallet}) {
  const cfg=await config();
  const scope={network:'preprod',deployment:cfg.contract,participant:participantId};
  const writer=await acquireWriter({locks:navigator.locks,scope});
  const store=await idbStore({indexedDB,name:'shroudly-recovery-v1'});
  const keys={coinPublicKey:state.lace?.shielded.shieldedCoinPublicKey??cfg.preflightKeys.coinPublicKey,encryptionPublicKey:state.lace?.shielded.shieldedEncryptionPublicKey??cfg.preflightKeys.encryptionPublicKey};
  const session={kitKey,scope,writer,store,deployment:cfg.contract,participantIdBytes:fromHex(participantId.slice(2)),keys,wallet};
  session.runtime=await newRuntime(session,wallet);
  const isFresh=async privateState=>isFreshAgainst(await session.runtime.queryLedger(),privateState,pureCircuits.bind);
  session.journal=await openJournal({store,scope,key:await sessionKeyFromKit(kitKey),writer,isFresh});
  if(secret)await session.journal.initialize({secret,round:0n});
  state.session=session;
  return session;
}
const need=()=>{if(!state.session)throw Error('no unlocked session');return state.session;};

const harness={
  log:()=>log,
  async storage(){return qualifyStorage({indexedDB,storage:navigator.storage,locks:navigator.locks});},
  async connect() {
    const {api,rdns,apiVersion,configuration}=await connectLace({midnight:window.midnight});
    const shielded=await api.getShieldedAddresses();
    state.lace={api,shielded};
    const summary=summarizeConfiguration(configuration);
    note('connected',{rdns,apiVersion,...summary});
    return {rdns,apiVersion,...summary,addressDigest:await sha((await api.getUnshieldedAddress()).unshieldedAddress)};
  },
  async funding() {
    const api=state.lace.api;
    const dust=await api.getDustBalance();
    const night=await api.getUnshieldedBalances();
    return {dustPositive:dust.balance>0n,dustCapPositive:dust.cap>0n,unshieldedTokenTypes:Object.keys(night).length,nightPositive:Object.values(night).some(v=>v>0n)};
  },
  // Create a brand-new participant: secret and Recovery Kit key live only in this page's memory.
  async createParticipant() {
    const secret=crypto.getRandomValues(new Uint8Array(32));
    const participantId=`0x${toHex(pureCircuits.identity(secret))}`;
    const kitKey=generateKitKey();
    const session=await openSession({kitKey,participantId,secret,wallet:state.lace.api});
    const binding=await verifyBinding({api:state.lace.api,scope:session.scope,ledger:ledgerProtocol});
    await session.journal.bindAccount(binding);
    note('bound',{addressDigest:await sha(binding.address)});
    return {participantId,addressDigest:await sha(binding.address),kitText:await exportKit({journal:session.journal,kitKey})};
  },
  // Unlock saved state with the participant-held Recovery Kit (key stays in this page's memory).
  async unlock(kitText) {
    const kit=JSON.parse(kitText);
    const session=await openSession({kitKey:kit.key,participantId:kit.scope.participant,wallet:state.lace.api});
    const address=(await state.lace.api.getUnshieldedAddress()).unshieldedAddress;
    await session.journal.assertBoundTo(address);
    note('unlocked');
    return this.status();
  },
  // Restore into this browser from a Recovery Kit (fresh profile or older ciphertext).
  async restore(kitText) {
    const kit=JSON.parse(kitText);
    const cfg=await config();
    const store=await idbStore({indexedDB,name:'shroudly-recovery-v1'});
    const restored=await restoreKit({kitText,store,scope:{network:'preprod',deployment:cfg.contract,participant:kit.scope.participant}});
    note('restored',{generation:String(restored.generation)});
    return {generation:String(restored.generation)};
  },
  async run(circuit,actionId) {
    const session=need();
    const result=await runAction({journal:session.journal,executor:session.runtime,actionId,circuit,pollMs:5000,maxPolls:Number(globalThis.__maxPolls??Infinity),hooks:crashHooks()});
    note('action',{circuit,outcome:result.outcome});
    return {...result,...await this.status()};
  },
  async reconcile() {
    const session=need();
    const results=await reconcile({journal:session.journal,executor:session.runtime,pollMs:5000,maxPolls:Number(globalThis.__maxPolls??1),hooks:crashHooks()});
    note('reconcile',{outcomes:results.map(r=>r.outcome)});
    return {results,...await this.status()};
  },
  async status() {
    const session=need();
    const current=session.journal.current();
    const view=await session.runtime.queryLedger();
    return {
      generation:String(current.generation),privateRound:String(current.privateState.round),
      ledgerRound:String(view.round),registered:view.round>=0n,
      fresh:isFreshAgainst(view,current.privateState,pureCircuits.bind),
      unresolved:(await session.journal.unresolved()).map(e=>({actionId:e.actionId,status:e.status,circuit:e.circuit})),
    };
  },
  async exportKit(){const s=need();return exportKit({journal:s.journal,kitKey:s.kitKey});},
  lock() {
    const s=need();
    s.journal.lock();s.writer.release();s.store.close?.();
    state.session=null;
    note('locked');
  },
  // Only for the no-wallet preflight: proves the page can build a real unproven call.
  async preflightBuild() {
    const secret=crypto.getRandomValues(new Uint8Array(32));
    const participantId=`0x${toHex(pureCircuits.identity(secret))}`;
    const session=await openSession({kitKey:generateKitKey(),participantId,secret,wallet:null});
    const built=await session.runtime.build({secret,round:0n},'register');
    session.journal.lock();session.writer.release();
    return {circuit:built.payload.circuit,unprovenBytes:built.payload.unprovenTx.length,expectedRound:String(built.expected.round),base:String(built.base.round)};
  },
};
globalThis.harness=harness;
globalThis.harnessReady=true;
note('ready');
