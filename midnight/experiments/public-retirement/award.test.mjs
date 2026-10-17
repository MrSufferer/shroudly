import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, TMIX } from './pool.mjs';
import { awardProbability, measureAward } from './award.mjs';

const START = 1_800_000_000;

test('the contract awards exactly when u is below the sampled note weight', () => {
  const run = u => {
    const pool = createPool({start: START});
    const wallets = [1, 2, 3, 4, 5].map(n => pool.participant(n));
    pool.at(START + 5);
    for (const w of wallets) pool.enroll(w, 3n * TMIX);
    pool.at(START + 901);
    pool.close({slot: 2n, u});
    return () => pool.claim(wallets[2], 0n);
  };
  // Created at the end of bucket 0, live to the interval end: 3 tMIX x 840 s.
  const w = 3n * TMIX * 840n;
  assert.doesNotThrow(run(w - 1n));
  assert.throws(run(w), /rejected: prize rolls over/);
});

test('award probability for the program scenarios', () => {
  const {typical, skewed, allAtCap, churn} = measureAward();
  // Five steady 1 tMIX identities: 5 x 9e8 / (5 x 9e11).
  assert.equal(typical.probability, 0.001);
  assert.equal(Math.round(typical.expectedDraws), 1000);
  assert.equal(typical.expectedWaitDays.toFixed(1), '10.4');
  // One capped whale and four 1 tMIX identities: (9e11 + 4 x 9e8) / (5 x 9e11).
  assert.equal(skewed.probability, 0.2008);
  assert.equal(allAtCap.probability, 1);
  // A mid-interval top-up adds a slot for interval 1: 4 x 9e8 + 1e6 x 60 + 2e6 x 780 over 6 slots.
  assert.equal(churn.during.n, 6n);
  assert.equal(churn.during.total, 5_220_000_000n);
  // Compaction removes the retired slot before interval 2: 4 x 9e8 + 2e6 x 900 over 5 slots.
  assert.equal(churn.after.n, 5n);
  assert.equal(churn.after.probability, 0.0012);
});

test('a draw below the Disclosure Cohort has no award probability', () => {
  const pool = createPool({start: START});
  const wallets = [1, 2, 3, 4].map(n => pool.participant(n));
  pool.at(START + 5);
  for (const w of wallets) pool.enroll(w, 1000n * TMIX);
  pool.at(START + 901);
  pool.close({slot: 0n, u: 0n});
  assert.equal(awardProbability(pool, wallets, 0n).probability, 0);
});
