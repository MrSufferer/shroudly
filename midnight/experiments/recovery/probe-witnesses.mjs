// Witness implementations for RecoveryProbe. Private state is the complete
// witness material: the participant secret and the private round.
export const initialPrivateState = (secret) => ({ secret: Uint8Array.from(secret), round: 0n });

export const witnesses = {
  secretKey: ({ privateState }) => [privateState, privateState.secret],
  privateRound: ({ privateState }) => [privateState, privateState.round],
  advanceLocal: ({ privateState }) => {
    const round = privateState.round + 1n;
    return [{ ...privateState, round }, round];
  },
};
