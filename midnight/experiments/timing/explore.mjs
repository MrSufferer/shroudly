import {openProvider} from './provider.mjs';

const provider = await openProvider(process.argv[2]);
const safe = async (label, run) => {
  try { console.log(label, JSON.stringify(await run())); } catch (error) { console.log(label, 'failed', error.constructor.name, /^(rpc|graphql|provider)/.test(error.message) ? error.message : 'category-hidden'); }
};
try {
  await safe('chain', async () => (await provider.rpc('system_chain')).result);
  await safe('finalized', async () => (await provider.rpc('chain_getFinalizedHead')).result);
  await safe('bestHeader', async () => { const h = (await provider.rpc('chain_getHeader')).result; return {number: h.number}; });
  await safe('indexerBlock', async () => (await provider.graphql('{ block { height hash timestamp } }')).data);
} finally { await provider.close(); }
