import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import { firstValueFrom } from 'rxjs';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { u8aToHex } from '@polkadot/util';

import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  UnshieldedAddress,
} from '@midnightntwrk/wallet-sdk-address-format';
import { makeServerProvingService } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  getNetworkId,
  setNetworkId,
} from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const networkId = 'preprod';
const senderLabel = 'participant-1';
const amount = 500_000_000n;
const shouldSubmit = process.argv.includes('--submit');
const inspectOffer = process.argv.includes('--inspect');
const keychainAccount = process.env.MIDNIGHT_KEYCHAIN_ACCOUNT || 'shroudly-preprod';
const keychainServicePrefix = 'com.shroudly.preprod.wallet.';
const keychainPath = '/Users/kyler/Library/Keychains/login.keychain-db';
// The hosted Lace proof server is shut down; prove against the local 8.1.3 server.
const provingServerUrl = process.env.MIDNIGHT_PROOF_SERVER_URL || 'http://127.0.0.1:6300';
const blockfrostService = process.env.MIDNIGHT_BLOCKFROST_SECRET_NAME;
const rpcUrl = process.env.MIDNIGHT_RPC_URL || 'wss://rpc.midnight-preprod.blockfrost.io';
const indexerHttpUrl = process.env.MIDNIGHT_INDEXER_HTTP_URL || 'https://midnight-preprod.blockfrost.io/api/v0';
const indexerWsUrl = process.env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preprod.blockfrost.io/api/v0/ws';
const redactions = new Set();
const recipients = [
  {
    label: 'emergency',
    address: 'mn_addr_preprod1j8qg7gpegugvuedk9fj5kfpzhzanmjr2hvwrg7pxe9t37hvhw2cs2y8380',
  },
  {
    label: 'randomness',
    address: 'mn_addr_preprod169m45jf58xgwlwtul7vnx3q3w75dg5ahns4advfjk78xve0gp60qgky97s',
  },
  {
    label: 'dust',
    address: 'mn_addr_preprod1pce85qqse5k0hq7n6sa8yug2seyjucxpqavmvhlzrg8t7ps6aqksv9plf4',
  },
];

setNetworkId(networkId);

const security = (args) => spawnSync('/usr/bin/security', args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

const readSeed = (label) => {
  const result = security([
    'find-generic-password',
    '-a', keychainAccount,
    '-s', `${keychainServicePrefix}${label}`,
    '-w',
    keychainPath,
  ]);
  if (result.status !== 0) throw new Error(`No protected seed found for ${label}.`);
  const seed = result.stdout.trim();
  if (!/^[0-9a-f]{64}$/i.test(seed)) throw new Error(`Invalid protected seed for ${label}.`);
  return seed;
};

// Operator-account Blockfrost project ID, attached as a query parameter after
// every path (including /ws) is final. It never comes from argv or a file.
const redact = (text) => {
  let result = String(text);
  for (const secret of redactions) result = result.split(secret).join('[redacted]');
  return result;
};

// The polkadot WsProvider logs failing URLs, which carry the token; route
// every console line through the same redaction as the error summary.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const write = console[level].bind(console);
  console[level] = (...args) => write(...args.map((arg) => redact(
    typeof arg === 'string' ? arg : arg instanceof Error ? arg.stack ?? arg.message : inspect(arg),
  )));
}

const withProviderToken = (url) => {
  const parsed = new URL(url);
  if (!/(^|\.)blockfrost\.io$/i.test(parsed.hostname)) return url;
  if (!blockfrostService) throw new Error('MIDNIGHT_BLOCKFROST_SECRET_NAME must name the operator Blockfrost Keychain entry.');
  const result = security(['find-generic-password', '-a', keychainAccount, '-s', blockfrostService, '-w']);
  const token = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,512}$/.test(token)) throw new Error('Operator Blockfrost Keychain entry is missing or malformed.');
  redactions.add(token);
  parsed.searchParams.set('project_id', token);
  return parsed.toString();
};
const nodeUrl = withProviderToken(rpcUrl);

const derive = (label) => {
  const result = HDWallet.fromSeed(Buffer.from(readSeed(label), 'hex'));
  if (result.type !== 'seedOk') throw new Error(`HD wallet initialization failed for ${label}.`);
  const keys = result.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  result.hdWallet.clear();
  if (keys.type !== 'keysDerived') throw new Error(`Key derivation failed for ${label}.`);
  return {
    keystore: createKeystore(keys.keys[Roles.NightExternal], getNetworkId()),
    dustSecretKey: ledger.DustSecretKey.fromSeed(keys.keys[Roles.Dust]),
  };
};

const getLedgerParameters = async () => {
  const api = await ApiPromise.create({
    provider: new WsProvider(nodeUrl),
    noInitWarn: true,
    throwOnConnect: false,
  });
  try {
    const raw = await api.call.midnightRuntimeApi.getLedgerParameters();
    return ledger.LedgerParameters.deserialize(raw.toU8a(true));
  } finally {
    await api.disconnect().catch(() => undefined);
  }
};

const submitWithDirectRpc = async (serialized) => {
  const provider = new WsProvider(nodeUrl);
  const api = await ApiPromise.create({
    provider,
    noInitWarn: true,
    throwOnConnect: false,
  });

  let unsubscribe;
  let timer;
  try {
    const completion = new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      timer = setTimeout(() => {
        finish(new Error('Timed out waiting for the Preprod RPC transaction result.'));
      }, 60_000);

      api.tx.midnight.sendMnTransaction(u8aToHex(serialized)).send(async (result) => {
        const status = result.status;
        let event = 'unknown';
        if (status.isReady) event = 'ready';
        else if (status.isFuture) event = 'future';
        else if (status.isBroadcast) event = 'broadcast';
        else if (status.isInBlock) event = 'in-block';
        else if (status.isFinalized) event = 'finalized';
        else if (status.isRetracted) event = 'retracted';
        else if (status.isUsurped) event = 'usurped';
        else if (status.isDropped) event = 'dropped';
        else if (status.isInvalid) event = 'invalid';

        const output = { event };
        if (result.txHash?.toHex) output.txHash = result.txHash.toHex();
        if (status.isInBlock && status.asInBlock?.toHex) output.blockHash = status.asInBlock.toHex();
        if (status.isFinalized && status.asFinalized?.toHex) output.blockHash = status.asFinalized.toHex();
        if (result.dispatchError && !result.dispatchError.isEmpty) {
          output.dispatchError = result.dispatchError.toString();
        }
        console.log(JSON.stringify(output));

        if (status.isInvalid || status.isDropped || status.isUsurped || status.isRetracted) {
          finish(new Error(`Preprod RPC reported transaction ${event}.`));
          return;
        }
        if (status.isFinalized) {
          const blockHash = status.asFinalized;
          const header = await api.rpc.chain.getHeader(blockHash);
          finish(undefined, {
            txHash: result.txHash.toHex(),
            blockHeight: header.number.toString(),
          });
        }
      }).then((unsub) => {
        unsubscribe = unsub;
      }).catch((error) => finish(error));
    });

    return await completion;
  } finally {
    if (unsubscribe) unsubscribe();
    await api.disconnect().catch(() => undefined);
  }
};

const waitForStop = async (wallet) => {
  await Promise.race([
    wallet.stop().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
};

const summarizeOffer = (transaction) => {
  const entries = Array.from(transaction.intents.entries());
  const intent = entries[0]?.[1];
  const offer = intent?.fallibleUnshieldedOffer ?? intent?.guaranteedUnshieldedOffer;
  const registration = intent?.dustActions?.registrations?.[0];
  return {
    segments: entries.map(([segment]) => String(segment)),
    offer: offer
      ? {
          inputs: offer.inputs.map(({ value, outputNo }) => ({ value: value.toString(), outputNo })),
          outputs: offer.outputs.map(({ value }) => ({ value: value.toString() })),
          inputTotal: offer.inputs.reduce((total, { value }) => total + value, 0n).toString(),
          outputTotal: offer.outputs.reduce((total, { value }) => total + value, 0n).toString(),
        }
      : null,
    dustRegistration: registration
      ? { allowFeePayment: registration.allowFeePayment.toString() }
      : null,
  };
};

const configuration = {
  networkId,
  batchUpdates: { size: 1000, timeout: 50, spacing: 0 },
  costParameters: { feeBlocksMargin: 5 },
  indexerClientConnection: {
    indexerWsUrl: withProviderToken(indexerWsUrl),
    indexerHttpUrl: withProviderToken(indexerHttpUrl),
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
};

const { keystore, dustSecretKey } = derive(senderLabel);
const nightVerifyingKey = keystore.getPublicKey();
const wallet = UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore));
const ledgerParameters = await getLedgerParameters();
const dust = DustWallet(configuration).startWithSecretKey(dustSecretKey, ledgerParameters.dust);
let bookedTransaction;

try {
  await wallet.start();
  const state = await wallet.waitForSyncedState();
  const senderAddress = MidnightBech32m.encode(networkId, state.address).asString();
  if (senderAddress !== 'mn_addr_preprod13ketcp6387rldh4q4uzvdjehms394rqewdhqk57cuplx6sy44k4qvz0rvz') {
    throw new Error('The protected sender address does not match the release worksheet.');
  }

  const tokenType = ledger.nativeToken().raw;
  const nativeAvailable = state.availableCoins.filter(({ utxo, meta }) => (
    utxo.type === tokenType && !meta.registeredForDustGeneration
  ));
  if (nativeAvailable.length !== 1) {
    throw new Error(`Expected exactly one unregistered native NIGHT UTxO; found ${nativeAvailable.length}.`);
  }

  const nightUtxos = nativeAvailable.map(({ utxo, meta }) => ({
    ...utxo,
    ctime: meta.ctime,
    registeredForDustGeneration: meta.registeredForDustGeneration,
  }));
  const dustState = await firstValueFrom(dust.state);
  const now = new Date();
  const split = await dust.splitNightUtxosForDustRegistration(now, nightUtxos, true);
  if (split.guaranteedUtxos.length === 0 || split.feePayment <= 0n) {
    throw new Error('The available NIGHT UTxO cannot provide a DUST registration fee.');
  }

  const outputs = recipients.map(({ address }) => ({
    type: tokenType,
    receiverAddress: MidnightBech32m.parse(address).decode(UnshieldedAddress, networkId),
    amount,
  }));
  const ttl = new Date(now.getTime() + 60 * 60 * 1000);

  // The registration is attached to the same segment as the transfer. The
  // generated DUST allowance therefore pays this transaction's fee without
  // requiring a full historical DUST-wallet sync first.
  bookedTransaction = await wallet.transferTransaction(outputs, ttl);
  const withRegistration = await dust.attachDustRegistration(
    bookedTransaction,
    now,
    nightVerifyingKey,
    dustState.address,
    split.feePayment,
  );

  const fakeSigningKey = ledger.sampleSigningKey();
  const registrationIntent = withRegistration.intents.get(1);
  const feeProbe = await dust.addDustRegistrationSignature(
    withRegistration,
    ledger.signData(fakeSigningKey, registrationIntent.signatureData(1)),
  );
  const fee = await dust.calculateFee([feeProbe.mockProve().bind()]);
  if (split.feePayment < fee) {
    throw new Error(`Generated DUST is below the combined transaction fee (have ${split.feePayment}, need ${fee}).`);
  }

  console.log(JSON.stringify({
    network: networkId,
    sender: senderLabel,
    recipients: recipients.map(({ label, address }) => ({ label, address })),
    amountAtomicPerRecipient: amount.toString(),
    generatedDustAllowance: split.feePayment.toString(),
    estimatedFee: fee.toString(),
    transaction: summarizeOffer(withRegistration),
  }));

  const signedUnshielded = await wallet.signUnprovenTransaction(
    withRegistration,
    (data) => keystore.signData(data),
  );
  const signed = await dust.addDustRegistrationSignature(
    signedUnshielded,
    keystore.signData(signedUnshielded.intents.get(1).signatureData(1)),
  );
  const provingService = makeServerProvingService({ provingServerUrl: new URL(provingServerUrl) });
  const provenUnbound = await provingService.prove(signed);
  const finalized = provenUnbound.bind();

  if (!shouldSubmit) {
    console.log(JSON.stringify({
      network: networkId,
      sender: senderLabel,
      status: 'dry-run-proven',
      identifiers: finalized.identifiers(),
    }));
  } else {
    const result = await submitWithDirectRpc(finalized.serialize());
    console.log(JSON.stringify({
      network: networkId,
      sender: senderLabel,
      recipients: recipients.map(({ label, address }) => ({ label, address })),
      amountAtomicPerRecipient: amount.toString(),
      status: 'finalized',
      txHash: result.txHash,
      blockHeight: result.blockHeight,
    }));
  }
} catch (error) {
  if (bookedTransaction) {
    await wallet.revertTransaction(bookedTransaction).catch(() => undefined);
  }
  const messages = [];
  let current = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    messages.push(`${current.name ?? 'Error'}: ${current.message ?? 'Preprod funding failed.'}`);
    current = current.cause;
  }
  console.error(messages.join(' <- '));
  process.exitCode = 1;
} finally {
  await waitForStop(wallet);
  await waitForStop(dust);
}
