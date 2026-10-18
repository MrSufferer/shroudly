import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {errorDetail,abortSummary} from './error-detail.mjs';

// Secret-shaped fixtures (synthetic, never real credentials).
const hex64='cd'.repeat(32);
const blockfrostShaped='preprod'+'Ab3dE9gH2jK5mN7pQ1rS4tV6wX8yZ0aB';
const leaks=[/https?:|wss?:/i,/user:pw/,/project_id\s*[=:]\s*\w/i,/cdcdcdcd/,/xyz123/,/Ab3dE9gH/,/0x[0-9a-f]{24}/i,/[0-9a-f]{24,}/i];
const assertClean=text=>{for(const shape of leaks)assert.doesNotMatch(text,shape);};

test('abort detail keeps the cause chain but drops URLs, tokens, project_id and long hex', () => {
  const root=Error(`connect refused https://user:pw@rpc.example/api?project_id=abc wss://indexer.example/ws`);
  const node=Object.assign(Error(`1010: Invalid Transaction: Custom error: 170 nullifier 0x${hex64}`),{cause:root});
  const mid=Object.assign(new TypeError(`bad token=xyz123 project_id: ${blockfrostShaped} key ${hex64}`),{cause:node});
  const top=Object.assign(Error('Transaction submission error'),{cause:mid});
  const {abortCategory,abortDetail}=abortSummary(top);
  assert.equal(abortCategory,'Transaction submission error');
  assert.match(abortDetail,/^Error: Transaction submission error <- TypeError: .* <- Error: 1010: Invalid Transaction: Custom error: 170 .* <- Error: connect refused/);
  assertClean(abortDetail);
  assertClean(abortCategory);
});

test('abort detail follows an Effect fiber failure into the node rejection', () => {
  const compactJs=new URL('../../../node_modules/.pnpm/@midnight-ntwrk+compact-js@2.5.1/node_modules/@midnight-ntwrk/compact-js/package.json',import.meta.url);
  const {Effect,Runtime}=createRequire(fileURLToPath(compactJs))('effect');
  const rpc=Error('1010: Invalid Transaction: Custom error: 170');
  const submission=Object.assign(Error('Transaction submission error'),{cause:rpc});
  let fiberFailure;
  try{Effect.runSync(Effect.fail(submission));}catch(error){fiberFailure=error;}
  assert.ok(Runtime.isFiberFailure(fiberFailure));
  assert.match(errorDetail(fiberFailure),/Custom error: 170/);
});

test('abort detail is bounded and tolerates non-Error throws', () => {
  let error=Error('x'.repeat(500));
  for(let i=0;i<8;i++)error=Object.assign(Error(`level ${i}`),{cause:error});
  assert.equal(errorDetail(error).split(' <- ').length,4);
  assert.ok(errorDetail(Error('y'.repeat(900))).length<260);
  assert.equal(abortSummary('plain https://x.example/?project_id=q').abortCategory,'plain <url>');
  assert.equal(abortSummary(undefined).abortCategory,'unknown');
});
