import { createPool, TMIX } from './pool.mjs';

// The highest weight one note can hold: the 1000 tMIX identity cap for a whole 900 s interval.
export const W_MAX = 900n * 1000n * TMIX;
const INTERVAL = 900n;
const NEVER = 2n ** 64n - 1n;
const DRAWS_PER_DAY = 96;

// Award probability of draw j, read right after it closes: P = sum_k w_k / (n * W_max), with u
// uniform below W_max and n the slots at close. Lineage is public; balances come from the owners'
// private openings, so only the experiment, holding every wallet, can compute it.
export function awardProbability(pool, wallets, j) {
  const l = pool.ledger();
  const n = l.drawSize.lookup(j);
  const s = l.t0 + INTERVAL * j;
  const weights = [];
  for (let k = 0n; k < n; k++) {
    const idx = l.slots.lookup(k);
    const owner = wallets.find(w => w.openings[idx] !== undefined);
    const from = l.createdAt.lookup(idx) > s ? l.createdAt.lookup(idx) : s;
    const tr = l.retiredAt.member(idx) ? l.retiredAt.lookup(idx) : NEVER;
    const to = tr < s + INTERVAL ? tr : s + INTERVAL;
    weights.push(owner.openings[idx] * (to > from ? to - from : 0n));
  }
  const total = weights.reduce((a, b) => a + b, 0n);
  const probability = n === 0n ? 0 : Number(total) / Number(n * W_MAX);
  return {n, weights, total, probability,
    expectedDraws: probability && 1 / probability,
    expectedWaitDays: probability && 1 / probability / DRAWS_PER_DAY};
}

const START = 1_800_000_000;
const pool5 = balances => {
  const pool = createPool({start: START});
  const wallets = balances.map((_, i) => pool.participant(i + 1));
  pool.at(START + 5);
  wallets.forEach((w, i) => pool.enroll(w, balances[i]));
  pool.at(START + 901);
  pool.close({slot: 0n, u: 0n});
  return {pool, wallets};
};
// Steady state: every note was live through the whole of interval 1.
const steady = balances => {
  const {pool, wallets} = pool5(balances);
  pool.at(START + 1801);
  pool.close({slot: 0n, u: 0n});
  return awardProbability(pool, wallets, 1n);
};

// The program scenarios the report records. Each draw's slot and u are fixed; only P is measured.
export function measureAward() {
  const churn = () => {
    const {pool, wallets} = pool5(Array(5).fill(TMIX));
    pool.at(START + 1000);
    pool.contribute(wallets[0], TMIX); // retires a note mid-interval and creates its successor
    pool.at(START + 1801);
    pool.close({slot: 0n, u: 0n});
    const during = awardProbability(pool, wallets, 1n);
    pool.compact();
    pool.at(START + 2701);
    pool.close({slot: 0n, u: 0n});
    return {during, after: awardProbability(pool, wallets, 2n)};
  };
  return {
    typical: steady(Array(5).fill(TMIX)),
    skewed: steady([1000n * TMIX, ...Array(4).fill(TMIX)]),
    allAtCap: steady(Array(5).fill(1000n * TMIX)),
    churn: churn(),
  };
}
