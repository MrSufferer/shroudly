import {fork} from 'node:child_process';

// SDKs and dependencies may log URLs or errors. Network workers run with stdout
// and stderr discarded; only explicit emit() records cross the IPC boundary, and
// the parent prints those only after a conservative secret-shape check. 64-hex
// values (block and transaction hashes) are accepted solely under keys named
// like hashes, so a stray seed-shaped value in any other field is suppressed.
export const emit = record => process.send?.(record);

const SECRET_SHAPES = [/project_id/i, /https?:\/\/[^\s"']*[@?]/i, /wss?:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{20,}/i, /blockfrost/i, /bearer\s/i, /(mnemonic|seed)/i];
const HASH_KEY = /(^|[a-z])hash(es)?$/i;

export function suspicious(value, key = '') {
  if (typeof value === 'string') {
    if (SECRET_SHAPES.some(shape => shape.test(value))) return true;
    return /[0-9a-f]{64}/i.test(value) && !(HASH_KEY.test(key) && /^(0x)?[0-9a-f]{64}$/i.test(value));
  }
  if (Array.isArray(value)) return value.some(item => suspicious(item, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => suspicious(v, k));
  return false;
}

export function runIsolated(workerUrl, args, timeoutMs, onRecord) {
  return new Promise(resolve => {
    const child = fork(workerUrl, ['--worker', ...args], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    let tainted = false;
    child.on('message', record => {
      if (suspicious(record)) { tainted = true; console.log(JSON.stringify({category: 'suppressed-secret-shaped-record'})); child.kill('SIGKILL'); return; }
      onRecord(record);
    });
    child.on('exit', code => { clearTimeout(timer); resolve({code, tainted}); });
  });
}
