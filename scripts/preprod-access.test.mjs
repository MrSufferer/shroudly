import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

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
    else if (req.url === '/version') res.end('8.1.0');
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
