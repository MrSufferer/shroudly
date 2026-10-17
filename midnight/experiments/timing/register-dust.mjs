import {fileURLToPath} from 'node:url';
import {emit, runIsolated} from './isolated.mjs';

// One-time prerequisite: the protected wallet holds NIGHT but generates no DUST
// until its NIGHT UTxO is registered. This registers only unregistered UTxOs,
// under the shared wallet lock, re-checking state after the lock is taken.
if (process.argv[2] === '--worker') {
  const {openStagedWallet, errorClass} = await import('./wallet.mjs');
  const {withWalletLock} = await import('./network-session.mjs');
  let opened;
  try {
    opened = await openStagedWallet(process.argv[3]);
    const {wallet, keystore} = opened;
    await withWalletLock(async lockWaitMs => {
      const state = await wallet.waitForSyncedState();
      const unregistered = state.unshielded.availableCoins.filter(coin => !coin.meta.registeredForDustGeneration);
      emit({stage: 'locked', lockWaitMs, unregisteredNightUtxos: unregistered.length, dustPositive: state.dust.balance(new Date()) > 0n});
      if (unregistered.length === 0) return;
      const estimate = await wallet.estimateRegistration(unregistered);
      emit({stage: 'estimated', fee: estimate.fee.toString()});
      const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), payload => keystore.signData(payload));
      const finalized = await wallet.finalizeRecipe(recipe);
      const started = Date.now();
      const id = await wallet.submitTransaction(finalized);
      emit({stage: 'submitted', submitMs: Date.now() - started, identifierLength: String(id).length});
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const now = await wallet.waitForSyncedState();
        if (now.dust.balance(new Date()) > 0n || now.unshielded.availableCoins.some(coin => coin.meta.registeredForDustGeneration)) {
          emit({stage: 'registered', afterMs: Date.now() - started, dustPositive: now.dust.balance(new Date()) > 0n});
          return;
        }
      }
      emit({stage: 'registration-unobserved'});
    }, () => emit({stage: 'waiting-for-wallet-lock'}));
    emit({done: true});
  } catch (error) { emit({done: false, error: errorClass(error)}); }
  finally { await opened?.close().catch(() => {}); process.exit(); }
} else {
  const {code, tainted} = await runIsolated(fileURLToPath(import.meta.url), [process.argv[2]], 3600000, record => { if (record.stage !== 'sync-progress') console.log(JSON.stringify(record)); });
  process.exitCode = code || tainted ? 1 : 0;
}
