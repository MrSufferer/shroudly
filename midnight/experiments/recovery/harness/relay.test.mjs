import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRelay} from './relay.mjs';

const TOKEN='test-token-not-a-secret';
async function fixture() {
  const seen=[];
  const upstream=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    seen.push({headers:req.headers,body:Buffer.concat(chunks).toString()});
    res.writeHead(200,{'content-type':'application/json','x-project-echo':req.headers.project_id});
    res.end('{"data":{"__typename":"Query"}}');
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const root=mkdtempSync(join(tmpdir(),'relay-'));
  mkdirSync(join(root,'dist'));mkdirSync(join(root,'managed/recovery-probe/keys'),{recursive:true});
  writeFileSync(join(root,'dist/index.html'),'<html>ok</html>');
  writeFileSync(join(root,'managed/recovery-probe/keys/advance.verifier'),'vk');
  writeFileSync(join(root,'secret.txt'),'private');
  const relay=await startRelay({port:0,distDirectory:join(root,'dist'),managedDirectory:join(root,'managed'),indexerUrl:`http://127.0.0.1:${upstream.address().port}/api/v0`,token:TOKEN,publicConfig:{contract:'ab',preflightKeys:{}},allowInsecureUpstreamForTests:true});
  return {relay,seen,close:async()=>{await relay.close();upstream.close();rmSync(root,{recursive:true,force:true});}};
}

test('the indexer route authenticates upstream and never discloses the provider credential', async()=>{
  const f=await fixture();
  try{
    const response=await fetch(`${f.relay.url}/indexer`,{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"{__typename}"}'});
    assert.equal(response.status,200);
    assert.equal(f.seen[0].headers.project_id,TOKEN);
    assert.equal([...response.headers.keys()].some(k=>k==='x-project-echo'),false);
    assert.equal((await response.text()).includes(TOKEN),false);
    const config=await (await fetch(`${f.relay.url}/config.json`)).text();
    assert.equal(config.includes(TOKEN),false);
  }finally{await f.close();}
});

test('cross-origin pages, wrong hosts and other methods are refused', async()=>{
  const f=await fixture();
  try{
    const cross=await fetch(`${f.relay.url}/indexer`,{method:'POST',headers:{origin:'https://evil.example'},body:'{}'});
    assert.equal(cross.status,403);
    const get=await fetch(`${f.relay.url}/indexer`);
    assert.equal(get.status,404);
    assert.equal(f.seen.length,0);
  }finally{await f.close();}
});

test('static serving is confined to the bundle and public compiled artifacts', async()=>{
  const f=await fixture();
  try{
    assert.equal((await fetch(`${f.relay.url}/`)).status,200);
    assert.equal((await fetch(`${f.relay.url}/managed/recovery-probe/keys/advance.verifier`)).status,200);
    for(const bad of ['/../secret.txt','/%2e%2e/secret.txt','/managed/recovery-probe/../../secret.txt','/.env'])assert.equal((await fetch(`${f.relay.url}${bad}`)).status,404);
  }finally{await f.close();}
});
