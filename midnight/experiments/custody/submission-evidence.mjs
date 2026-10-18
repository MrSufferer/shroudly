// Ledger transaction identifiers are distinct from the indexer's transaction hash.
export const submissionEvidence = transactionId => typeof transactionId === 'string' && /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(transactionId)
  ? { transactionId, nodeFinalized: false }
  : undefined;
