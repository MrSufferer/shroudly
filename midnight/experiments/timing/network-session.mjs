import {mkdirSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import {emit} from './isolated.mjs';
import {openStagedWallet, errorClass} from './wallet.mjs';
import {clientFor} from './provider.mjs';
import {ownerSecret, slotSecret} from './synthetic.mjs';

const MANAGED = new URL('../../managed/timing-probe/', import.meta.url);
const LOCK = '/tmp/shroudly-wallet.lock';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Exclusive wallet lock shared with the concurrently running custody experiment:
// held only from before proving until the submission settles or fails.
export async function withWalletLock(work, onWait) {
  const began = Date.now();
  for (;;) {
    try { mkdirSync(LOCK); break; } catch (error) { if (error.code !== 'EEXIST') throw error; onWait?.(); await sleep(2000); }
  }
  try { return await work(Date.now() - began); } finally { try { rmdirSync(LOCK); } catch { /* already released */ } }
}

export function artifactHashes() {
  const hashes = {};
  for (const directory of ['contract', 'keys', 'zkir']) {
    for (const name of readdirSync(new URL(`${directory}/`, MANAGED)).sort()) {
      if (name.endsWith('.map') || name.endsWith('.d.ts')) continue;
      hashes[`${directory}/${name}`] = sha256(readFileSync(new URL(`${directory}/${name}`, MANAGED)));
    }
  }
  return hashes;
}

// Minimal in-memory private-state provider: the probe has no private state, and
// its (valueless, synthetic) maintenance signing key never needs to survive.
function memoryPrivateState() {
  const states = new Map(); const keys = new Map(); let address;
  return {
    setContractAddress: value => { address = value; },
    set: async (id, state) => { states.set(`${address}/${id}`, state); }, get: async id => states.get(`${address}/${id}`) ?? null,
    remove: async id => { states.delete(`${address}/${id}`); }, clear: async () => states.clear(),
    setSigningKey: async (contract, key) => { keys.set(contract, key); }, getSigningKey: async contract => keys.get(contract) ?? null,
    removeSigningKey: async contract => { keys.delete(contract); }, clearSigningKeys: async () => keys.clear(),
    exportPrivateStates: async () => { throw Error('unsupported'); }, importPrivateStates: async () => { throw Error('unsupported'); },
  };
}

// Provider-referenced clock: the provider's HTTP Date header, not the local clock, is "now".
export async function providerClock(provider) {
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const local = Date.now();
    const {date} = await provider.rpc('system_chain');
    offsets.push(Date.parse(date) + 500 - (local + Date.now()) / 2); // Date header floors to whole seconds
    await sleep(300);
  }
  offsets.sort((a, b) => a - b);
  const offset = offsets[Math.floor(offsets.length / 2)];
  return {offsetMs: Math.round(offset), now: () => (Date.now() + offset) / 1000};
}

export async function openSession(envPath) {
  const opened = await openStagedWallet(envPath);
  const {wallet, shielded, dust, provider: proxy} = opened;
  (await import('@midnight-ntwrk/midnight-js-network-id')).setNetworkId('preprod');
  const contracts = await import('@midnight-ntwrk/midnight-js-contracts');
  const compact = await import('@midnight-ntwrk/midnight-js-protocol/compact-js');
  const indexer = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const proofModule = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
  const zkModule = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');
  const module = await import(pathToFileURL(join(MANAGED.pathname, 'contract/index.js')).href);

  // The only place a browser/caller clock could enter: the circuit's local block
  // time. Forgery overrides it for the local evaluation that precedes proving,
  // exactly as a dishonest client clock would. The network never sees this value.
  const control = {forgedSeconds: undefined, slot: 0, gate: undefined};
  class ForgingContract extends module.Contract {
    constructor(witnesses) {
      super(witnesses);
      for (const table of [this.circuits, this.impureCircuits]) {
        for (const [name, circuit] of Object.entries(table)) {
          if (!['commit', 'reveal', 'finalize', 'pause', 'resume', 'claim'].includes(name)) continue;
          table[name] = (context, ...args) => {
            if (control.forgedSeconds !== undefined) {
              context.currentQueryContext.block = {...context.currentQueryContext.block, secondsSinceEpoch: BigInt(control.forgedSeconds)};
            }
            return circuit(context, ...args);
          };
        }
      }
    }
  }
  const witnesses = {owner: ctx => [ctx.privateState, ownerSecret()], secret: ctx => [ctx.privateState, slotSecret(control.slot)]};
  const attach = (fn, self, value) => { try { return fn(self, value); } catch { return fn(value)(self); } };
  let compiled = compact.CompiledContract.make('TimingProbe', ForgingContract);
  compiled = attach(compact.CompiledContract.withWitnesses, compiled, witnesses);
  compiled = attach(compact.CompiledContract.withCompiledFileAssets, compiled, MANAGED.pathname);

  const zkConfigProvider = new zkModule.NodeZkConfigProvider(MANAGED.pathname);
  const publicDataProvider = indexer.indexerPublicDataProvider(proxy.http, proxy.ws);
  const coinPublicKey = shielded.coinPublicKey, encryptionPublicKey = shielded.encryptionPublicKey;
  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey, getEncryptionPublicKey: () => encryptionPublicKey,
    balanceTx: async (tx, ttl = new Date(Date.now() + 3_600_000)) => {
      const recipe = await wallet.balanceUnboundTransaction(tx, {shieldedSecretKeys: shielded, dustSecretKey: dust}, {ttl});
      return wallet.finalizeRecipe(recipe);
    },
  };
  const midnightProvider = {
    submitTx: async tx => { if (control.gate) await control.gate(); return wallet.submitTransaction(tx); },
  };
  const providers = {
    privateStateProvider: memoryPrivateState(), publicDataProvider, zkConfigProvider,
    proofProvider: proofModule.httpClientProofProvider('http://127.0.0.1:6300', zkConfigProvider, {timeout: 300000}),
    walletProvider, midnightProvider,
  };
  return {opened, providers, compiled, contracts, module, control, publicDataProvider, provider: clientFor(proxy), ledgerV8, wallet};
}

export {errorClass};
