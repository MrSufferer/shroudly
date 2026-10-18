import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('./preprod-access.mjs', import.meta.url);
function run(args = [], env = {}) {
  const result = spawnSync(process.execPath, [cli.pathname, ...args], {
    env: { PATH: process.env.PATH, HOME: '/nonexistent', ...env }, encoding: 'utf8',
  });
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}
test('offline inspection reports missing human evidence and never qualifies the candidate', () => {
  const result = run(['--offline']);
  assert.equal(result.status, 1);
  assert.equal(result.report.format, 'shroudly-preprod-access-v1');
  assert.equal(result.report.accessReady, false);
  assert.equal(result.report.qualification, 'outstanding');
  assert.equal(result.report.checks.find(c => c.name === 'wallet-funding').status, 'unverified');
  assert.equal(result.report.variables.MIDNIGHT_DEPLOYER_SECRET_NAME, false);
  assert.equal(result.report.checks.find(c => c.name === 'keychain-deployer').status, 'blocked');
  assert.equal(result.report.checks.find(c => c.name === 'browser-qualification').status, 'unverified');
  assert.equal(result.report.candidateProfile.ledgerV8, '8.1.0');
});
test('official Blockfrost endpoints require private authorization before network probing', () => {
  const result = run([], {
    MIDNIGHT_INDEXER_HTTP_URL: 'https://midnight-preprod.blockfrost.io/api/v0',
    MIDNIGHT_INDEXER_WS_URL: 'wss://midnight-preprod.blockfrost.io/api/v0/ws',
    MIDNIGHT_RPC_URL: 'https://rpc.midnight-preprod.blockfrost.io',
  });
  for (const name of ['indexer-http', 'indexer-ws', 'rpc']) {
    const check = result.report.checks.find(c => c.name === name);
    assert.equal(check.status, 'blocked');
    assert.match(check.detail, /authorization/);
    assert.equal(check.httpStatus, undefined);
  }
  assert.equal(result.report.checks.find(c => c.name === 'blockfrost-authorization').status, 'blocked');
});
test('rejects credential forwarding to unapproved hosts, paths or user-supplied auth queries', () => {
  for (const target of ['https://midnight-preprod.blockfrost.io.attacker.invalid/api/v0', 'https://midnight-preprod.blockfrost.io/api/v0/other', 'https://midnight-preprod.blockfrost.io/api/v0?project_id=NEVER-PRINT']) {
    const result = run([], { MIDNIGHT_BLOCKFROST_SECRET_NAME: 'NONEXISTENT-TEST-REFERENCE', MIDNIGHT_KEYCHAIN_ACCOUNT: 'NONEXISTENT-TEST-ACCOUNT', MIDNIGHT_INDEXER_HTTP_URL: target });
    const check = result.report.checks.find(c => c.name === 'indexer-http');
    assert.equal(check.status, 'blocked');
    assert.match(check.detail, /unsafe/);
    assert.equal(result.stdout.includes('NEVER-PRINT'), false);
    assert.equal(result.stdout.includes('NONEXISTENT'), false);
  }
});
test('detects Lace manifest versions in an explicitly selected Chrome user data directory without exposing its path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shroudly-chrome-test-'));
  try {
    const installed = join(directory, 'Default/Extensions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2.4.2');
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'manifest.json'), JSON.stringify({ name: 'Midnight Lace', version: '2.4.2' }));
    const result = run(['--offline'], { MIDNIGHT_CHROME_USER_DATA_DIR: directory, MIDNIGHT_BLOCKFROST_SECRET_NAME: 'NONEXISTENT-TEST-REFERENCE' });
    assert.deepEqual(result.report.browser.lace, ['2.4.2']);
    assert.equal(result.stdout.includes(directory), false);
    assert.equal(result.report.checks.find(c => c.name === 'blockfrost-authorization').status, 'unverified');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('requires a WebSocket protocol acknowledgement and rejects successful HTTP error payloads', async () => {
  const server = createServer((req, res) => res.end(JSON.stringify({ errors: [{ message: 'PRIVATE-REMOTE-ERROR' }] })));
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: graphql-transport-ws\r\n\r\n`);
    socket.once('data', () => {
      const message = Buffer.from('{"type":"connection_ack"}');
      socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
      setTimeout(() => socket.destroy(), 20);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const child = spawn(process.execPath, [cli.pathname, '--timeout', '1000'], { env: { PATH: process.env.PATH, HOME: '/nonexistent', MIDNIGHT_INDEXER_HTTP_URL: `http://127.0.0.1:${port}/graphql`, MIDNIGHT_INDEXER_WS_URL: `ws://127.0.0.1:${port}/ws` } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise(resolve => child.on('close', resolve));
    const report = JSON.parse(stdout);
    assert.equal(code, 1);
    assert.equal(report.checks.find(c => c.name === 'indexer-http').status, 'blocked');
    assert.equal(report.checks.find(c => c.name === 'indexer-ws').status, 'pass');
    assert.equal(`${stdout}${stderr}`.includes('PRIVATE-REMOTE-ERROR'), false);
  } finally { server.close(); }
});
test('rejects credential-bearing endpoints and suppresses configuration values', () => {
  const result = run([], { MIDNIGHT_INDEXER_HTTP_URL: 'https://private-user:NEVER-PRINT@example.com/graphql?token=NEVER-PRINT', MIDNIGHT_PROOF_SERVER_URL: 'https://hosted.example.com' });
  assert.equal(result.status, 1);
  assert.equal(result.report.checks.find(c => c.name === 'indexer-http').status, 'blocked');
  assert.equal(result.report.checks.find(c => c.name === 'local-prover').status, 'blocked');
  assert.equal(result.stdout.includes('NEVER-PRINT'), false);
  assert.equal(result.stdout.includes('hosted.example.com'), false);
});
test('validates protocol responses and keeps proof version and wallet funding as distinct evidence', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/graphql') res.end(JSON.stringify({ data: { __typename: 'Query' } }));
    else if (req.url === '/version') res.end('8.1.3');
    else res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'Midnight Preprod' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const child = spawn(process.execPath, [cli.pathname, '--timeout', '100'], { env: { PATH: process.env.PATH, HOME: '/nonexistent', MIDNIGHT_INDEXER_HTTP_URL: `${base}/graphql`, MIDNIGHT_RPC_URL: base, MIDNIGHT_PROOF_SERVER_URL: base } });
    let stdout = '';
    child.stdout.on('data', data => { stdout += data; });
    const code = await new Promise(resolve => child.on('close', resolve));
    const report = JSON.parse(stdout);
    assert.equal(code, 1);
    for (const name of ['indexer-http', 'rpc', 'local-prover', 'proof-version']) assert.equal(report.checks.find(c => c.name === name).status, 'pass', name);
    assert.equal(report.accessReady, false);
  } finally { server.close(); }
});
test('terminates after its complete report when a WebSocket peer ignores protocol and close messages', async () => {
  const sockets = new Set();
  const server = createServer();
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', () => {});
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: graphql-transport-ws\r\n\r\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let watchdog;
  try {
    const child = spawn(process.execPath, [cli.pathname, '--timeout', '100'], { env: { PATH: process.env.PATH, HOME: '/nonexistent', MIDNIGHT_INDEXER_WS_URL: `ws://127.0.0.1:${server.address().port}/ws` } });
    let stdout = ''; let killed = false;
    const kill = () => { killed = true; child.kill('SIGKILL'); };
    watchdog = setTimeout(kill, 2500);
    child.stdout.on('data', data => {
      stdout += data;
      if (stdout.endsWith('\n')) { clearTimeout(watchdog); watchdog = setTimeout(kill, 700); }
    });
    const code = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(watchdog);
    const report = JSON.parse(stdout);
    assert.equal(report.checks.find(c => c.name === 'indexer-ws').status, 'blocked');
    assert.equal(killed, false, 'CLI must terminate without waiting for an uncooperative peer to close');
    assert.equal(code, 1);
  } finally {
    clearTimeout(watchdog);
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});
