import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileCustody, sanitizeStep } from './reconciliation.mjs';

// Genuine Preprod custody journey: one process syncs the protected wallet once, then
// deploys, seeds, allocates and withdraws, and reconciles through a fresh indexer client.
// Child stdout/stderr are discarded (SDKs may log URLs). The parent persists only an
// explicit allowlist projection; no credential, seed, URL or SDK error text is retained.
const LOCK = '/tmp/shroudly-wallet.lock';
const CACHE = process.env.SHROUDLY_CUSTODY_WALLET_CACHE || '/tmp/shroudly-custody-wallet-cache';
const managed = new URL('../../managed/custody-probe/', import.meta.url);
const resultPath = fileURLToPath(new URL('./network-journey-result.json', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (text) => String(text ?? '').replace(/[A-Za-z0-9+/=_-]{24,}/g, '<redacted>').replace(/[^A-Za-z0-9 _.:<>-]/g, ' ').slice(0, 160);
const bytes = (n) => new Uint8Array(32).fill(n);

async function worker(envPath) {
  const send = (message) => process.send?.(message);
  let lockHeld = false;
  const withLock = async (opened, fn) => {
    for (;;) {
      try { mkdirSync(LOCK); break; } catch (error) { if (error.code !== 'EEXIST') throw error; await sleep(5000); }
    }
    lockHeld = true; send({ lock: 'held' });
    try { await opened.wallet.waitForSyncedState(); return await fn(); }
    finally { try { rmdirSync(LOCK); } catch { /* already released */ } lockHeld = false; send({ lock: 'released' }); }
  };
  const step = async (name, fn) => {
    const started = Date.now();
    try { const value = await fn(); return { ok: true, value, elapsedMs: Date.now() - started }; }
    catch (error) { send({ failure: { step: name, errorName: redact(error?.name), message: redact(error?.message) } }); return { ok: false }; }
  };

  const [{ openProtectedWallet }, sdk, ledger, contracts, indexer, zkModule, proofModule, privateModule, compactJs, nodeModule, deployScript] = await Promise.all([
    import('./protected-wallet.mjs'), import('@midnight-ntwrk/wallet-sdk'), import('@midnight-ntwrk/ledger-v8'),
    import('@midnight-ntwrk/midnight-js-contracts'), import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-node-zk-config-provider'), import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    import('@midnight-ntwrk/midnight-js-level-private-state-provider'), import('@midnight-ntwrk/midnight-js-protocol/compact-js'),
    import('@midnight-ntwrk/wallet-sdk/node-client'), import('../../../scripts/midnight-deploy-preprod.mjs')
  ]);
  const { Contract, ledger: readLedger } = await import('../../managed/custody-probe/contract/index.js');
  (await import('@midnight-ntwrk/midnight-js-network-id')).setNetworkId('preprod');

  let last = 0;
  const syncStarted = Date.now();
  const opened = await openProtectedWallet(envPath, 3 * 3600 * 1000 - 600000, (progress) => { if (Date.now() - last > 20000) { last = Date.now(); send({ progress }); } }, CACHE);
  let privateDirectory;
  try {
    send({ step: { name: opened.restoredFromCache ? 'wallet-sync-from-cache' : 'wallet-sync', elapsedMs: Date.now() - syncStarted, status: 'Synchronized' } });
    const sum = (record) => Object.values(record ?? {}).reduce((a, b) => a + BigInt(b), 0n);
    const dustNow = () => opened.state.dust.balance(new Date());
    send({ funding: { nightBalance: sum(opened.state.unshielded.balances).toString(), dustBalance: dustNow().toString() } });
    // DUST registration is owned by the #23 run; this journey only waits for positive DUST.
    const dustWaitStarted = Date.now();
    while (opened.state.dust.balance(new Date()) <= 0n) {
      if (Date.now() - dustWaitStarted > 2 * 3600 * 1000) throw Error('no positive DUST within wait window');
      await sleep(60000);
      opened.state = await opened.wallet.waitForSyncedState();
    }
    send({ funding: { nightBalance: sum(opened.state.unshielded.balances).toString(), dustBalance: dustNow().toString() } });

    // Providers (token-free loopback routes owned by the protected wallet module).
    const rpc = opened.configuration.relayURL;
    const { indexerHttpUrl: http, indexerWsUrl: ws } = opened.configuration.indexerClientConnection;
    const node = await nodeModule.PolkadotNodeClient.init({ nodeURL: new URL(rpc) });
    const midnightProvider = { submitTx: async (finalized) => {
      const id = deployScript.finalizedTransactionId(finalized);
      const submitted = await node.sendMidnightTransactionAndWait(finalized.serialize(), 'Finalized');
      if (submitted?._tag && submitted._tag !== 'Finalized') throw Error('not finalized');
      return id;
    } };
    const walletProvider = {
      getCoinPublicKey: () => opened.shielded.coinPublicKey,
      getEncryptionPublicKey: () => opened.shielded.encryptionPublicKey,
      balanceTx: async (tx, ttl = new Date(Date.now() + 3_600_000)) => {
        const recipe = await opened.wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys: opened.shielded, dustSecretKey: opened.dust }, { ttl });
        return opened.wallet.finalizeRecipe(recipe);
      },
    };
    const publicDataProvider = indexer.indexerPublicDataProvider(http, ws);
    privateDirectory = mkdtempSync(join(tmpdir(), 'custody-private-'));
    const password = `Aa1!${randomBytes(18).toString('hex')}`;
    const privateStateProvider = privateModule.levelPrivateStateProvider({
      midnightDbName: join(privateDirectory, 'db'), privateStateStoreName: 'custody-private', signingKeyStoreName: 'custody-keys',
      privateStoragePasswordProvider: () => password, accountId: 'custody-experiment',
    });
    const bundle = (tag, ContractClass, directory, witnessMap) => {
      const zkConfigProvider = new zkModule.NodeZkConfigProvider(directory.pathname);
      const proofProvider = proofModule.httpClientProofProvider('http://127.0.0.1:6300', zkConfigProvider, { timeout: 300000 });
      let compiled = compactJs.CompiledContract.make(tag, ContractClass);
      compiled = compactJs.CompiledContract.withWitnesses(witnessMap)(compiled);
      compiled = compactJs.CompiledContract.withCompiledFileAssets(directory.pathname)(compiled);
      return { tag, compiledContract: compiled, providers: { privateStateProvider, publicDataProvider, zkConfigProvider, proofProvider, walletProvider, midnightProvider } };
    };

    // Contract with ephemeral authority secret; openings are public synthetic fixtures.
    let authoritySecret = randomBytes(32);
    let qualifiedCoin;
    const recipientBytes = Uint8Array.from(Buffer.from(opened.shielded.coinPublicKey, 'hex'));
    const witnesses = {
      owner: ({ privateState }) => [privateState, authoritySecret],
      first: ({ privateState }) => [privateState, bytes(2)], second: ({ privateState }) => [privateState, bytes(3)], third: ({ privateState }) => [privateState, bytes(4)],
      spendable: ({ privateState }) => { if (!qualifiedCoin) throw Error('qualified coin unavailable'); return [privateState, qualifiedCoin]; },
      recipient: ({ privateState }) => [privateState, { bytes: recipientBytes }],
    };
    const probe = bundle('CustodyProbe', Contract, managed, witnesses);

    // Indexer helpers: independent GraphQL reads, no SDK state involved.
    const gql = async (query, variables) => {
      const response = await fetch(http, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      if (body.errors) throw Error('indexer query error');
      return body.data;
    };
    const transactionEvidence = async (txHash, address) => {
      const data = await gql('query($hash: HexEncoded!){ transactions(offset:{hash:$hash}){ hash raw ... on RegularTransaction { zswapLedgerEvents { id raw } } } }', { hash: txHash });
      const tx = data.transactions?.[0];
      if (!tx) throw Error('transaction not indexed');
      const events = (tx.zswapLedgerEvents ?? []).map((e) => ledger.Event.deserialize(Uint8Array.from(Buffer.from(e.raw, 'hex'))).content);
      return {
        txBytes: tx.raw.length / 2,
        outputs: events.filter((c) => c.tag === 'zswapOutput' && c.contract === address),
        contractInputs: events.filter((c) => c.tag === 'zswapInput' && c.contract === address).length,
      };
    };
    const publicOf = (finalized) => ({ txHash: finalized.public.txHash, blockHeight: Number(finalized.public.blockHeight), blockHash: finalized.public.blockHash, status: String(finalized.public.status) });
    const submitCall = (address, circuitId, args = [], target = probe) => withLock(opened, async () => {
      const dustBefore = dustNow();
      const started = Date.now();
      const result = await contracts.submitCallTx(target.providers, { compiledContract: target.compiledContract, contractAddress: address, circuitId, args, privateStateId: target.tag });
      const state = await opened.wallet.waitForSyncedState();
      return { ...publicOf(result), elapsedMs: Date.now() - started, dustSpentApprox: (dustBefore - state.dust.balance(new Date())).toString() };
    });
    const expectRejection = async (name, address, circuitId, args, expected) => {
      let rejected = false; let matched = false;
      try { await contracts.createUnprovenCallTx(probe.providers, { compiledContract: probe.compiledContract, contractAddress: address, circuitId, args, privateStateId: probe.tag }); }
      catch (error) { rejected = true; matched = String(error?.message).includes(expected); }
      send({ rejection: { name, rejected, reasonMatched: matched } });
    };
    const freshReconciliation = async (address) => {
      const fresh = indexer.indexerPublicDataProvider(http, ws);
      const states = await contracts.getPublicStates(fresh, address);
      const state = readLedger(states.contractState);
      const reconciliation = reconcileCustody(state);
      const domain = Buffer.alloc(32); domain.write('Shroudly/custody-probe');
      const derivedColor = ledger.rawTokenType(Uint8Array.from(domain), address);
      const custodyColor = Buffer.from(state.custody.color).toString('hex');
      return { reconciliation: { ...reconciliation, reconciled: reconciliation.reconciled && custodyColor === derivedColor }, custodyColor, colorDerivedFromContractAddress: custodyColor === derivedColor, allocatedYield: state.allocatedYield.toString(), seeded: state.seeded };
    };

    const deployContract = (name, target, args = []) => withLock(opened, () => step(name, async () => {
      const dustBefore = dustNow();
      const started = Date.now();
      const deployed = await contracts.deployContract(target.providers, { compiledContract: target.compiledContract, args, privateStateId: target.tag, initialPrivateState: {} });
      const state = await opened.wallet.waitForSyncedState();
      return { address: String(deployed.deployTxData.public.contractAddress ?? deployed.address), ...publicOf(deployed.deployTxData), elapsedMs: Date.now() - started, dustSpentApprox: (dustBefore - state.dust.balance(new Date())).toString() };
    }));

    const colocated = async () => {
    // 1. Deploy
    const deploy = await deployContract('deploy', probe);
    if (!deploy.ok) return;
    const address = deploy.value.address;
    send({ contract: address });
    const deployEvidence = await step('deploy-indexer', () => transactionEvidence(deploy.value.txHash, address));
    send({ step: { name: 'deploy', txHash: deploy.value.txHash, blockHeight: deploy.value.blockHeight, blockHash: deploy.value.blockHash, status: deploy.value.status, elapsedMs: deploy.value.elapsedMs, dustSpentApprox: deploy.value.dustSpentApprox, txBytes: deployEvidence.value?.txBytes } });

    // 2. Seed (mint + receive shielded reserve to contract)
    const seed = await step('seed', () => submitCall(address, 'seed'));
    if (!seed.ok) return;
    const seedEvidence = await step('seed-indexer', () => transactionEvidence(seed.value.txHash, address));
    send({ step: { name: 'seed', ...seed.value, txBytes: seedEvidence.value?.txBytes, contractOutputs: seedEvidence.value?.outputs.length } });
    if (seedEvidence.value?.outputs.length !== 1) { send({ failure: { step: 'seed-index', message: 'expected exactly one contract output' } }); return; }
    const afterSeed = await step('seed-state', async () => {
      const states = await contracts.getPublicStates(publicDataProvider, address);
      return readLedger(states.contractState);
    });
    if (!afterSeed.ok) return;
    qualifiedCoin = { ...afterSeed.value.custody, mt_index: seedEvidence.value.outputs[0].mtIndex };

    // 3. Live-state rejections (rejected locally before any submission)
    await expectRejection('forged-draw-mismatch', address, 'allocateYield', [2n, 0n, 1n], 'draw mismatch');
    await expectRejection('contributor-binding-mismatch', address, 'allocateYield', [1n, 2n, 1n], 'contributor binding mismatch');
    await expectRejection('duplicate-contributor', address, 'allocateYield', [1n, 0n, 0n], 'distinct contributors required');
    const realSecret = authoritySecret;
    authoritySecret = randomBytes(32);
    await expectRejection('unauthorized-asset-release', address, 'withdraw', [400000n], 'unauthorized asset release');
    authoritySecret = realSecret;
    await expectRejection('principal-liability-exceeded', address, 'withdraw', [1000001n], 'principal liability exceeded');

    // 4. Allocate yield, then repeat is rejected on live state
    const allocate = await step('allocate', () => submitCall(address, 'allocateYield', [1n, 0n, 1n]));
    if (!allocate.ok) return;
    send({ step: { name: 'allocateYield', ...allocate.value } });
    await expectRejection('repeated-yield-allocation', address, 'allocateYield', [1n, 0n, 1n], 'already allocated');

    // 5. Withdraw 400000 of Principal liability back to the wallet
    const withdraw = await step('withdraw', () => submitCall(address, 'withdraw', [400000n]));
    if (!withdraw.ok) return;
    const withdrawEvidence = await step('withdraw-indexer', () => transactionEvidence(withdraw.value.txHash, address));
    send({ step: { name: 'withdraw', ...withdraw.value, txBytes: withdrawEvidence.value?.txBytes, contractOutputs: withdrawEvidence.value?.outputs.length, contractInputs: withdrawEvidence.value?.contractInputs } });

    // 6. Fresh-indexer reconciliation and wallet-side release observation
    const fresh = await step('fresh-reconciliation', () => freshReconciliation(address));
    if (fresh.ok) send({ reconciliation: fresh.value });
    const finalState = await opened.wallet.waitForSyncedState();
    send({ walletRelease: { shieldedColorBalances: Object.fromEntries(Object.entries(finalState.shielded.balances ?? {}).map(([k, v]) => [k, BigInt(v).toString()])) } });
    };

    // 7. Separated topology on the same network: asset holds custody, pool keeps liabilities.
    // Without cross-contract calls (ledger 8) the pool records a caller-supplied claim.
    const separated = async () => {
      const assetModule = await import('../../managed/separated-asset/contract/index.js');
      const poolModule = await import('../../managed/separated-pool/contract/index.js');
      const ownerOnly = { owner: ({ privateState }) => [privateState, authoritySecret] };
      const asset = bundle('SeparatedAsset', assetModule.Contract, new URL('../../managed/separated-asset/', import.meta.url), ownerOnly);
      const pool = bundle('SeparatedPool', poolModule.Contract, new URL('../../managed/separated-pool/', import.meta.url), ownerOnly);
      const assetDeploy = await deployContract('separated-asset-deploy', asset);
      if (!assetDeploy.ok) return;
      const assetAddress = assetDeploy.value.address;
      send({ separatedAsset: assetAddress });
      send({ step: { name: 'separated-asset-deploy', ...assetDeploy.value, address: undefined } });
      const assetSeed = await step('separated-asset-seed', () => submitCall(assetAddress, 'seed', [], asset));
      if (!assetSeed.ok) return;
      send({ step: { name: 'separated-asset-seed', ...assetSeed.value } });
      const poolDeploy = await deployContract('separated-pool-deploy', pool, [Uint8Array.from(Buffer.from(assetAddress, 'hex'))]);
      if (!poolDeploy.ok) return;
      const poolAddress = poolDeploy.value.address;
      send({ separatedPool: poolAddress });
      send({ step: { name: 'separated-pool-deploy', ...poolDeploy.value, address: undefined } });
      const forged = await step('separated-pool-forged-claim', () => submitCall(poolAddress, 'recordSeed', [5000000n], pool));
      if (!forged.ok) return;
      send({ step: { name: 'separated-pool-forged-claim', ...forged.value } });
      const forgedResult = await step('separated-pool-forged-randomness', () => submitCall(poolAddress, 'allocateYield', [424242n], pool));
      if (forgedResult.ok) send({ step: { name: 'separated-pool-forged-randomness', ...forgedResult.value } });
      const view = await step('separated-fresh-reconciliation', async () => {
        const fresh = indexer.indexerPublicDataProvider(http, ws);
        const assetState = assetModule.ledger((await contracts.getPublicStates(fresh, assetAddress)).contractState);
        const poolState = poolModule.ledger((await contracts.getPublicStates(fresh, poolAddress)).contractState);
        return reconcileCustody({ custody: { value: assetState.custody.value }, principalLiability: poolState.principalLiability, prizeReserve: poolState.prizeReserve, prizeLiability: poolState.prizeLiability });
      });
      if (view.ok) send({ separatedReconciliation: view.value });
    };

    await colocated();
    await separated();
  } finally {
    if (lockHeld) { try { rmdirSync(LOCK); } catch { /* ignore */ } }
    if (privateDirectory) rmSync(privateDirectory, { recursive: true, force: true });
    await opened.close().catch(() => {});
  }
}

if (process.argv[2] === '--worker') {
  try { await worker(process.argv[3]); send_done(); } catch (error) { process.send?.({ failure: { step: 'journey', errorName: redact(error?.name), message: redact(error?.message) } }); }
  process.exit();
}
function send_done() { process.send?.({ done: true }); }

if (!process.argv[2]) throw Error('Pass the protected local environment file path');
const started = Date.now();
const evidence = { format: 'shroudly-custody-network-journey-v1', startedAt: new Date().toISOString(), steps: [], rejections: [], failures: [], releaseQualified: false };
const child = fork(fileURLToPath(import.meta.url), ['--worker', process.argv[2]], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
const timer = setTimeout(() => child.kill('SIGKILL'), 3 * 3600 * 1000);
let lockState = 'released';
const num = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined);
const str = (v, re) => (typeof v === 'string' && re.test(v) ? v : undefined);
child.on('message', (m) => {
  if (m?.progress) { console.error(JSON.stringify({ progress: m.progress, at: new Date().toISOString() })); return; }
  if (m?.lock) lockState = m.lock;
  if (m?.lock) console.error(JSON.stringify({ lock: m.lock, at: new Date().toISOString() }));
  if (m?.step) {
    try {
      const base = sanitizeStep(m.step);
      for (const key of ['txBytes', 'contractOutputs', 'contractInputs']) if (num(m.step[key]) !== undefined) base[key] = m.step[key];
      const dust = str(m.step.dustSpentApprox, /^-?\d{1,30}$/); if (dust) base.dustSpentApprox = dust;
      evidence.steps.push(base);
      console.error(JSON.stringify({ step: base.name, status: base.status }));
    } catch { evidence.failures.push({ step: 'evidence-projection', message: 'invalid step evidence' }); }
  }
  if (m?.funding) evidence.funding = { nightBalance: str(m.funding.nightBalance, /^\d{1,30}$/), dustBalance: str(m.funding.dustBalance, /^\d{1,30}$/) };
  if (m?.separatedAsset) evidence.separatedAssetAddress = str(m.separatedAsset, /^[0-9a-f]{64}$/);
  if (m?.separatedPool) evidence.separatedPoolAddress = str(m.separatedPool, /^[0-9a-f]{64}$/);
  if (m?.separatedReconciliation) evidence.separatedFreshIndexerView = { ...Object.fromEntries(['custodyValue', 'principalLiability', 'prizeReserve', 'prizeLiability', 'liabilitiesTotal'].map((k) => [k, str(m.separatedReconciliation[k], /^\d{1,30}$/)])), reconciled: m.separatedReconciliation.reconciled === true };
  if (m?.contract) evidence.contractAddress = str(m.contract, /^[0-9a-f]{64}$/);
  if (m?.rejection) evidence.rejections.push({ name: str(m.rejection.name, /^[a-z-]{1,60}$/), rejected: m.rejection.rejected === true, reasonMatched: m.rejection.reasonMatched === true });
  if (m?.reconciliation) {
    const r = m.reconciliation.reconciliation;
    evidence.freshIndexerReconciliation = { ...Object.fromEntries(['custodyValue', 'principalLiability', 'prizeReserve', 'prizeLiability', 'liabilitiesTotal'].map((k) => [k, str(r?.[k], /^\d{1,30}$/)])), reconciled: r?.reconciled === true, custodyColor: str(m.reconciliation.custodyColor, /^[0-9a-f]{64}$/), allocatedYield: str(m.reconciliation.allocatedYield, /^\d{1,30}$/), seeded: m.reconciliation.seeded === true, colorDerivedFromContractAddress: m.reconciliation.colorDerivedFromContractAddress === true };
  }
  if (m?.walletRelease) evidence.walletRelease = { shieldedColorBalances: Object.fromEntries(Object.entries(m.walletRelease.shieldedColorBalances ?? {}).filter(([k, v]) => /^[0-9a-f]{64}$/.test(k) && /^\d{1,30}$/.test(v))) };
  if (m?.failure) { evidence.failures.push({ step: str(m.failure.step, /^[a-z-]{1,40}$/), errorName: str(m.failure.errorName, /^[A-Za-z0-9 _.:<>-]{0,160}$/), message: str(m.failure.message, /^[A-Za-z0-9 _.:<>-]{0,160}$/) }); }
});
child.on('exit', () => {
  clearTimeout(timer);
  // Remove the lock only if this run still held it when the worker died; never another agent's.
  if (lockState === 'held') { try { rmdirSync(LOCK); } catch { /* already gone */ } }
  evidence.finishedAt = new Date().toISOString();
  evidence.elapsedMs = Date.now() - started;
  evidence.complete = evidence.failures.length === 0 && evidence.steps.some((s) => s.name === 'withdraw') && evidence.freshIndexerReconciliation?.reconciled === true;
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.complete ? 0 : 1;
});
