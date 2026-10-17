import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import * as sdk from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {protectedConfiguration} from '../custody/protected-wallet.mjs';
import {providerProxy} from '../custody/provider-proxy.mjs';
import {emit} from './isolated.mjs';

// Staged variant of the custody protected-wallet bootstrap: identical key
// derivation and routes, but reports the stage (and error class only) that
// fails, with generous synchronization time for a first sync from genesis.
// Diagnostic text with URLs, long hex, and key/value credentials removed, truncated.
export const redacted = text => String(text ?? '').replace(/[a-z]+:\/\/\S+/gi, '<url>').replace(/[0-9a-f]{24,}/gi, '<hex>').replace(/(project_id|token|seed|mnemonic|key)\S*/gi, '<redacted>').slice(0, 240);
export const errorDetail = error => { const parts = []; for (let e = error, i = 0; e && i < 4; e = e.cause, i++) parts.push(`${e?.constructor?.name}: ${redacted(e?.message)}`); return parts.join(' <- '); };
export const errorClass = error => `${error?.constructor?.name ?? 'unknown'}${typeof error?.code === 'string' && /^[A-Z_0-9]{2,40}$/.test(error.code) ? `:${error.code}` : ''}`;

// Wallet synchronization from genesis took well over an hour on Preprod, so the
// serialized public wallet state (no seed or secret key is passed to restore();
// keys are supplied at start) is cached in a private directory outside the
// repository. The cache is an optimization only: delete it to resync.
const CACHE = process.env.SHROUDLY_TIMING_WALLET_CACHE || '/tmp/shroudly-timing-wallet-cache';
async function saveCache(wallet) {
  mkdirSync(CACHE, {recursive: true, mode: 0o700}); chmodSync(CACHE, 0o700);
  for (const name of ['shielded', 'unshielded', 'dust']) {
    const file = join(CACHE, `${name}.json`);
    writeFileSync(`${file}.tmp`, await wallet[name].serializeState(), {mode: 0o600});
    renameSync(`${file}.tmp`, file);
  }
}
const cached = name => existsSync(join(CACHE, `${name}.json`)) ? readFileSync(join(CACHE, `${name}.json`), 'utf8') : undefined;

export async function openStagedWallet(path, {syncMs = 9000000} = {}) {
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
  stage('proxy-open');
  let wallet;
  try {
    wallet = await timed('wallet-init', 120000, sdk.WalletFacade.init({configuration,
      shielded: cfg => cached('shielded') ? sdk.ShieldedWallet(cfg).restore(cached('shielded')) : sdk.ShieldedWallet(cfg).startWithSecretKeys(shielded),
      unshielded: cfg => cached('unshielded') ? sdk.UnshieldedWallet(cfg).restore(cached('unshielded')) : sdk.UnshieldedWallet(cfg).startWithPublicKey(sdk.PublicKey.fromKeyStore(keystore)),
      dust: cfg => cached('dust') ? sdk.DustWallet(cfg).restore(cached('dust')) : sdk.DustWallet(cfg).startWithSecretKey(dust, ledger.LedgerParameters.initialParameters().dust),
    }));
    stage('wallet-restored', {fromCache: Boolean(cached('dust'))});
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
      saveCache(wallet).catch(() => stage('cache-save-failed'));
    }, 60000);
    const state = await timed('wallet-sync', syncMs, wallet.waitForSyncedState()).finally(() => { clearInterval(ticker); watcher.unsubscribe(); });
    stage('wallet-sync');
    await saveCache(wallet).catch(() => stage('cache-save-failed'));
    return {wallet, shielded, dust, keystore, configuration, state, provider: proxy, close: async () => { try { await wallet.stop(); } finally { await proxy.close(); } }};
  } catch (error) {
    if (wallet) await wallet.stop().catch(() => {});
    await proxy.close();
    throw error;
  }
}
