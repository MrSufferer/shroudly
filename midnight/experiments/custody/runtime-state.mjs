// SDK public states wrap the generated ledger input in ContractState.data.
export const readContractLedger = (readLedger, contractState) => readLedger(contractState.data);
