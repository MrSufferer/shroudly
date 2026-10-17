import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import * as sdk from '@midnight-ntwrk/wallet-sdk';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { providerProxy } from './provider-proxy.mjs';
import { withTimeout } from '../../../scripts/midnight-deploy-preprod.mjs';

// This module never logs credentials, account identifiers, transactions or SDK errors.
export function protectedConfiguration(path) {
  const env = {...parseEnv(readFileSync(path, 'utf8')), ...process.env};
  const read = (service) => {
    const result = spawnSync('/usr/bin/security', ['find-generic-password', '-a', env.MIDNIGHT_KEYCHAIN_ACCOUNT, '-s', service, '-w'], {encoding:'utf8', timeout:55000, stdio:['ignore','pipe','ignore']});
    if (result.status !== 0 || !result.stdout.trim()) throw Error('protected credential read failed');
    return result.stdout.trim();
  };

  const authenticated = (value, host, path, protocols) => {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) || url.port || url.hostname !== host || url.pathname !== path || url.username || url.password || url.search || url.hash) throw Error('endpoint outside approved Preprod route');
    return url.toString();
  };
  const http = authenticated(env.MIDNIGHT_INDEXER_HTTP_URL, 'midnight-preprod.blockfrost.io', '/api/v0', ['https:']);
  const ws = authenticated(env.MIDNIGHT_INDEXER_WS_URL, 'midnight-preprod.blockfrost.io', '/api/v0/ws', ['wss:']);
  const rpc = authenticated(env.MIDNIGHT_RPC_URL, 'rpc.midnight-preprod.blockfrost.io', '/', ['https:', 'wss:']);
  const prover = new URL(env.MIDNIGHT_PROOF_SERVER_URL);
  if (!['127.0.0.1','localhost'].includes(prover.hostname) || prover.username || prover.password || prover.search || prover.hash) throw Error('prover must be participant-local');
  const seed = read(`${env.MIDNIGHT_WALLET_SERVICE_PREFIX || 'com.shroudly.preprod.wallet.'}${env.MIDNIGHT_DEPLOYER_SECRET_NAME}`);
  if (!/^[a-fA-F0-9]{64}$/.test(seed)) throw Error('deployer seed must be 32-byte hex');
  const token=read(env.MIDNIGHT_BLOCKFROST_SECRET_NAME);
  return {env, token, endpoints:{http,ws,rpc}, seed: Buffer.from(seed,'hex'), configuration: {
    networkId:'preprod', costParameters:{feeBlocksMargin:5}, relayURL:new URL(rpc.replace(/^http/,'ws')),
    provingServerUrl:prover, indexerClientConnection:{indexerHttpUrl:http,indexerWsUrl:ws},
    txHistoryStorage:new sdk.InMemoryTransactionHistoryStorage(sdk.WalletEntrySchema, sdk.mergeWalletEntries),
  }};
}

export async function openProtectedWallet(path, timeoutMs=120000) {
  const {seed,configuration,token,endpoints} = protectedConfiguration(path);
  const hd = sdk.HDWallet.fromSeed(seed);
  seed.fill(0);
  if (hd.type !== 'seedOk') throw Error('invalid deployment seed');
  const keys = hd.hdWallet.selectAccount(0).selectRoles([sdk.Roles.NightExternal,sdk.Roles.Dust,sdk.Roles.Zswap]).deriveKeysAt(0);
  hd.hdWallet.clear();
  if (keys.type !== 'keysDerived') throw Error('wallet key derivation failed');
  const shielded = ledger.ZswapSecretKeys.fromSeed(keys.keys[sdk.Roles.Zswap]);
  const dust = ledger.DustSecretKey.fromSeed(keys.keys[sdk.Roles.Dust]);
  const keystore = sdk.createKeystore(keys.keys[sdk.Roles.NightExternal], 'preprod');
  const proxy=await providerProxy({...endpoints,token});
  configuration.relayURL=new URL(proxy.rpc);
  configuration.indexerClientConnection={indexerHttpUrl:proxy.http,indexerWsUrl:proxy.ws};
  let wallet,stage='initialization';
  try {
    wallet = await withTimeout(sdk.WalletFacade.init({configuration,
    shielded:cfg=>sdk.ShieldedWallet(cfg).startWithSecretKeys(shielded),
    unshielded:cfg=>sdk.UnshieldedWallet(cfg).startWithPublicKey(sdk.PublicKey.fromKeyStore(keystore)),
    dust:cfg=>sdk.DustWallet(cfg).startWithSecretKey(dust,ledger.LedgerParameters.initialParameters().dust),
    }),timeoutMs,'wallet initialization');stage='startup';
    await withTimeout(wallet.start(shielded,dust),timeoutMs,'wallet startup');stage='synchronization';
    const state = await withTimeout(wallet.waitForSyncedState(),timeoutMs,'wallet synchronization');
    return {wallet,shielded,dust,keystore,configuration,state,close:async()=>{try{await withTimeout(wallet.stop(),10000,'wallet cleanup');}finally{await proxy.close();}}};
  } catch {
    if(wallet)await withTimeout(wallet.stop(),10000,'wallet cleanup').catch(()=>{});
    await proxy.close();
    throw Object.assign(Error('protected wallet did not synchronize'),{stage});
  }
}
