import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPool } from './pool.mjs';
import { auditDisclosure } from './disclosure.mjs';

const START = 1_800_000_000;
// Distinctive values so a 4-byte encoding cannot plausibly collide with hashes or public counters.
const ENROLL = 123_456_789n;
const CONTRIBUTION = 7_654_321n;
const WITHDRAWAL = 3_141_593n;

test('only lineage is public: balances, amounts, weights and secrets never reach public bytes', () => {
  // One wallet keeps the audited values distinctive; the cohort is lowered so the draw path runs.
  const pool = createPool({start: START, cohort: 1n});
  const alice = {secret: new Uint8Array(createHash('sha256').update('audit').digest()), balance: 0n, openings: {}};
  const calls = [];
  pool.at(START + 5);
  calls.push(pool.enroll(alice, ENROLL));
  pool.at(START + 901);
  calls.push(pool.close({slot: pool.slotOf(alice.note), u: 0n}));
  calls.push(pool.claim(alice, 0n));
  pool.at(START + 905);
  calls.push(pool.contribute(alice, CONTRIBUTION));
  pool.at(START + 1000);
  calls.push(pool.withdraw(alice, WITHDRAWAL));

  const report = auditDisclosure(calls, {
    secret: alice.secret,
    enrolled: ENROLL,
    contribution: CONTRIBUTION,
    withdrawal: WITHDRAWAL,
    balanceAfterContribution: 130_111_110n,
    balanceAfterWithdrawal: 126_969_517n,
    // Interval 0: created at the end of bucket 0, retired at the start of bucket 15; 123456789 x 840.
    claimedWeight: 103_703_702_760n,
  }, {
    // Positive controls: these are public by design, so the search must find them.
    t0: BigInt(START),
    identityTag: pool.identityTag(alice.secret),
    firstNoteCommitment: pool.ledger().notes.lookup(0n),
  });

  assert.deepEqual(report.leaked, []);
  assert.deepEqual(report.controlsFound, ['t0', 'identityTag', 'firstNoteCommitment']);
  assert.ok(report.blobsSearched > 50);
});
