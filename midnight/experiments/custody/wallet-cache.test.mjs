import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWalletCache, saveWalletCache } from './wallet-cache.mjs';

const fakeWallet = { shielded: { serializeState: async () => 'S' }, unshielded: { serializeState: async () => 'U' }, dust: { serializeState: async () => 'D' } };

test('a partial wallet cache is ignored so the wallet resyncs every role together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'custody-cache-test-'));
  try {
    assert.equal(readWalletCache(join(directory, 'absent')), undefined);
    writeFileSync(join(directory, 'shielded.json'), 'S');
    writeFileSync(join(directory, 'dust.json'), 'D');
    assert.equal(readWalletCache(directory), undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('saved wallet state round-trips through an owner-only directory', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'custody-cache-test-'));
  const directory = join(parent, 'cache');
  try {
    await saveWalletCache(directory, fakeWallet);
    assert.deepEqual(readWalletCache(directory), { shielded: 'S', unshielded: 'U', dust: 'D' });
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, 'dust.json')).mode & 0o777, 0o600);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('overlapping saves are serialized so every role file comes from one snapshot', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'custody-cache-test-'));
  const directory = join(parent, 'cache');
  let snapshot = 0;
  const slowWallet = Object.fromEntries(['shielded', 'unshielded', 'dust'].map(role => [role, { serializeState: async () => { const value = `${role}-${snapshot}`; await new Promise(r => setTimeout(r, 5)); return value; } }]));
  try {
    const first = saveWalletCache(directory, slowWallet);
    snapshot = 1;
    await Promise.all([first, saveWalletCache(directory, slowWallet)]);
    assert.deepEqual(readWalletCache(directory), { shielded: 'shielded-1', unshielded: 'unshielded-1', dust: 'dust-1' });
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('a cache saved by another wallet is refused rather than restored', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'custody-cache-test-'));
  const directory = join(parent, 'cache');
  try {
    await saveWalletCache(directory, fakeWallet, 'owner-a');
    assert.deepEqual(readWalletCache(directory, 'owner-a'), { shielded: 'S', unshielded: 'U', dust: 'D' });
    assert.throws(() => readWalletCache(directory, 'owner-b'), /another wallet/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
