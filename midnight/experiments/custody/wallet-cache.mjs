import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Serialized wallet sync state (no seed or secret key; keys are supplied at start) kept in a
// private directory outside the repository. Optimization only: delete it to resync from genesis.
const ROLES = ['shielded', 'unshielded', 'dust'];

// `owner` is a public-key fingerprint. A cache without one predates fingerprints and is accepted.
export function readWalletCache(directory, owner) {
  if (!directory || !ROLES.every((role) => existsSync(join(directory, `${role}.json`)))) return undefined;
  const ownerFile = join(directory, 'owner');
  if (owner && existsSync(ownerFile) && readFileSync(ownerFile, 'utf8') !== owner) throw Error('wallet cache belongs to another wallet');
  return Object.fromEntries(ROLES.map((role) => [role, readFileSync(join(directory, `${role}.json`), 'utf8')]));
}

// Saves to one directory run one at a time (a periodic save may still be in flight when the
// final save starts), and every role is serialized before any file is replaced.
const pending = new Map();
export function saveWalletCache(directory, wallet, owner) {
  const run = (pending.get(directory) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const states = await Promise.all(ROLES.map((role) => wallet[role].serializeState()));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    ROLES.forEach((role, index) => {
      const file = join(directory, `${role}.json`);
      writeFileSync(`${file}.tmp`, states[index], { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    });
    if (owner) writeFileSync(join(directory, 'owner'), owner, { mode: 0o600 });
  });
  pending.set(directory, run);
  return run;
}
