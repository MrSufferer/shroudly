import test from 'node:test';
import assert from 'node:assert/strict';
import { Intent, Transaction } from '@midnight-ntwrk/ledger-v8';
import { submissionEvidence } from './submission-evidence.mjs';

test('submission evidence retains the real ledger identifier without truncating to an indexer hash', () => {
  const tx = Transaction.fromParts('preprod', undefined, undefined, Intent.new(new Date(Date.now() + 60000)));
  const transactionId = tx.identifiers()[0];
  assert.equal(transactionId.length, 66);
  assert.deepEqual(submissionEvidence(transactionId), { transactionId, nodeFinalized: false });
  assert.equal(submissionEvidence('https://example.invalid/private'), undefined);
});
