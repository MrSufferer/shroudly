import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Serialized wallet sync state (no seed or secret key; keys are supplied at start) kept in a
// private directory outside the repository. Optimization only: delete it to resync from genesis.
const ROLES = ['shielded', 'unshielded', 'dust'];

export function readWalletCache(directory) {
  if (!directory || !ROLES.every((role) => existsSync(join(directory, `${role}.json`)))) return undefined;
  return Object.fromEntries(ROLES.map((role) => [role, readFileSync(join(directory, `${role}.json`), 'utf8')]));
}

export async function saveWalletCache(directory, wallet) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  for (const role of ROLES) {
    const file = join(directory, `${role}.json`);
    writeFileSync(`${file}.tmp`, await wallet[role].serializeState(), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
}
