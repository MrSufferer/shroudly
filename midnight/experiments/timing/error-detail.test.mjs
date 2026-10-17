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

test('error detail stops after four causes and truncates long messages', () => {
  let error = Error('x'.repeat(500));
  for (let i = 0; i < 6; i++) error = Object.assign(Error(`level ${i}`), {cause: error});
  const detail = errorDetail(error);
  assert.equal(detail.split(' <- ').length, 4);
  assert.ok(errorDetail(Error('x'.repeat(500))).length < 260);
});
