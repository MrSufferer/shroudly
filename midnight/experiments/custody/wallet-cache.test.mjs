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
