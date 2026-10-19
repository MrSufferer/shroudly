import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {walletCache} from './wallet.mjs';

// A genesis sync takes hours and has corrupted the shared wallet's DUST view; a missing cache is an
// operator error, never a reason to sync from scratch.
test('the wallet cache must be named explicitly', () => {
  assert.throws(() => walletCache({}), /SHROUDLY_TIMING_WALLET_CACHE is not set/);
  assert.throws(() => walletCache({SHROUDLY_TIMING_WALLET_CACHE: ''}), /SHROUDLY_TIMING_WALLET_CACHE is not set/);
});

test('every wallet cache file must exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-cache-'));
  assert.throws(() => walletCache({SHROUDLY_TIMING_WALLET_CACHE: join(dir, 'absent')}), /missing shielded, unshielded, dust/);
  writeFileSync(join(dir, 'shielded.json'), '{}');
  writeFileSync(join(dir, 'unshielded.json'), '{}');
  assert.throws(() => walletCache({SHROUDLY_TIMING_WALLET_CACHE: dir}), /missing dust/);
  writeFileSync(join(dir, 'dust.json'), '{}');
  assert.equal(walletCache({SHROUDLY_TIMING_WALLET_CACHE: dir}), dir);
});
