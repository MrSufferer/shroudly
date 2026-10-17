import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, TMIX } from './pool.mjs';
import { openPrivateState } from './private-state.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START = 1_800_000_000;

test('eight credentials enroll and a repeated credential is rejected', () => {
  const pool = createPool({start: START});
  pool.at(START + 5);
  const wallets = Array.from({length: 8}, (_, i) => pool.participant(i + 1));
  for (const wallet of wallets) pool.enroll(wallet, 10n * TMIX);
  assert.equal(pool.ledger().slotCount, 8n);
  assert.throws(() => pool.enroll(pool.participant(1), TMIX), /identity already has a live note/);
});

test('the identity cap covers total balance across successor notes and stale private state is rejected', () => {
  const pool = createPool({start: START});
  pool.at(START + 5);
  const alice = pool.participant(1);
  pool.enroll(alice, 600n * TMIX);
  const stale = structuredClone(alice);
  pool.at(START + 70);
  pool.contribute(alice, 400n * TMIX);
  assert.throws(() => pool.contribute(alice, TMIX), /contribution bound exceeded/);
  pool.withdraw(alice, 1_500_000n);
  assert.throws(() => pool.contribute(alice, 500_000n), /contribution below 1 tMIX/);
  pool.contribute(alice, TMIX);
  assert.equal(alice.balance, 999_500_000n);
  assert.throws(() => pool.withdraw(stale, TMIX), /stale private state/);
});

const INTERVAL = 900;

test('weight carries forward without check-ins, survives full exit, and stops at public retirement', () => {
  // Weight mechanics with two wallets: the Disclosure Cohort is lowered here and tested on its own.
  const pool = createPool({start: START, cohort: 1n});
  pool.at(START + 5);
  const alice = pool.participant(1);
  const bob = pool.participant(2);
  pool.enroll(alice, 100n * TMIX);
  pool.enroll(bob, TMIX);
  const aliceNote = alice.note;

  // Interval 0 counts from the end of the creation bucket: 840 s.
  pool.at(START + INTERVAL + 1);
  pool.close({slot: pool.slotOf(bob.note), u: 840_000_000n});
  assert.throws(() => pool.claim(bob, 0n), /rejected: prize rolls over/);

  // Interval 1: nobody acts, full weight 100 tMIX x 900 s.
  pool.at(START + 2 * INTERVAL + 1);
  pool.close({slot: pool.slotOf(aliceNote), u: 89_999_999_999n});
  pool.claim(alice, 1n);
  assert.throws(() => pool.claim(alice, 1n), /prize already claimed/);

  // Alice fully exits 300 s into interval 2, then claims interval 2 afterwards.
  pool.at(START + 2 * INTERVAL + 300);
  pool.withdraw(alice, 100n * TMIX);
  pool.at(START + 3 * INTERVAL + 1);
  pool.close({slot: pool.slotOf(aliceNote), u: 29_999_999_999n});
  pool.claim(alice, 2n);

  // Interval 3: the retired note is compacted by anyone and can no longer be sampled.
  pool.at(START + 4 * INTERVAL + 1);
  assert.throws(() => pool.close({slot: 0n, u: 0n}), /compact retired notes first/);
  pool.compact();
  assert.equal(pool.ledger().slotCount, 1n);
  pool.close({slot: 0n, u: 0n});
  assert.equal(pool.ledger().drawNote.lookup(3n), bob.note);
  assert.throws(() => pool.claim(alice, 3n), /not the sampled note owner/);
});

test('withdrawal succeeds over an unresolved backlog and catch-up work per transaction stays constant', () => {
  const pool = createPool({start: START});
  pool.at(START + 5);
  const wallets = Array.from({length: 6}, (_, i) => pool.participant(i + 1));
  for (const wallet of wallets) pool.enroll(wallet, 50n * TMIX);
  const [alice] = wallets;
  const aliceNote = alice.note;

  // Ten intervals pass with nobody closing draws; Principal is still free to leave.
  pool.at(START + 10 * INTERVAL + 90);
  pool.withdraw(alice, 50n * TMIX);
  assert.equal(pool.ledger().nextDraw, 0n);
  assert.throws(() => pool.compact(), /still weighted in an unresolved interval/);

  pool.at(START + 11 * INTERVAL + 1);
  const operations = [];
  for (let j = 0n; j <= 10n; j++) {
    operations.push(pool.close({slot: pool.slotOf(aliceNote), u: 0n}).proofData.publicTranscript.length);
  }
  assert.equal(new Set(operations).size, 1);
  // Each late draw still gets a full claim window from its own closing transaction.
  pool.at(START + 11 * INTERVAL + 3000);
  pool.claim(alice, 0n);
  pool.claim(alice, 10n);
  pool.compact();
  assert.equal(pool.ledger().slotCount, 5n);
});

test('private state is durable, single-writer, and reconciles a crash between submit and persist', () => {
  const pool = createPool({start: START});
  const path = join(mkdtempSync(join(tmpdir(), 'shroudly-22-')), 'participant.state');
  const key = new Uint8Array(32).fill(7);
  const writer = openPrivateState(path, {key, create: pool.participant(1)});
  assert.throws(() => openPrivateState(path, {key}), /another writer holds this private state/);

  pool.at(START + 5);
  pool.enroll(writer.wallet, 20n * TMIX);
  assert.equal(readFileSync(path).includes(Buffer.from(writer.wallet.secret)), false);

  // Crash: the transaction lands but the process dies before persisting the new balance.
  writer.crashBeforeNextCommit();
  pool.at(START + 70);
  pool.contribute(writer.wallet, 5n * TMIX);
  writer.release();

  const recovered = openPrivateState(path, {key});
  assert.throws(() => pool.withdraw(recovered.wallet, TMIX), /unreconciled action/);
  assert.equal(recovered.reconcile(pool), 'applied');
  assert.equal(recovered.wallet.balance, 25n * TMIX);
  pool.withdraw(recovered.wallet, TMIX);
  recovered.release();
  assert.equal(openPrivateState(path, {key}).wallet.balance, 24n * TMIX);
});

test('a draw selects only at the five-identity Disclosure Cohort; below it the Prize rolls over', () => {
  const pool = createPool({start: START});
  const wallets = Array.from({length: 5}, (_, i) => pool.participant(i + 1));
  pool.at(START + 5);
  for (const w of wallets.slice(0, 4)) pool.enroll(w, TMIX);
  pool.at(START + INTERVAL + 1);
  pool.close({slot: 0n, u: 0n});
  assert.equal(pool.ledger().drawCohort.lookup(0n), 4n);
  assert.throws(() => pool.claim(wallets[0], 0n), /below Disclosure Cohort/);
  pool.enroll(wallets[4], TMIX);
  pool.at(START + 2 * INTERVAL + 1);
  pool.close({slot: 0n, u: 0n});
  assert.equal(pool.ledger().drawCohort.lookup(1n), 5n);
  pool.claim(wallets[0], 1n);
});
