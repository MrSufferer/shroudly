// Pure evidence helpers: no network, no credentials. Output is an explicit allowlist.
export function reconcileCustody(state) {
  const custody = BigInt(state.custody.value);
  const principal = BigInt(state.principalLiability);
  const reserve = BigInt(state.prizeReserve);
  const prize = BigInt(state.prizeLiability);
  const total = principal + reserve + prize;
  return {
    custodyValue: custody.toString(),
    principalLiability: principal.toString(),
    prizeReserve: reserve.toString(),
    prizeLiability: prize.toString(),
    liabilitiesTotal: total.toString(),
    reconciled: custody === total,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const STATUS = /^[A-Za-z]{1,40}$/;
export function sanitizeStep(step) {
  const out = { name: step.name };
  if (!NAME.test(String(step.name))) throw Error('invalid evidence name');
  for (const key of ['txHash', 'blockHash']) {
    if (step[key] !== undefined) {
      if (!HEX64.test(String(step[key]))) throw Error(`invalid evidence ${key}`);
      out[key] = step[key];
    }
  }
  for (const key of ['blockHeight', 'elapsedMs', 'proofBytes']) {
    if (step[key] !== undefined) {
      if (!Number.isSafeInteger(Number(step[key])) || Number(step[key]) < 0) throw Error(`invalid evidence ${key}`);
      out[key] = Number(step[key]);
    }
  }
  if (step.status !== undefined) {
    if (!STATUS.test(String(step.status))) throw Error('invalid evidence status');
    out.status = step.status;
  }
  return out;
}
