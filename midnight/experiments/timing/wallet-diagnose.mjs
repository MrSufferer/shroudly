import {fileURLToPath} from 'node:url';
import {emit, runIsolated} from './isolated.mjs';

if (process.argv[2] === '--worker') {
  const {openStagedWallet, errorClass} = await import('./wallet.mjs');
  let opened;
  try {
    opened = await openStagedWallet(process.argv[3]);
    const night = Object.values(opened.state.unshielded.balances).some(value => value > 0n);
    const coins = opened.state.unshielded.availableCoins ?? [];
    const dustState = opened.state.dust;
    emit({done: true, nightFunded: night, dustFunded: dustState.balance(new Date()) > 0n,
      nightUtxos: coins.length, nightUtxosRegisteredForDust: coins.filter(coin => coin.meta?.registeredForDustGeneration).length,
      pendingNightUtxos: (opened.state.unshielded.pendingCoins ?? []).length,
      dustCoins: (dustState.totalCoins ?? []).length, availableDustCoins: (dustState.availableCoins ?? []).length, pendingDustCoins: (dustState.pendingCoins ?? []).length});
  } catch (error) { emit({done: false, error: errorClass(error)}); }
  finally { await opened?.close().catch(() => {}); process.exit(); }
} else {
  const {code, tainted} = await runIsolated(fileURLToPath(import.meta.url), [process.argv[2]], 10000000, record => console.log(JSON.stringify(record)));
  process.exitCode = code || tainted ? 1 : 0;
}
