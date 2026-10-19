import {mkdirSync, rmdirSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

// One shared DUST-funded wallet: every timing script that submits takes this lock. It is a
// directory (mkdir is atomic) holding an `owner` file with the holder's PID.
export const WALLET_LOCK = '/tmp/shroudly-wallet.lock';

const ownerOf = path => {
  try { const pid = Number(readFileSync(join(path, 'owner'), 'utf8')); return Number.isInteger(pid) && pid > 0 ? pid : null; } catch { return null; }
};
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

// Remove a lock only when its recorded owner is dead. A lock without an owner file (being created,
// or held by an older harness) is waited for. The reclaim marker stops two waiters from both
// removing it, which would let the second delete the first's fresh lock.
function reclaimIfDead(path) {
  const pid = ownerOf(path);
  if (pid === null || alive(pid)) return false;
  const marker = `${path}.reclaim`;
  try { mkdirSync(marker); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try {
    if (ownerOf(path) !== pid) return false;
    rmSync(path, {recursive: true, force: true});
    return true;
  } finally { rmdirSync(marker); }
}

export async function withWalletLock(work, onWait, {path = WALLET_LOCK, pollMs = 2000} = {}) {
  const began = Date.now();
  for (;;) {
    try { mkdirSync(path); writeFileSync(join(path, 'owner'), String(process.pid)); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (reclaimIfDead(path)) continue;
      onWait?.();
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }
  let hold = false;
  try { return await work(Date.now() - began); } catch (error) { hold = error?.holdLock === true; throw error; } finally {
    // A transaction whose outcome is unknown may still spend wallet coins: keep the lock until this
    // process exits, after which the dead owner makes it reclaimable.
    if (!hold && ownerOf(path) === process.pid) rmSync(path, {recursive: true, force: true});
  }
}
