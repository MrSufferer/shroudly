import {fileURLToPath} from 'node:url';
import {emit, runIsolated} from './isolated.mjs';

if (process.argv[2] === '--worker') {
  const {openStagedWallet, errorClass} = await import('./wallet.mjs');
  let opened;
  try {
    opened = await openStagedWallet(process.argv[3]);
    const night = Object.values(opened.state.unshielded.balances).some(value => value > 0n);
    emit({done: true, nightFunded: night, dustFunded: opened.state.dust.balance(new Date()) > 0n});
  } catch (error) { emit({done: false, error: errorClass(error)}); }
  finally { await opened?.close().catch(() => {}); process.exit(); }
} else {
  const {code, tainted} = await runIsolated(fileURLToPath(import.meta.url), [process.argv[2]], 10000000, record => console.log(JSON.stringify(record)));
  process.exitCode = code || tainted ? 1 : 0;
}
