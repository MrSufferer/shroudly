import {existsSync, readFileSync, writeFileSync, renameSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import * as sdk from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {protectedConfiguration} from '../custody/protected-wallet.mjs';
import {providerProxy} from '../custody/provider-proxy.mjs';
import {emit} from './isolated.mjs';

// Staged variant of the custody protected-wallet bootstrap: identical key
// derivation and routes, but reports the stage (and error class only) that
// fails, with generous synchronization time for catching up from the cache.
// Diagnostic text with URLs, long hex, and key/value credentials removed, truncated.
export const redacted = text => String(text ?? '').replace(/[a-z]+:\/\/\S+/gi, '<url>').replace(/[0-9a-f]{24,}/gi, '<hex>').replace(/(project_id|token|seed|mnemonic|key)\S*/gi, '<redacted>').slice(0, 240);
// Effect fiber failures carry the failed error in a Cause under this symbol, not in .cause.
const FIBER_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause');
const failedIn = cause => cause && (cause.error ?? cause.defect ?? failedIn(cause.left) ?? failedIn(cause.right));
const causeOf = error => error?.cause ?? failedIn(error?.[FIBER_CAUSE]);
export const errorDetail = error => { const parts = []; for (let e = error, i = 0; e && i < 4; e = causeOf(e), i++) parts.push(`${e?.constructor?.name}: ${redacted(e?.message)}`); return parts.join(' <- '); };
export const errorClass = error => `${error?.constructor?.name ?? 'unknown'}${typeof error?.code === 'string' && /^[A-Z_0-9]{2,40}$/.test(error.code) ? `:${error.code}` : ''}`;

// Wallet synchronization from genesis took well over an hour on Preprod and once left the shared
// wallet's DUST view corrupted, so these scripts never sync from genesis. The serialized public
// wallet state (no seed or secret key is passed to restore(); keys are supplied at start) lives in
// a private directory outside the repository, named by SHROUDLY_TIMING_WALLET_CACHE, and must exist.
const CACHE_FILES = ['shielded', 'unshielded', 'dust'];
export function walletCache(env = process.env) {
  const dir = env.SHROUDLY_TIMING_WALLET_CACHE;
  if (!dir) throw Error('SHROUDLY_TIMING_WALLET_CACHE is not set; point it at a synced wallet cache copy (never sync from genesis)');
  const missing = CACHE_FILES.filter(name => !existsSync(join(dir, `${name}.json`)));
  if (missing.length) throw Error(`wallet cache is missing ${missing.join(', ')}; restore a synced cache copy (never sync from genesis)`);
  return dir;
}
async function saveCache(dir, wallet) {
  chmodSync(dir, 0o700);
  for (const name of CACHE_FILES) {
    const file = join(dir, `${name}.json`);
    writeFileSync(`${file}.tmp`, await wallet[name].serializeState(), {mode: 0o600});
    renameSync(`${file}.tmp`, file);
  }
}

export async function openStagedWallet(path, {syncMs = 9000000} = {}) {
  const cache = walletCache();
  const cached = name => readFileSync(join(cache, `${name}.json`), 'utf8');
  const started = Date.now();
  const stage = (name, extra = {}) => emit({stage: name, elapsedMs: Date.now() - started, ...extra});
  const timed = async (name, ms, promise) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('stage timeout'), {code: 'STAGE_TIMEOUT'})), ms); })]); }
    catch (error) { stage(`${name}-failed`, {error: errorClass(error)}); throw error; }
    finally { clearTimeout(timer); }
  };
  const {seed, configuration, token, endpoints} = protectedConfiguration(path);
  stage('configuration-read');
  const hd = sdk.HDWallet.fromSeed(seed);
  seed.fill(0);
  if (hd.type !== 'seedOk') throw Error('invalid deployment seed');
  const keys = hd.hdWallet.selectAccount(0).selectRoles([sdk.Roles.NightExternal, sdk.Roles.Dust, sdk.Roles.Zswap]).deriveKeysAt(0);
  hd.hdWallet.clear();
  if (keys.type !== 'keysDerived') throw Error('wallet key derivation failed');
  const shielded = ledger.ZswapSecretKeys.fromSeed(keys.keys[sdk.Roles.Zswap]);
  const dust = ledger.DustSecretKey.fromSeed(keys.keys[sdk.Roles.Dust]);
  const keystore = sdk.createKeystore(keys.keys[sdk.Roles.NightExternal], 'preprod');
  const proxy = await providerProxy({...endpoints, token});
  configuration.relayURL = new URL(proxy.rpc);
  configuration.indexerClientConnection = {indexerHttpUrl: proxy.http, indexerWsUrl: proxy.ws};
  // At Preprod's floor fee price a call that moves no coins prices at 0 DUST, and dust-wallet 4.2.0
  // then loops in balancing until wasm traps (#21, commit 2fc13c3). A fixed overhead forces coin selection.
  configuration.costParameters = {...configuration.costParameters, additionalFeeOverhead: 1_000_000_000n};
  stage('proxy-open');
  let wallet;
  try {
    wallet = await timed('wallet-init', 120000, sdk.WalletFacade.init({configuration,
      shielded: cfg => sdk.ShieldedWallet(cfg).restore(cached('shielded')),
      unshielded: cfg => sdk.UnshieldedWallet(cfg).restore(cached('unshielded')),
      dust: cfg => sdk.DustWallet(cfg).restore(cached('dust')),
    }));
    stage('wallet-restored', {fromCache: true});
    stage('wallet-init');
    await timed('wallet-start', 120000, wallet.start(shielded, dust));
    stage('wallet-start');
    // Progress counters only: integers describing indexer positions.
    const numbers = progress => progress && Object.fromEntries(['appliedIndex', 'highestRelevantWalletIndex', 'highestIndex', 'highestRelevantIndex'].map(key => [key, Number(progress[key])]));
    let latest;
    const watcher = wallet.state().subscribe(value => { latest = value; });
    const ticker = setInterval(() => {
      const view = latest;
      if (!view) return;
      stage('sync-progress', {shielded: numbers(view.shielded?.state?.progress ?? view.shielded?.progress), dust: numbers(view.dust?.state?.progress ?? view.dust?.progress), unshielded: numbers(view.unshielded?.progress ?? view.unshielded?.state?.progress)});
      saveCache(cache, wallet).catch(() => stage('cache-save-failed'));
    }, 60000);
    const state = await timed('wallet-sync', syncMs, wallet.waitForSyncedState()).finally(() => { clearInterval(ticker); watcher.unsubscribe(); });
    stage('wallet-sync');
    await saveCache(cache, wallet).catch(() => stage('cache-save-failed'));
    return {wallet, shielded, dust, keystore, configuration, state, provider: proxy, close: async () => { try { await wallet.stop(); } finally { await proxy.close(); } }};
  } catch (error) {
    if (wallet) await wallet.stop().catch(() => {});
    await proxy.close();
    throw error;
  }
}
