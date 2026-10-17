import test from 'node:test';
import assert from 'node:assert/strict';
import {suspicious} from './isolated.mjs';

const hash = 'ab'.repeat(32);

test('public hashes pass only under hash-named keys and secret shapes never pass', () => {
  assert.equal(suspicious({txHash: hash, blockHash: `0x${hash}`}), false);
  assert.equal(suspicious({note: hash}), true);
  assert.equal(suspicious({txHash: `${hash}00`}), true);
  assert.equal(suspicious({error: 'fetch failed https://user:pw@host'}), true);
  assert.equal(suspicious({url: 'https://midnight-preprod.blockfrost.io/api/v0?x=1'}), true);
  assert.equal(suspicious({project_id: 'x'}), false);
  assert.equal(suspicious({value: 'project_id=abc'}), true);
  assert.equal(suspicious({seed: hash}), true);
  assert.equal(suspicious({outcome: 'SucceedEntirely', blockHeight: 12, nested: [{blockHash: hash}]}), false);
});
