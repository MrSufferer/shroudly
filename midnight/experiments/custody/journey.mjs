import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContractLedger } from './runtime-state.mjs';
import { evidenceManifest } from './evidence-manifest.mjs';
import { submissionEvidence } from './submission-evidence.mjs';
import { reconcileCustody, sanitizeStep } from './reconciliation.mjs';
import { firstValueFrom, filter } from 'rxjs';

// Genuine Preprod custody journey: one process syncs the protected wallet once, then
// deploys, seeds, allocates and withdraws, and reconciles through a fresh indexer client.
// Child stdout/stderr are discarded (SDKs may log URLs). The parent persists only an
// explicit allowlist projection; no credential, seed, URL or SDK error text is retained.
const LOCK = '/tmp/shroudly-wallet.lock';
const CACHE = process.env.SHROUDLY_CUSTODY_WALLET_CACHE || '/tmp/shroudly-custody-wallet-cache';
const managed = new URL('../../managed/custody-probe/', import.meta.url);
const resultPath = fileURLToPath(new URL('./network-journey-result.json', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Fixed categories only: dependency messages may include provider credentials.
const failureCategory = error => {
  const message = String(error?.message ?? '');
  if (message === 'protected credential read failed') return 'credential-unavailable';
  if (message === 'endpoint outside approved Preprod route') return 'endpoint-invalid';
  if (message === 'protected wallet did not synchronize') return ['initialization','startup','synchronization'].includes(error.stage) ? `wallet-${error.stage}-failed` : 'wallet-initialization-failed';
  if (error?.code === 'OUTCOME_UNKNOWN') return 'outcome-unknown';
  if (message.includes('expected instance of StateValue')) return 'runtime-statevalue-mismatch';
  if (message.includes('expected exactly one contract output')) return 'unexpected-contract-output-count';
  if (message.includes('qualified coin unavailable')) return 'qualified-coin-unavailable';
  if (message.includes('indexer query error')) return 'indexer-query-failed';
  return 'operation-failed';
};
const bounded = async (operation, milliseconds) => {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('bounded operation expired'), { code: 'OUTCOME_UNKNOWN' })), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const bytes = (n) => new Uint8Array(32).fill(n);
// Midnight "Manage DUST" settled predicate: a synced state alone can still hold the DUST
// coin spent by the previous transaction (node rejection 170, InvalidDustSpendProof).
const settled = (state) => state.isSynced && state.pending.all.length === 0 &&
  state.unshielded.pendingCoins.length === 0 && state.dust.pendingCoins.length === 0 && state.dust.availableCoins.length > 0;
const settledState = (wallet) => bounded(firstValueFrom(wallet.state().pipe(filter(settled))), 900000);

async function worker(envPath) {
  const send = (message) => process.send?.(message);
  let lockHeld = false;
  const withLock = async (opened, fn) => {
    for (;;) {
      try { mkdirSync(LOCK); break; } catch (error) { if (error.code !== 'EEXIST') throw error; await sleep(5000); }
    }
    lockHeld = true; send({ lock: 'held' });
    try { opened.state = await settledState(opened.wallet); return await fn(); }
    finally { try { rmdirSync(LOCK); } catch { /* already released */ } lockHeld = false; send({ lock: 'released' }); }
  };
  // A pending spend of unknown outcome must not be saved into the cache another run will restore.
  let outcomeUnknown = false;
  const step = async (name, fn) => {
    const started = Date.now();
    try { const value = await fn(); return { ok: true, value, elapsedMs: Date.now() - started }; }
    catch (error) { send({ failure: { step: name, category: failureCategory(error) } }); if (error?.code === 'OUTCOME_UNKNOWN') { outcomeUnknown = true; throw error; } return { ok: false }; }
  };

  const [{ openProtectedWallet }, sdk, ledger, contracts, indexer, zkModule, proofModule, privateModule, compactJs, deployScript] = await Promise.all([
    import('./protected-wallet.mjs'), import('@midnight-ntwrk/wallet-sdk'), import('@midnight-ntwrk/ledger-v8'),
    import('@midnight-ntwrk/midnight-js-contracts'), import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-node-zk-config-provider'), import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    import('@midnight-ntwrk/midnight-js-level-private-state-provider'), import('@midnight-ntwrk/midnight-js-protocol/compact-js'),
    import('../../../scripts/midnight-deploy-preprod.mjs')
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
    const { indexerHttpUrl: http, indexerWsUrl: ws } = opened.configuration.indexerClientConnection;
    const midnightProvider = { submitTx: async (finalized) => {
      const id = deployScript.finalizedTransactionId(finalized);
      send({ submitted: { txHash: id, txBytes: finalized.serialize().length, at: new Date().toISOString() } });
      // The facade tracks the pending spend, waits for Finalized and reverts wallet state on failure.
      await bounded(opened.wallet.submitTransaction(finalized), 180000);
      send({ nodeFinalized: { txHash: id } });
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
    const watchForTxData = publicDataProvider.watchForTxData.bind(publicDataProvider);
    publicDataProvider.watchForTxData = (...args) => bounded(watchForTxData(...args), 180000);
    // Reconcile the interrupted previous run before new submissions.
    if (process.env.SHROUDLY_CUSTODY_RECONCILE_PREVIOUS === '1') {
    const previousPoolModule = await import('../../managed/separated-pool/contract/index.js');
    const previousPool = readContractLedger(previousPoolModule.ledger, (await contracts.getPublicStates(publicDataProvider, 'b7fcb49cd5c0c5bfa8209277eb91e7d7aa8f588186cb11dfe0074fbe8d5541f7')).contractState);
    send({ previousRunReconciliation: { poolReportedCustody: previousPool.reportedCustody.toString(), poolPrizeLiability: previousPool.prizeLiability.toString() } });
    }
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
    const RT = await import('@midnight-ntwrk/compact-runtime');
    const contractCommitment = (coin, address) => {
      const zero = new Uint8Array(32);
      const recipient = { is_left: false, left: { bytes: zero }, right: { bytes: Uint8Array.from(Buffer.from(address, 'hex')) } };
      return Buffer.from(RT.runtimeCoinCommitment({ value: RT.ShieldedCoinInfoDescriptor.toValue(coin), alignment: RT.ShieldedCoinInfoDescriptor.alignment() }, { value: RT.ShieldedCoinRecipientDescriptor.toValue(recipient), alignment: RT.ShieldedCoinRecipientDescriptor.alignment() }).value[0]).toString('hex');
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
    // Contract state as of the transaction's own block, not whatever the indexer reports as latest.
    const stateAt = async (address, blockHeight) => {
      const state = await publicDataProvider.queryContractState(address, { type: 'blockHeight', blockHeight });
      if (!state) throw Error('contract state not indexed');
      return readContractLedger(readLedger, state);
    };
    // The transaction's contract output must commit to the custody coin recorded in that block.
    // A mismatch is re-read once from a fresh query; both public commitments are recorded.
    const commitmentCheck = async (stage, submitted, address, firstEvidence) => {
      let evidence = firstEvidence;
      for (let attempt = 1; ; attempt++) {
        const custody = contractCommitment((await stateAt(address, submitted.blockHeight)).custody, address);
        const outputCommitments = (evidence?.outputs ?? []).map(output => output.commitment);
        const matched = outputCommitments.includes(custody);
        send({ custodyCommitment: { stage, matched, attempt, contractCommitment: custody, outputCommitments } });
        if (matched || attempt === 2) return matched;
        await sleep(10000);
        evidence = await transactionEvidence(submitted.txHash, address);
      }
    };
    const publicOf = (finalized) => ({ txHash: finalized.public.txHash, blockHeight: Number(finalized.public.blockHeight), blockHash: finalized.public.blockHash, status: String(finalized.public.status) });
    const submitCall = (address, circuitId, args = [], target = probe) => withLock(opened, async () => {
      const started = Date.now();
      const result = await contracts.submitCallTx(target.providers, { compiledContract: target.compiledContract, contractAddress: address, circuitId, args, privateStateId: target.tag });
      opened.state = await settledState(opened.wallet);
      return { ...publicOf(result), elapsedMs: Date.now() - started };
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
      const state = readContractLedger(readLedger, states.contractState);
      const reconciliation = reconcileCustody(state);
      const domain = Buffer.alloc(32); domain.write('Shroudly/custody-probe');
      const derivedColor = ledger.rawTokenType(Uint8Array.from(domain), address);
      const custodyColor = Buffer.from(state.custody.color).toString('hex');
      return { reconciliation: { ...reconciliation, reconciled: reconciliation.reconciled && custodyColor === derivedColor }, custodyColor, colorDerivedFromContractAddress: custodyColor === derivedColor, allocatedYield: state.allocatedYield.toString(), seeded: state.seeded };
    };

    const deployContract = (name, target, args = []) => withLock(opened, () => step(name, async () => {
      const started = Date.now();
      const deployed = await contracts.deployContract(target.providers, { compiledContract: target.compiledContract, args, privateStateId: target.tag, initialPrivateState: {} });
      opened.state = await settledState(opened.wallet);
      return { address: String(deployed.deployTxData.public.contractAddress ?? deployed.address), ...publicOf(deployed.deployTxData), elapsedMs: Date.now() - started };
    }));

    const colocated = async () => {
    // 1. Deploy
    const deploy = await deployContract('deploy', probe);
    if (!deploy.ok) return;
    const address = deploy.value.address;
    send({ contract: address });
    const deployEvidence = await step('deploy-indexer', () => transactionEvidence(deploy.value.txHash, address));
    send({ step: { name: 'deploy', txHash: deploy.value.txHash, blockHeight: deploy.value.blockHeight, blockHash: deploy.value.blockHash, status: deploy.value.status, elapsedMs: deploy.value.elapsedMs, txBytes: deployEvidence.value?.txBytes } });

    // 2. Seed (mint + receive shielded reserve to contract)
    const seed = await step('seed', () => submitCall(address, 'seed'));
    if (!seed.ok) return;
    const seedEvidence = await step('seed-indexer', () => transactionEvidence(seed.value.txHash, address));
    send({ step: { name: 'seed', ...seed.value, txBytes: seedEvidence.value?.txBytes, contractOutputs: seedEvidence.value?.outputs.length } });
    if (seedEvidence.value?.outputs.length !== 1) { send({ failure: { step: 'seed-index', category: 'unexpected-contract-output-count' } }); return; }
    const afterSeed = await step('seed-state', () => stateAt(address, seed.value.blockHeight));
    if (!afterSeed.ok) return;
    await step('seed-commitment', () => commitmentCheck('seed', seed.value, address, seedEvidence.value));
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
    if (fresh.ok) {
      await step('withdraw-commitment', () => commitmentCheck('withdraw', withdraw.value, address, withdrawEvidence.value));
      send({ reconciliation: fresh.value });
    }
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
        const assetState = readContractLedger(assetModule.ledger, (await contracts.getPublicStates(fresh, assetAddress)).contractState);
        const poolState = readContractLedger(poolModule.ledger, (await contracts.getPublicStates(fresh, poolAddress)).contractState);
        return reconcileCustody({ custody: { value: assetState.custody.value }, principalLiability: poolState.principalLiability, prizeReserve: poolState.prizeReserve, prizeLiability: poolState.prizeLiability });
      });
      if (view.ok) send({ separatedReconciliation: view.value });
    };

    await colocated();
    await separated();
  } finally {
    if (lockHeld) { try { rmdirSync(LOCK); } catch { /* ignore */ } }
    if (privateDirectory) rmSync(privateDirectory, { recursive: true, force: true });
    const { saveWalletCache } = await import('./wallet-cache.mjs');
    if (!outcomeUnknown) await saveWalletCache(CACHE, opened.wallet, opened.owner).catch(() => {});
    await opened.close().catch(() => {});
  }
}

if (process.argv[2] === '--worker') {
  try { await worker(process.argv[3]); send_done(); } catch (error) { process.send?.({ failure: { step: 'journey', category: failureCategory(error) } }); }
  process.exit();
}
function send_done() { process.send?.({ done: true }); }

if (!process.argv[2]) throw Error('Pass the protected local environment file path');
const started = Date.now();
const evidence = { manifest: evidenceManifest(), format: 'shroudly-custody-network-journey-v1', startedAt: new Date().toISOString(), steps: [], submissions: [], rejections: [], failures: [], releaseQualified: false };
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
      evidence.steps.push(base);
      console.error(JSON.stringify({ step: base.name, status: base.status }));
    } catch { evidence.failures.push({ step: 'evidence-projection', category: 'invalid-step-evidence' }); }
  }
  const submitted = m?.submitted && submissionEvidence(m.submitted.txHash);
  if (submitted) { evidence.submissions.push({ ...submitted, txBytes: num(m.submitted.txBytes) }); console.error(JSON.stringify({ submitted: submitted.transactionId })); }
  if (m?.nodeFinalized) { const submission = evidence.submissions.find(s => s.transactionId === m.nodeFinalized.txHash); if (submission) submission.nodeFinalized = true; }
  if (m?.previousRunReconciliation) evidence.previousRunReconciliation = { poolReportedCustody: str(m.previousRunReconciliation.poolReportedCustody, /^\d{1,30}$/), poolPrizeLiability: str(m.previousRunReconciliation.poolPrizeLiability, /^\d{1,30}$/) };
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
  if (m?.custodyCommitment && ['seed','withdraw'].includes(m.custodyCommitment.stage)) { evidence.custodyCommitments ??= {}; evidence.custodyCommitments[m.custodyCommitment.stage] = m.custodyCommitment.matched === true;
    const hex = (v) => str(v, /^[0-9a-f]{64}$/);
    (evidence.custodyCommitmentReads ??= []).push({ stage: m.custodyCommitment.stage, attempt: num(m.custodyCommitment.attempt), matched: m.custodyCommitment.matched === true, contractCommitment: hex(m.custodyCommitment.contractCommitment), outputCommitments: (Array.isArray(m.custodyCommitment.outputCommitments) ? m.custodyCommitment.outputCommitments : []).slice(0, 4).map(hex) }); }
  if (m?.walletRelease) evidence.walletRelease = { shieldedColorBalances: Object.fromEntries(Object.entries(m.walletRelease.shieldedColorBalances ?? {}).filter(([k, v]) => /^[0-9a-f]{64}$/.test(k) && /^\d{1,30}$/.test(v))) };
  if (m?.failure) { console.error(JSON.stringify({failureStep: str(m.failure.step, /^[a-z-]{1,40}$/), category: ['credential-unavailable','endpoint-invalid','wallet-initialization-failed','wallet-startup-failed','wallet-synchronization-failed','outcome-unknown','runtime-statevalue-mismatch','unexpected-contract-output-count','qualified-coin-unavailable','indexer-query-failed','operation-failed'].includes(m.failure.category) ? m.failure.category : 'operation-failed'})); evidence.failures.push({ step: str(m.failure.step, /^[a-z-]{1,40}$/), category: ['credential-unavailable','endpoint-invalid','wallet-initialization-failed','wallet-startup-failed','wallet-synchronization-failed','outcome-unknown','runtime-statevalue-mismatch','unexpected-contract-output-count','qualified-coin-unavailable','indexer-query-failed','operation-failed'].includes(m.failure.category) ? m.failure.category : 'operation-failed' }); }
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
});
child.on('exit', () => {
  clearTimeout(timer);
  // Remove the lock only if this run still held it when the worker died; never another agent's.
  if (lockState === 'held') { try { rmdirSync(LOCK); } catch { /* already gone */ } }
  evidence.finishedAt = new Date().toISOString();
  evidence.elapsedMs = Date.now() - started;
  evidence.complete = evidence.failures.length === 0
    && ['deploy','seed','allocateYield','withdraw','separated-asset-deploy','separated-asset-seed','separated-pool-deploy','separated-pool-forged-claim','separated-pool-forged-randomness'].every(name => evidence.steps.some(s => s.name === name && s.status === 'SucceedEntirely'))
    && ['forged-draw-mismatch','contributor-binding-mismatch','duplicate-contributor','unauthorized-asset-release','principal-liability-exceeded','repeated-yield-allocation'].every(name => evidence.rejections.some(r => r.name === name && r.rejected && r.reasonMatched))
    && evidence.freshIndexerReconciliation?.reconciled === true
    && evidence.freshIndexerReconciliation?.custodyValue === '1600000'
    && evidence.walletRelease?.shieldedColorBalances?.[evidence.freshIndexerReconciliation?.custodyColor] === '400000'
    && evidence.custodyCommitments?.seed === true && evidence.custodyCommitments?.withdraw === true
    && evidence.steps.some(s => s.name === 'seed' && s.contractOutputs === 1)
    && evidence.steps.some(s => s.name === 'withdraw' && s.contractInputs === 1 && s.contractOutputs === 1)
    && evidence.separatedFreshIndexerView?.reconciled === false
    && evidence.submissions.length === 9 && evidence.submissions.every(s => s.nodeFinalized && Number.isInteger(s.txBytes));
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.complete ? 0 : 1;
});
