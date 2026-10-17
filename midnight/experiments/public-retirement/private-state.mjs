import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';

// ADR 0029 stand-in for encrypted IndexedDB plus a Web Lock: an AES-GCM file with a write-ahead
// intent and an exclusive lock file. A crash releases the lock (as a browser lock is released on
// tab death) but leaves the intent, which blocks new actions until reconciled from public state.
const encode = value => JSON.stringify(value, (_, v) =>
  typeof v === 'bigint' ? {$big: String(v)} : v instanceof Uint8Array ? {$bytes: Buffer.from(v).toString('hex')} : v);
const decode = text => JSON.parse(text, (_, v) =>
  v && v.$big !== undefined ? BigInt(v.$big) : v && v.$bytes !== undefined ? new Uint8Array(Buffer.from(v.$bytes, 'hex')) : v);

export function openPrivateState(path, {key, create}) {
  let lock;
  try { lock = openSync(`${path}.lock`, 'wx'); }
  catch { throw Error('another writer holds this private state'); }
  const write = record => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(encode(record)), cipher.final()]);
    const fd = openSync(`${path}.tmp`, 'w');
    writeSync(fd, Buffer.concat([iv, cipher.getAuthTag(), body]));
    fsyncSync(fd);
    closeSync(fd);
    renameSync(`${path}.tmp`, path);
  };
  const read = () => {
    const data = readFileSync(path);
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return decode(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  };
  let record = existsSync(path) ? read() : {wallet: create, intent: null};
  if (!existsSync(path)) write(record);
  let crashed = false;
  const wallet = record.wallet;
  Object.defineProperty(wallet, 'store', {enumerable: false, value: {
    begin(intent) {
      if (record.intent) throw Error('unreconciled action: reconcile before writing');
      record.intent = {...intent, balanceBefore: wallet.balance, noteBefore: wallet.note};
      write(record);
    },
    commit() {
      if (crashed) return;
      record.intent = null;
      write(record);
    },
  }});
  return {
    wallet,
    crashBeforeNextCommit() { crashed = true; },
    release() { closeSync(lock); unlinkSync(`${path}.lock`); },
    // Decides from public ledger state whether the journalled action landed.
    reconcile(pool) {
      const intent = record.intent;
      if (!intent) return 'clean';
      const after = intent.circuit === 'withdraw' ? intent.balanceBefore - intent.amount
        : intent.circuit === 'enroll' ? intent.amount : intent.balanceBefore + intent.amount;
      const live = pool.liveNoteOf(wallet);
      const notes = pool.ledger().notes;
      const opens = (bal, note) => notes.member(note) &&
        Buffer.from(notes.lookup(note)).equals(Buffer.from(pool.noteCommitment(bal, note, wallet.secret)));
      let outcome;
      if (live !== undefined && live !== intent.noteBefore && opens(after, live)) outcome = 'applied';
      else if (after === 0n && live === undefined && intent.noteBefore !== undefined) outcome = 'applied';
      else if (live === intent.noteBefore && (live === undefined || opens(intent.balanceBefore, live))) outcome = 'not-applied';
      else throw Error('current private state cannot be established; new actions stay blocked');
      if (outcome === 'applied') {
        wallet.balance = after;
        wallet.note = live;
        if (live !== undefined) wallet.openings[live] = after;
      }
      record.intent = null;
      write(record);
      return outcome;
    },
  };
}
