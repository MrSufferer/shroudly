import {createHash} from 'node:crypto';

// Public, synthetic probe secrets so offline replay can reproduce network results.
// The probe holds no assets and these values grant no authority over anything real.
export const secretFor = name => new Uint8Array(createHash('sha256').update(`shroudly-timing-synthetic/${name}`).digest());
export const ownerSecret = () => secretFor('owner');
export const slotSecret = slot => secretFor(`slot${slot}`);
