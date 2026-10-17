import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROOF_SERVER, proveAgainstWrongKey, proveScenario } from './prove.mjs';

const START = 1_800_000_000;
const serverVersion = await fetch(`${PROOF_SERVER}/version`).then(r => r.text(), () => undefined);
// Real proofs only: without proof server 8.1.0 these tests are skipped, never mocked.
const live = {skip: serverVersion === '8.1.0' ? false : `proof server 8.1.0 unavailable (${serverVersion})`, timeout: 900_000};

test('every circuit proves on proof server 8.1.0 into a well-formed transaction within block limits', live, async () => {
  const {measured, tamperedProof} = await proveScenario({start: START});
  assert.deepEqual(measured.map(m => [m.circuit, m.wellFormed]), [
    ['enroll', 'accepted'], ['contribute', 'accepted'], ['withdraw', 'accepted'],
    ['closeDraw', 'accepted'], ['claim', 'accepted'], ['compactRetired', 'accepted']]);
  for (const m of measured) assert.ok(m.withinBlockLimits && m.proofBytes > 0 && m.proveMs > 0);
  // Pinned finding, not a pass condition: ledger-v8 8.1.0 wellFormed does not check contract
  // proofs, so "well-formed" here is not proof verification. If this starts failing, the ledger
  // began verifying proofs locally and the report's verification gate can be revisited.
  assert.equal(tamperedProof, 'accepted');
});

test('ledger-v8 8.1.0 wellFormed accepts a proof checked against the wrong circuit key (pinned finding)', live, async () => {
  assert.equal(await proveAgainstWrongKey({start: START}), 'accepted');
});
