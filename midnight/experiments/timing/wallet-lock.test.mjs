import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {withWalletLock} from './wallet-lock.mjs';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'wallet-lock-')), 'lock');
const heldBy = (path, pid) => { mkdirSync(path); if (pid !== undefined) writeFileSync(join(path, 'owner'), String(pid)); };
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('the lock records its owner PID while held and is removed on release', async () => {
  const path = fresh();
  const seen = await withWalletLock(async () => readFileSync(join(path, 'owner'), 'utf8'), undefined, {path, pollMs: 5});
  assert.equal(seen, String(process.pid));
  assert.equal(existsSync(path), false);
});

test('a lock whose owner PID is dead is reclaimed', async () => {
  const path = fresh();
  heldBy(path, deadPid());
  let waits = 0;
  assert.equal(await withWalletLock(async () => 'ran', () => waits++, {path, pollMs: 5}), 'ran');
  assert.equal(waits, 0);
});

for (const [name, owner] of [['a live owner PID', 'live'], ['no owner file', undefined]]) {
  test(`a lock with ${name} is waited for, never reclaimed`, async () => {
    const path = fresh();
    const child = owner === 'live' ? spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']) : null;
    heldBy(path, child?.pid);
    let waits = 0, ran = false;
    const acquired = withWalletLock(async () => { ran = true; }, () => waits++, {path, pollMs: 5});
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(ran, false);
    assert.ok(waits > 1);
    rmSync(path, {recursive: true});
    await acquired;
    assert.equal(ran, true);
    child?.kill();
  });
}

test('work that fails with holdLock leaves the lock in place', async () => {
  const path = fresh();
  await assert.rejects(withWalletLock(async () => { throw Object.assign(Error('finality unresolved'), {holdLock: true}); }, undefined, {path, pollMs: 5}), /finality unresolved/);
  assert.equal(readFileSync(join(path, 'owner'), 'utf8'), String(process.pid));
  await assert.rejects(withWalletLock(async () => { throw Error('ordinary'); }, undefined, {path: fresh(), pollMs: 5}), /ordinary/);
});
