import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/prize-pool/contract/index.js';
import { pathToFileURL } from 'node:url';

// Synthetic test-only credentials. Never read a wallet or participant private state.
const bytes = n => new Uint8Array(32).fill(n);
const COIN = '0'.repeat(64);
export async function qualify() {
  const started = performance.now();
  let secret = bytes(10);
  let salt = bytes(20);
  let nonce = 1;
  let amount = 1000000n;
  const witnesses = Object.fromEntries([
    'deployer_secret', 'governance_one_secret', 'governance_two_secret', 'governance_three_secret',
  ].map((name, i) => [name, ({privateState}) => [privateState, bytes(i + 1)]]));
  Object.assign(witnesses, {
    participant_secret: ({privateState}) => [privateState, secret],
    participant_salt: ({privateState}) => [privateState, salt],
    participant_coin: ({privateState}) => [privateState, {nonce: bytes(nonce++), color: bytes(5), value: amount}],
    participant_public_key: ({privateState}) => [privateState, {bytes: bytes(6)}],
    participant_spendable_coin: ({privateState}) => [privateState, {nonce: bytes(99), color: bytes(5), value: 1000000000n, mt_index: 0n}],
    reserve_coin: () => {throw Error('No invented reserve coin');},
    selection_bits: () => {throw Error('Selection bits not supplied before eligibility exists');},
  });
  const contract = new Contract(witnesses);
  const init = contract.initialState(RT.createConstructorContext({}, COIN), bytes(4), bytes(5), bytes(6), bytes(7));
  const context = () => RT.createCircuitContext(RT.sampleContractAddress(), COIN, init.currentContractState, {});
  const failures = [];
  let admitted = 0;
  for (let i = 0; i < 8; i++) {
    secret = bytes(10 + i);
    salt = bytes(20 + i);
    const owner = pureCircuits.ownerCommitment(secret, salt);
    try { contract.impureCircuits.contribute(context(), owner, 1000000n, 1n); admitted++; }
    catch (error) { failures.push(error.message); }
  }
  // This is deliberately not a ledger accessor: unexported Compact ledger is
  // still consensus/public data, visible in the raw generated constructor state.
  const publicState = init.currentContractState.toString();
  // Explicit invalid-genesis fixture, solely to isolate deeper baseline faults.
  // Seed the three public account maps that the constructor leaves empty.
  // Paths [1][5..7] are compiler-layout specific; this is NOT deployed state.
  const keyType = new RT.CompactTypeBytes(32);
  const valueType = new RT.CompactTypeUnsignedInteger(18446744073709551615n, 8);
  const aligned = (type, value) => ({value: type.toValue(value), alignment: type.alignment()});
  const outer = init.currentContractState.data.state.asArray();
  const accounts = outer[1].asArray();
  for (const index of [5, 6, 7]) {
    let map = new RT.StateMap();
    for (let i = 0; i < 8; i++) {
      const owner = pureCircuits.ownerCommitment(bytes(10 + i), bytes(20 + i));
      map = map.insert(aligned(keyType, owner), RT.StateValue.newCell(aligned(valueType, 0n)));
    }
    accounts[index] = RT.StateValue.newMap(map);
  }
  const array = values => values.reduce((result, value) => result.arrayPush(value), RT.StateValue.newArray());
  outer[1] = array(accounts);
  const seeded = array(outer);
  let fixtureState = seeded;
  const fixtureContext = () => RT.createCircuitContext(RT.sampleContractAddress(), COIN, fixtureState, {});
  let seededAdmitted = 0;
  let sixthFailure;
  for (let i = 0; i < 8; i++) {
    secret = bytes(10 + i); salt = bytes(20 + i);
    try {
      const call = contract.impureCircuits.contribute(fixtureContext(), pureCircuits.ownerCommitment(secret, salt), amount, 1n);
      fixtureState = call.context.currentQueryContext.state;
      seededAdmitted++;
    } catch (error) {sixthFailure ??= error.message;}
  }
  // Split-note capacity is already broken for the SAME owner, before salt rotation.
  fixtureState = seeded; secret = bytes(10); salt = bytes(20); amount = 1000000000n;
  let repeatedNoteCall;
  for (let i = 0; i < 2; i++) {
    const call = contract.impureCircuits.contribute(fixtureContext(), pureCircuits.ownerCommitment(secret, salt), amount, 1n);
    fixtureState = call.context.currentQueryContext.state;
    repeatedNoteCall = call;
  }
  const publicBalanceMap = fixtureState.state.asArray()[1].asArray()[5].asMap();
  const rawBalance = valueType.fromValue(publicBalanceMap.get(aligned(keyType, pureCircuits.ownerCommitment(secret,salt))).asCell().value);
  const serializedPublicTranscript = JSON.stringify(repeatedNoteCall.proofData.publicTranscript, (_, value) =>
    value instanceof Uint8Array ? Buffer.from(value).toString('hex') : typeof value === 'bigint' ? String(value) : value);
  const amountEncoding = Buffer.from(valueType.toValue(amount)[0]).toString('hex');
  const ownerEncoding = Buffer.from(pureCircuits.ownerCommitment(secret, salt)).toString('hex');
  const transcriptAudit = {amountEncodingObserved: serializedPublicTranscript.includes(amountEncoding),
    ownerEncodingObserved: serializedPublicTranscript.includes(ownerEncoding),
    operations: repeatedNoteCall.proofData.publicTranscript.length};
  let withdrawal;
  try {
    const call = contract.impureCircuits.withdraw(fixtureContext(), 1n, 10000n);
    withdrawal = {runtimeAccepted: true, unresolvedDrawId: String(ledger(call.context.currentQueryContext.state).drawId)};
  } catch (error) {withdrawal = {runtimeAccepted: false, error: error.message};}
  return {
    seededFixture: {notReachableFromConstructor: true, admitted: seededAdmitted, sixthFailure, sameIdentityBalance: String(rawBalance), sameNoteReplayAccepted: true, transcriptAudit, withdrawal},
    releaseQualified: false,
    evidence: {kind: 'generated-compact-runtime', proofsGenerated: 0, networkTransactions: 0},
    capacity: {attempted: 8, admitted, failures},
    ledger: {exportedParticipantCount: String(ledger(init.currentContractState.data).participantCount),
      rawStateBytes: Buffer.byteLength(publicState), unexportedFieldsArePublic: true},
    elapsedMs: Math.round(performance.now() - started),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await qualify(), null, 2));
}
