import test from 'node:test';
import assert from 'node:assert/strict';
import {errorDetail} from './wallet.mjs';
import {suspicious} from './isolated.mjs';

test('error detail names the failure chain without URLs, long hex or credentials', () => {
  const root = Error('connect refused https://user:pw@rpc.example/?project_id=abc');
  const middle = Object.assign(new TypeError(`bad seed=${'cd'.repeat(32)} token=xyz`), {cause: root});
  const top = Object.assign(Error('Transaction submission failed'), {cause: middle});
  const detail = errorDetail(top);
  assert.match(detail, /^Error: Transaction submission failed <- TypeError: .* <- Error: connect refused <url>$/);
  assert.doesNotMatch(detail, /cdcdcdcd|xyz|user:pw|abc/);
  assert.equal(suspicious({detail}), false);
});

test('error detail follows an Effect fiber failure into the failed error and its cause', async () => {
  // The Effect copy the Midnight SDK itself uses (not a direct dependency).
  const {createRequire} = await import('node:module');
  const {fileURLToPath} = await import('node:url');
  const compactJs = new URL('../../../node_modules/.pnpm/@midnight-ntwrk+compact-js@2.5.1/node_modules/@midnight-ntwrk/compact-js/package.json', import.meta.url);
  const {Effect, Runtime} = createRequire(fileURLToPath(compactJs))('effect');
  const node = Error('1010: Invalid Transaction: Custom error: 170');
  const submission = Object.assign(Error('Transaction submission error'), {cause: node});
  let fiberFailure;
  try { Effect.runSync(Effect.fail(submission)); } catch (error) { fiberFailure = error; }
  assert.ok(Runtime.isFiberFailure(fiberFailure));
  assert.match(errorDetail(fiberFailure), /Custom error: 170/);
});

test('error detail stops after four causes and truncates long messages', () => {
  let error = Error('x'.repeat(500));
  for (let i = 0; i < 6; i++) error = Object.assign(Error(`level ${i}`), {cause: error});
  const detail = errorDetail(error);
  assert.equal(detail.split(' <- ').length, 4);
  assert.ok(errorDetail(Error('x'.repeat(500))).length < 260);
});
