import * as RT from '@midnight-ntwrk/compact-runtime';

// Searches every public byte of each call (public transcript, circuit input and output, resulting
// ledger state) for the runtime encoding of private values. Private transcript outputs are excluded:
// they never leave the prover. Reports names and counts only, never the values themselves.
const U64 = new RT.CompactTypeUnsignedInteger(18446744073709551615n, 8);
const hex = value => typeof value === 'bigint'
  ? Buffer.from(U64.toValue(value)[0]).toString('hex') // little-endian, trailing zero bytes trimmed
  : Buffer.from(value).toString('hex');

function publicBlobs(call) {
  const blobs = [];
  const walk = value => {
    if (value instanceof Uint8Array) blobs.push(Buffer.from(value).toString('hex'));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  const {input, output, publicTranscript} = call.proofData;
  walk([input, output, publicTranscript]);
  for (const [, cell] of call.context.currentQueryContext.state.toString().matchAll(/\[([0-9a-f]+)\]/g)) blobs.push(cell);
  return blobs;
}

const occurs = (blobs, needle) => blobs.some(blob => {
  for (let i = blob.indexOf(needle); i >= 0; i = blob.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
});

export function auditDisclosure(calls, secrets, controls) {
  const blobs = calls.flatMap(publicBlobs);
  return {
    blobsSearched: blobs.length,
    leaked: Object.entries(secrets).filter(([, value]) => occurs(blobs, hex(value))).map(([name]) => name),
    controlsFound: Object.entries(controls).filter(([, value]) => occurs(blobs, hex(value))).map(([name]) => name),
  };
}
