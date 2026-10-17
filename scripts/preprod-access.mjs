#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const profile = JSON.parse(readFileSync(new URL('../midnight/version-profile.json', import.meta.url), 'utf8'));
const candidateProfile = Object.fromEntries(['profile', 'compactCli', 'compactLanguage', 'compactCompiler', 'compactRuntime', 'midnightJs', 'walletSdk', 'dappConnector', 'node', 'indexer', 'proofServer'].map(name => [name, profile[name]]));
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
candidateProfile.ledgerV8 = rootPackage.dependencies['@midnight-ntwrk/ledger-v8'];
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const requestedTimeout = Number(args[args.indexOf('--timeout') + 1]);
const timeout = args.includes('--timeout') && Number.isInteger(requestedTimeout) && requestedTimeout >= 100 && requestedTimeout <= 10000 ? requestedTimeout : 3000;
const names = ['MIDNIGHT_DEPLOYER_SECRET_NAME', 'MIDNIGHT_KEYCHAIN_ACCOUNT', 'MIDNIGHT_PRIVATE_STATE_PASSWORD_NAME', 'MIDNIGHT_PROOF_SERVER_URL', 'MIDNIGHT_INDEXER_HTTP_URL', 'MIDNIGHT_INDEXER_WS_URL', 'MIDNIGHT_RPC_URL', 'VITE_SHROUDLY_DEPLOYMENT_ID', 'VITE_SHROUDLY_RPC_URL', 'VITE_SHROUDLY_INDEXER_URL', 'VITE_SHROUDLY_ZK_CONFIG_URL', 'VITE_SHROUDLY_SPONSOR_URL'];
const variables = Object.fromEntries(names.map(name => [name, Boolean(process.env[name]?.trim())]));
const checks = [{ name: 'wallet-funding', status: 'unverified', detail: 'Requires authorized wallet synchronization and genuine read-only balance validation; no wallet secrets are read.' }];
for (const [name, variable, prefixVariable, fallback] of [
  ['keychain-deployer', 'MIDNIGHT_DEPLOYER_SECRET_NAME', 'MIDNIGHT_WALLET_SERVICE_PREFIX', 'com.shroudly.preprod.wallet.'],
  ['keychain-private-state-password', 'MIDNIGHT_PRIVATE_STATE_PASSWORD_NAME', 'MIDNIGHT_PRIVATE_STATE_SERVICE_PREFIX', 'com.shroudly.preprod.private-state.'],
]) {
  const reference = process.env[variable];
  const account = process.env.MIDNIGHT_KEYCHAIN_ACCOUNT;
  const present = Boolean(reference && account && command('/usr/bin/security', ['find-generic-password', '-a', account, '-s', `${process.env[prefixVariable] || fallback}${reference}`], false).ok);
  checks.push({ name, status: present ? 'pass' : 'blocked', detail: present ? 'Credential metadata found; contents, authorization, validity and funding remain unverified.' : 'Required credential reference or accessible metadata is missing; Operator must provision it privately.' });
}
const browser = inspectBrowser();
checks.push({ name: 'chrome-installed', status: browser.chrome ? 'pass' : 'blocked', detail: browser.chrome ? `Installed Chrome version ${browser.chrome}; observed only, not qualified.` : 'Desktop Chrome metadata was not detected.' });
checks.push({ name: 'lace-installed', status: browser.lace.length ? 'pass' : 'blocked', detail: browser.lace.length ? 'Lace extension manifest detected; account authorization and supported version remain unverified.' : 'Lace extension manifest not detected in standard Chrome profiles; custom profiles require private inspection.' });
checks.push({ name: 'browser-qualification', status: 'unverified', detail: 'Requires an approved exact Chrome/Lace pair and a genuine participant-operated browser lifecycle experiment.' });
checks.push({ name: 'required-configuration', status: Object.values(variables).every(Boolean) ? 'pass' : 'blocked', detail: 'Presence only; values are never printed. Contract IDs and artifact hashes are populated after genuine deployment.' });
if (offline) checks.push({ name: 'github-repository', status: 'unverified', detail: 'Provider metadata checks disabled offline.' });
else {
  const result = command('gh', ['api', 'repos/MrSufferer/shroudly', '--jq', '{pull: .permissions.pull, push: .permissions.push, maintain: .permissions.maintain, admin: .permissions.admin}']);
  let permissions = {};
  try { const parsed = JSON.parse(result.output); permissions = Object.fromEntries(['pull', 'push', 'maintain', 'admin'].map(key => [key, parsed[key] === true])); } catch {}
  checks.push({ name: 'github-repository', status: permissions.push ? 'pass' : 'blocked', detail: permissions.push ? 'Authenticated repository write permission observed; protected environments and Actions authorization require separate review.' : 'Authenticated repository write permission could not be established.', permissions });
}
let linked = false;
try { const project = JSON.parse(readFileSync(new URL('../.vercel/project.json', import.meta.url), 'utf8')); linked = typeof project.projectId === 'string' && typeof project.orgId === 'string'; } catch {}
const vercel = !offline && linked ? command('vercel', ['project', 'inspect', '--format', 'json', '--non-interactive', '--cwd', new URL('..', import.meta.url).pathname]) : null;
let projectAccessible = false;
try { projectAccessible = vercel?.ok && typeof JSON.parse(vercel.output).id === 'string'; } catch {}
checks.push({ name: 'vercel-project', status: projectAccessible ? 'pass' : 'unverified', detail: projectAccessible ? 'Linked project metadata readable; Operator must separately validate Preprod isolation, ownership, deployment and domain/DNS permissions.' : 'Project access not established; Operator must link the separate authorized Preprod project and validate deployment and domain/DNS permissions.' });
checks.push({ name: 'provider-authorization', status: 'unverified', detail: 'Repository access and readable project metadata do not establish environment, deployment, ownership or DNS authorization.' });
checks.push({ name: 'network-versions', status: 'unverified', detail: 'Protocol reachability does not establish the pinned node/indexer versions; genuine compatibility qualification is outstanding.' });
for (const [name, variable, local] of [['indexer-http', 'MIDNIGHT_INDEXER_HTTP_URL', false], ['indexer-ws', 'MIDNIGHT_INDEXER_WS_URL', false], ['rpc', 'MIDNIGHT_RPC_URL', false], ['local-prover', 'MIDNIGHT_PROOF_SERVER_URL', true]]) {
  const url = endpoint(process.env[variable], local, name);
  if (!url) checks.push({ name, status: 'blocked', detail: 'Endpoint missing or unsafe; credentials, query strings and fragments are forbidden; prover must be loopback.' });
  else if (offline) checks.push({ name, status: 'unverified', detail: 'Network probe disabled in offline mode.' });
  else {
    const observation = {};
    try {
      let valid = false;
      if (name === 'indexer-ws') valid = await websocket(url, 'graphql-transport-ws');
      else if (name === 'rpc' && ['ws:', 'wss:'].includes(url.protocol)) valid = await websocket(url);
      else if (name === 'local-prover') {
        const versionUrl = new URL(url);
        versionUrl.pathname = `${versionUrl.pathname.replace(/\/$/, '')}/version`;
        const body = await request(versionUrl, undefined, observation);
        valid = body.length > 0;
        const version = body.trim().replace(/^"|"$/g, '');
        checks.push({ name: 'proof-version', status: version === profile.proofServer ? 'pass' : 'unverified', detail: version === profile.proofServer ? `Observed pinned proof server ${profile.proofServer}.` : 'Response did not establish the exact pinned proof server version.' });
      } else {
        const data = JSON.parse(await request(url, name === 'rpc' ? { jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] } : { query: 'query AccessReadiness { __typename }' }, observation));
        valid = name === 'rpc' ? data.jsonrpc === '2.0' && data.id === 1 && data.result === 'Midnight Preprod' && !data.error : typeof data.data?.__typename === 'string' && /^[A-Za-z_][A-Za-z_0-9]*$/.test(data.data.__typename) && !data.errors;
      }
      checks.push({ name, status: valid ? 'pass' : 'blocked', ...observation, detail: valid ? 'Read-only protocol response validated; this does not establish compatibility or finality.' : 'Response did not validate the expected protocol or Preprod chain.' });
    } catch {
      checks.push({ name, status: 'blocked', ...observation, detail: 'Bounded protocol probe failed; check service availability and current endpoint documentation privately.' });
    }
  }
}
if (!checks.some(check => check.name === 'proof-version')) checks.push({ name: 'proof-version', status: 'unverified', detail: 'Exact local proof server version was not observed.' });
const report = { format: 'shroudly-preprod-access-v1', checkedAt: new Date().toISOString(), candidateProfile, browser, variables, checks, accessReady: false, qualification: 'outstanding', recovery: 'See docs/operations/preprod-access.md; Operator owns credential, funding, browser, prover and provider authorization blockers.' };
// Native WebSocket has no force-close API. A peer may ignore the close frame;
// after every intended probe has finished, flush the complete report and exit
// rather than letting that peer retain this one-shot CLI process indefinitely.
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(1));

function endpoint(value, local, name) {
  try {
    const url = new URL(value);
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (local && !loopback)) return null;
    if (!['https:', 'wss:', ...(loopback ? ['http:', 'ws:'] : [])].includes(url.protocol)) return null;
    if (['indexer-http', 'local-prover'].includes(name) && !['https:', 'http:'].includes(url.protocol)) return null;
    if (name === 'indexer-ws' && !['wss:', 'ws:'].includes(url.protocol)) return null;
    return url;
  } catch { return null; }
}

function command(executable, argv, capture = true) {
  const result = spawnSync(executable, argv, { timeout, maxBuffer: 16384, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
  return { ok: result.status === 0 && !result.error, output: result.status === 0 ? result.stdout || '' : '' };
}

function version(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value) ? value : null; }
function inspectBrowser() {
  let chrome = null;
  for (const path of ['/Applications/Google Chrome.app/Contents/Info.plist', join(homedir(), 'Applications/Google Chrome.app/Contents/Info.plist')]) {
    const result = command('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path]);
    chrome = version(result.output.trim());
    if (chrome) break;
  }
  const lace = new Set();
  const base = join(homedir(), 'Library/Application Support/Google/Chrome');
  try {
    for (const profileName of readdirSync(base).filter(name => name === 'Default' || /^Profile \d+$/.test(name))) {
      const extensions = join(base, profileName, 'Extensions');
      let ids = []; try { ids = readdirSync(extensions); } catch { continue; }
      for (const id of ids.filter(name => /^[a-p]{32}$/.test(name))) {
        const directory = join(extensions, id);
        for (const installed of readdirSync(directory)) {
          try {
            const manifest = JSON.parse(readFileSync(join(directory, installed, 'manifest.json'), 'utf8'));
            if (typeof manifest.name === 'string' && /\b(?:midnight )?lace\b/i.test(manifest.name) && version(manifest.version)) lace.add(manifest.version);
          } catch { /* No browser account or extension storage is read. */ }
        }
      }
    }
  } catch { /* Standard Chrome profiles may be absent. */ }
  return { chrome, lace: [...lace].sort(), supportedPair: 'unqualified' };
}

async function request(url, body, observation) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json, text/plain', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  observation.httpStatus = response.status;
  if (!response.ok) { await response.body?.cancel(); throw new Error('http'); }
  const reader = response.body.getReader();
  let content = ''; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return content;
      bytes += value.byteLength;
      if (bytes > 16384) throw new Error('size');
      content += new TextDecoder().decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function websocket(url, protocol) {
  return new Promise((resolve, reject) => {
    const socket = protocol ? new WebSocket(url, protocol) : new WebSocket(url);
    const timer = setTimeout(() => finish(false), timeout);
    let finished = false;
    function finish(ok) { if (finished) return; finished = true; clearTimeout(timer); socket.close(); resolve(ok); }
    socket.addEventListener('open', () => {
      if (protocol && socket.protocol !== protocol) return finish(false);
      socket.send(JSON.stringify(protocol ? { type: 'connection_init' } : { jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }));
    });
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || event.data.length > 16384) return finish(false);
      try { const data = JSON.parse(event.data); finish(protocol ? data.type === 'connection_ack' : data.jsonrpc === '2.0' && data.id === 1 && data.result === 'Midnight Preprod' && !data.error); }
      catch { finish(false); }
    });
    socket.addEventListener('error', () => finish(false));
    socket.addEventListener('close', () => finish(false));
  });
}
