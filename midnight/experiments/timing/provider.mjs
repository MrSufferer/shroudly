import {protectedConfiguration} from '../custody/protected-wallet.mjs';
import {providerProxy} from '../custody/provider-proxy.mjs';

// Authenticated routes exist only as ephemeral loopback capabilities. Nothing
// here prints URLs, tokens or provider error text; callers get public chain data.
export function clientFor(proxy) {
  const post = async (url, body) => {
    const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw Error(`provider status ${response.status}`);
    return {json: await response.json(), date: response.headers.get('date')};
  };
  let id = 0;
  return {
    rpc: async (method, params = []) => {
      const {json, date} = await post(proxy.rpc.replace(/^ws/, 'http'), {jsonrpc: '2.0', id: ++id, method, params});
      if (json.error) throw Error('rpc error');
      return {result: json.result, date};
    },
    graphql: async (query, variables) => {
      const {json, date} = await post(proxy.http, {query, variables});
      if (json.errors) throw Error('graphql error');
      return {data: json.data, date};
    },
  };
}

export async function openProvider(path) {
  const {token, endpoints, seed} = protectedConfiguration(path);
  seed.fill(0);
  const proxy = await providerProxy({...endpoints, token});
  return {proxy, ...clientFor(proxy), close: () => proxy.close()};
}
