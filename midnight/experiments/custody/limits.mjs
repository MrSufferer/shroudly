// Checks every deployed circuit against the Preprod limits from #22: circuit k (from the local
// proof server's /k), verifier key bytes, and the finalized transaction bytes in the journey result.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
export const PREPROD_LIMITS = { transactionBytes: 786_432, k: 25, verifierKeyBytes: 50_000 };
const PROOF_SERVER = 'http://127.0.0.1:6300';
const managed = (name, directory) => new URL(`../../managed/${name}/${directory}/`, import.meta.url);

export async function measureLimits(journey) {
  const circuits = {};
  for (const name of ['custody-probe', 'separated-asset', 'separated-pool']) {
    for (const file of readdirSync(managed(name, 'zkir')).filter(f => f.endsWith('.bzkir')).sort()) {
      const circuit = file.slice(0, -'.bzkir'.length);
      const k = Number(await fetch(`${PROOF_SERVER}/k`, { method: 'POST', body: readFileSync(new URL(file, managed(name, 'zkir'))) }).then(r => r.text()));
      const verifierKeyBytes = readFileSync(new URL(`${circuit}.verifier`, managed(name, 'keys'))).length;
      circuits[`${name}/${circuit}`] = { k, verifierKeyBytes };
    }
  }
  const transactions = Object.fromEntries(journey.steps.filter(s => Number.isInteger(s.txBytes)).map(s => [s.name, s.txBytes]));
  const proofServer = await fetch(`${PROOF_SERVER}/version`).then(r => r.text());
  const withinLimits = Object.values(circuits).every(c => Number.isInteger(c.k) && c.k <= PREPROD_LIMITS.k && c.verifierKeyBytes <= PREPROD_LIMITS.verifierKeyBytes)
    && Object.values(transactions).every(bytes => bytes <= PREPROD_LIMITS.transactionBytes);
  return { limits: PREPROD_LIMITS, proofServer, journeyStartedAt: journey.startedAt, circuits, transactions, withinLimits };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const journey = JSON.parse(readFileSync(new URL('network-journey-result.json', import.meta.url), 'utf8'));
  const result = await measureLimits(journey);
  writeFileSync(new URL('limits-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.withinLimits ? 0 : 1;
}
