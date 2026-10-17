import {pureCircuits} from '../../managed/timing-probe/contract/index.js';

// The generated contract is the only source of these constants; tests and
// measurement scripts read them back from its pure circuits.
export const SCHEDULE = Object.freeze({
  INTERVAL: Number(pureCircuits.intervalSeconds()),
  COMMIT_CUTOFF: Number(pureCircuits.commitCutoffSeconds()),
  REVEAL: Number(pureCircuits.revealSeconds()),
  CLAIM: Number(pureCircuits.claimSeconds()),
  BUCKET: Number(pureCircuits.bucketSeconds()),
  FINALITY_ALLOWANCE: Number(pureCircuits.finalityAllowanceSeconds()),
  MAX_PAUSE: Number(pureCircuits.maxPauseSeconds()),
});
