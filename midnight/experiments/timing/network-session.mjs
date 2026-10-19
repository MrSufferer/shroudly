import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import {emit} from './isolated.mjs';
import {openStagedWallet, errorClass} from './wallet.mjs';
import {clientFor} from './provider.mjs';
import {ownerSecret, slotSecret} from './synthetic.mjs';
import {forgingContract} from './forging.mjs';
export {withWalletLock} from './wallet-lock.mjs';
export {providerClock} from './plan.mjs';

const MANAGED = new URL('../../managed/timing-probe/', import.meta.url);
// Counts and indexer positions only; no keys or coin contents.
const currentState = wallet => new Promise(resolve => { const sub = wallet.state().subscribe(value => { queueMicrotask(() => sub.unsubscribe()); resolve(value); }); });
const dustView = state => {
  const dust = state?.dust, progress = dust?.state?.progress ?? dust?.progress;
  const number = key => progress?.[key] === undefined ? null : Number(progress[key]);
  let balance = null; try { balance = String(dust.balance(new Date())); } catch {}
  return {dustAvailableCoins: dust?.availableCoins?.length ?? null, dustPendingCoins: dust?.pendingCoins?.length ?? null, dustBalance: balance,
    dustAppliedIndex: number('appliedIndex'), dustHighestIndex: number('highestIndex'), walletSynced: state?.isSynced ?? null};
};

export const sha256 = value => createHash('sha256').update(value).digest('hex');

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
export async function openSession(envPath) {
  const opened = await openStagedWallet(envPath);
  const {shielded, dust, provider: proxy} = opened;
  let wallet = opened.wallet;
  const reopened = [];
  (await import('@midnight-ntwrk/midnight-js-network-id')).setNetworkId('preprod');
  const contracts = await import('@midnight-ntwrk/midnight-js-contracts');
  const compact = await import('@midnight-ntwrk/midnight-js-protocol/compact-js');
  const indexer = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const proofModule = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
  const zkModule = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');
  const module = await import(pathToFileURL(join(MANAGED.pathname, 'contract/index.js')).href);

  const control = {forgedSeconds: undefined, slot: 0, gate: undefined};
  const ForgingContract = forgingContract(module.Contract, control);
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
      // With a single DUST coin each step spends the previous step's change, which the wallet only
      // sees once it has synced that block. Wait for it, bounded, and record what the wallet saw.
      const began = Date.now();
      const synced = await Promise.race([wallet.waitForSyncedState().then(() => true), new Promise(resolve => setTimeout(resolve, 120000, false))]);
      control.walletView = {syncedBeforeBalancing: synced, syncWaitMs: Date.now() - began, ...dustView(await currentState(wallet))};
      // Run 3 lost its only DUST coin from the in-memory view after a rejected submission, while a
      // separate wallet synced a minute later still saw it at the cap. The cache is saved only at open,
      // so reopen from it (keeping the first proxy, which the indexer provider still uses).
      if (control.walletView.dustAvailableCoins === 0) {
        const lostAt = Date.now();
        await wallet.stop().catch(() => {});
        const fresh = await openStagedWallet(envPath);
        reopened.push(fresh); wallet = fresh.wallet;
        control.walletView = {...control.walletView, reopenedMs: Date.now() - lostAt, afterReopen: dustView(fresh.state)};
      }
      const recipe = await wallet.balanceUnboundTransaction(tx, {shieldedSecretKeys: shielded, dustSecretKey: dust}, {ttl});
      return wallet.finalizeRecipe(recipe);
    },
  };
  const midnightProvider = {
    // A rejected submission leaves its DUST spend pending locally until the TTL; revert it so
    // later steps can balance.
    submitTx: async tx => {
      try { if (control.gate) await control.gate(); return await wallet.submitTransaction(tx); }
      catch (error) { await wallet.revertTransaction(tx).catch(() => {}); throw error; }
    },
  };
  const providers = {
    privateStateProvider: memoryPrivateState(), publicDataProvider, zkConfigProvider,
    proofProvider: proofModule.httpClientProofProvider('http://127.0.0.1:6300', zkConfigProvider, {timeout: 300000}),
    walletProvider, midnightProvider,
  };
  const close = async () => {
    for (const fresh of reopened) await fresh.close().catch(() => {});
    if (reopened.length) await proxy.close(); else await opened.close();
  };
  return {opened, close, providers, compiled, contracts, module, control, publicDataProvider, provider: clientFor(proxy), ledgerV8, wallet: () => wallet};
}

export {errorClass};
