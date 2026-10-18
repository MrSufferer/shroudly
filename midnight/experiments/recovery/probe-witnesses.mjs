// Witness implementations for RecoveryProbe. Private state is the complete
// witness material: the participant secret and the private round.
export const initialPrivateState = (secret) => ({ secret: Uint8Array.from(secret), round: 0n });

// compact-runtime accepts Bytes<32> only as a 32-byte typed array. Hand it a
// fresh, exact Uint8Array, whatever the in-memory holder is (Node Buffer, etc.).
const secretBytes = (secret) => {
  const bytes = Uint8Array.from(secret ?? []);
  if (bytes.length !== 32) throw Error('private state secret is not 32 bytes');
  return bytes;
};

export const witnesses = {
  secretKey: ({ privateState }) => [privateState, secretBytes(privateState.secret)],
  privateRound: ({ privateState }) => [privateState, privateState.round],
  advanceLocal: ({ privateState }) => {
    const round = privateState.round + 1n;
    return [{ ...privateState, round }, round];
  },
};
