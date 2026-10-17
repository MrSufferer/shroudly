import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/witness-availability/contract/index.js';
import { pathToFileURL } from 'node:url';
const coin = '0'.repeat(64);
export async function probe({prove = false} = {}) {
  const weights = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
  const openings = weights.map((_, i) => new Uint8Array(32).fill(i + 1));
  let available = false;
  const witness = values => ({privateState}) => {
    if (!available) throw Error('private opening unavailable to offline caller');
    return [privateState, values];
  };
  const contract = new Contract({weights: witness(weights), openings: witness(openings)});
  const initial = contract.initialState(RT.createConstructorContext({}, coin));
  let state = initial.currentContractState.data;
  const context = () => RT.createCircuitContext(RT.sampleContractAddress(), coin, state, {});
  const registrationMs = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    const call = contract.impureCircuits.register(context(), BigInt(i), pureCircuits.weightCommitment(weights[i], openings[i]));
    state = call.context.currentQueryContext.state;
    registrationMs.push(Number((performance.now() - start).toFixed(2)));
  }
  let offlineFailure;
  try {contract.impureCircuits.select(context(), 35n);} catch (error) {offlineFailure = error.message;}
  // Positive control deliberately violates the accepted trust requirement.
  available = true;
  const start = performance.now();
  const control = contract.impureCircuits.select(context(), 35n);
  const report = {releaseQualified: false, capacity: 8, controlWinner: Number(ledger(control.context.currentQueryContext.state).winner),
    offlineFailure, controlUsesAllParticipantOpenings: true, registrationMs,
    selectionMs: Number((performance.now() - start).toFixed(2)),
    publicTranscriptOperations: control.proofData.publicTranscript.length,
    privateWitnessOutputs: control.proofData.privateTranscriptOutputs.length,
    proofsGenerated: 0};
  if (prove) {
    const {proofDataIntoSerializedPreimage} = await import('@midnight-ntwrk/ledger-v8');
    const {httpClientProvingProvider} = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
    const {NodeZkConfigProvider} = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');
    const provider = httpClientProvingProvider('http://127.0.0.1:6300', new NodeZkConfigProvider(new URL('../../managed/witness-availability', import.meta.url).pathname), {timeout: 60000});
    const {input,output,publicTranscript,privateTranscriptOutputs} = control.proofData;
    const preimage = proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTranscriptOutputs, 'select');
    const proofStart = performance.now();
    try {
      report.proofCheck = await provider.check(preimage, 'select');
      const proof = await provider.prove(preimage, 'select');
      report.proofsGenerated = 1;
      report.proofBytes = proof.length;
      report.proofMs = Math.round(performance.now() - proofStart);
    } catch (error) {report.proofError = error.message;}
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await probe({prove: process.argv.includes('--prove')}), (_,v) => typeof v === 'bigint' ? String(v) : v, 2));
}
