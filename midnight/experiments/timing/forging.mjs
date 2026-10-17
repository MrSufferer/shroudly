// The only place a browser/caller clock can enter a Midnight call: the block time
// of the local evaluation that precedes proving. When control.forgedSeconds is
// set, every time-gated entry point (including provableCircuits, which
// midnight-js-contracts actually invokes) evaluates at that forged time, exactly
// as a dishonest client clock would. The network never sees this value directly.
const GATED = ['commit', 'reveal', 'finalize', 'pause', 'resume', 'claim'];

export function forgingContract(Base, control) {
  return class ForgingContract extends Base {
    constructor(witnesses) {
      super(witnesses);
      for (const table of [this.circuits, this.impureCircuits, this.provableCircuits]) {
        if (!table) continue;
        for (const [name, circuit] of Object.entries(table)) {
          if (!GATED.includes(name)) continue;
          table[name] = (context, ...args) => {
            if (control.forgedSeconds !== undefined) {
              context.currentQueryContext.block = {...context.currentQueryContext.block, secondsSinceEpoch: BigInt(control.forgedSeconds)};
            }
            return circuit(context, ...args);
          };
        }
      }
    }
  };
}
