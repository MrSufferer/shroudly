import * as L from '@midnight-ntwrk/ledger-v8';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { readFileSync } from 'node:fs';
import { createPool, TMIX } from './pool.mjs';

export const PROOF_SERVER = 'http://127.0.0.1:6300';
const NETWORK = 'undeployed';
export const MANAGED = new URL('../../managed/public-retirement', import.meta.url).pathname;
export const CIRCUITS = ['enroll', 'contribute', 'withdraw', 'closeDraw', 'compactRetired', 'claim'];
export const verifierKey = circuit => readFileSync(`${MANAGED}/keys/${circuit}.verifier`);

const strictness = () => {
  const s = new L.WellFormedStrictness();
  s.verifyContractProofs = true;
  s.verifyNativeProofs = true;
  s.enforceLimits = true;
  // No wallet in this experiment: fees are measured, not paid, and nothing is signed.
  s.enforceBalancing = false;
  s.verifySignatures = false;
  return s;
};

// Same conversion compact-js uses: runtime query context -> ledger query context.
const ledgerQueryContext = (before, after) => {
  const context = new L.QueryContext(new L.ChargedState(L.StateValue.decode(before.state.state.encode())), before.address);
  context.block = before.block;
  context.effects = before.effects;
  return Array.from(after.comIndices).reduce((qc, entry) => qc.insertCommitment(...entry), context);
};

// Deploys the contract with verifier keys into a blank ledger and proves calls against it on the
// proof server. wellFormed checks transcript, structure and limits; the negative controls show
// whether it also checks contract proofs (in ledger-v8 8.1.0 JS it does not).
export async function openProver({start, verifierKeyOf = verifierKey}) {
  const state = L.ContractState.deserialize(createPool({start}).initialContractState().serialize());
  for (const circuit of CIRCUITS) {
    const op = new L.ContractOperation();
    op.verifierKey = verifierKeyOf(circuit);
    state.setOperation(circuit, op);
  }
  const deploy = new L.ContractDeploy(state);
  const address = deploy.address;
  const tblock = new Date(start * 1000);
  const deployTx = L.Transaction.fromParts(NETWORK, undefined, undefined, L.Intent.new(new Date(tblock.getTime() + 3_600_000)).addDeploy(deploy)).eraseProofs();
  const block = {secondsSinceEpoch: BigInt(start), secondsSinceEpochErr: 30, parentBlockHash: '0'.repeat(64), lastBlockTime: BigInt(start)};
  const blank = L.LedgerState.blank(NETWORK);
  const [genesis, deployResult] = blank.apply(deployTx.wellFormed(blank, strictness(), tblock), new L.TransactionContext(blank, block));
  if (deployResult.type !== 'success') throw Error(`deploy failed: ${deployResult.error}`);
  const http = httpClientProvingProvider(PROOF_SERVER, new NodeZkConfigProvider(MANAGED), {timeout: 600_000});
  let proofs = [];
  const provider = {check: (...a) => http.check(...a), prove: async (...a) => { const p = await http.prove(...a); proofs.push(p); return p; }};
  const params = L.LedgerParameters.initialParameters();
  const referenceLedger = before =>
    genesis.updateIndex(address, new L.ChargedState(L.StateValue.decode(before.state.state.encode())), new Map());
  const wellFormed = (tx, {before, now}) => {
    try { tx.wellFormed(referenceLedger(before), strictness(), now); return 'accepted'; }
    catch (error) { return String(error.message ?? error); }
  };
  let last;

  return {
    address,
    // Proves one circuit call on the proof server, then measures the proven transaction.
    async prove(circuit, result) {
      const {input, output, publicTranscript, privateTranscriptOutputs} = result.proofData;
      const now = new Date(Number(result.before.block.secondsSinceEpoch) * 1000);
      const call = new L.PrePartitionContractCall(address, circuit, genesis.index(address).operation(circuit),
        new L.PreTranscript(ledgerQueryContext(result.before, result.context.currentQueryContext), publicTranscript),
        privateTranscriptOutputs, input, output, L.communicationCommitmentRandomness(), circuit);
      const unproven = L.Transaction.fromParts(NETWORK).addCalls({tag: 'random'}, [call], params, new Date(now.getTime() + 3_600_000));
      proofs = [];
      const started = performance.now();
      const tx = (await unproven.prove(provider, params.transactionCostModel.runtimeCostModel ?? L.CostModel.initialCostModel())).bind();
      const proveMs = Math.round(performance.now() - started);
      let withinBlockLimits = true;
      try { params.normalizeFullness(tx.cost(params)); } catch { withinBlockLimits = false; }
      last = {tx, before: result.before, now, proof: proofs[0]};
      return {circuit, wellFormed: wellFormed(tx, last), proveMs, proofBytes: proofs[0].length,
        transactionBytes: tx.serialize().length, feesSpecks: String(tx.fees(params)), withinBlockLimits};
    },
    // Negative control: the last proven transaction with one byte inside its proof body flipped.
    // Returns 'accepted' or the rejection message.
    tamperLastProof() {
      const raw = last.tx.serialize();
      // The provider's return value carries a serialization header, so match a chunk from the proof body.
      const middle = last.proof.length >> 1;
      const at = Buffer.from(raw).indexOf(Buffer.from(last.proof.subarray(middle, middle + 64)));
      if (at < 0) throw Error('proof body not found in the serialized transaction');
      raw[at] ^= 0x01;
      const tampered = L.Transaction.deserialize('signature', 'proof', 'binding', raw);
      if (!Buffer.from(tampered.serialize()).equals(Buffer.from(raw))) throw Error('tampered proof did not survive deserialization');
      return wellFormed(tampered, last);
    },
  };
}

// Exercises every circuit once on real proofs: enroll, top-up, full exit with historic weight,
// draw, claim by the exited owner, then compaction of the retired notes.
export async function proveScenario({start}) {
  const prover = await openProver({start});
  const pool = createPool({start, address: prover.address});
  const alice = pool.participant(1);
  // Five more identities stay live, so the draw meets the Disclosure Cohort after alice exits.
  const others = [2, 3, 4, 5, 6].map(n => pool.participant(n));
  const measured = [];
  const run = async (circuit, call) => measured.push(await prover.prove(circuit, call()));
  pool.at(start + 5);
  await run('enroll', () => pool.enroll(alice, 100n * TMIX));
  for (const wallet of others) pool.enroll(wallet, TMIX);
  pool.at(start + 70);
  await run('contribute', () => pool.contribute(alice, TMIX));
  const sampled = alice.note; // weighted 101 tMIX x 240 s in interval 0
  pool.at(start + 400);
  await run('withdraw', () => pool.withdraw(alice, 101n * TMIX));
  pool.at(start + 901);
  await run('closeDraw', () => pool.close({slot: pool.slotOf(sampled), u: 0n}));
  await run('claim', () => pool.claim(alice, 0n));
  pool.at(start + 1801);
  await run('compactRetired', () => pool.compact());
  return {measured, tamperedProof: prover.tamperLastProof()};
}

// Negative control: an enroll proof checked against a deployment holding withdraw's verifier key.
export async function proveAgainstWrongKey({start}) {
  const prover = await openProver({start, verifierKeyOf: c => verifierKey(c === 'enroll' ? 'withdraw' : c)});
  const pool = createPool({start, address: prover.address});
  pool.at(start + 5);
  return (await prover.prove('enroll', pool.enroll(pool.participant(1), TMIX))).wellFormed;
}
