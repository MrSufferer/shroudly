import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer}from'node:http';
import WebSocket,{WebSocketServer}from'ws';
import {spawn}from'node:child_process';
import{providerProxy}from'./provider-proxy.mjs';

async function fixture(handler){
 const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const http=`http://127.0.0.1:${server.address().port}`;
 return{server,http,ws:http.replace('http:','ws:'),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('SDK routes carry no provider token while HTTP and WebSocket requests authenticate upstream',async()=>{
 const token='synthetic-private-provider-token';
 const upstream=await fixture((req,res)=>{res.end(JSON.stringify({authorized:req.headers.project_id===token}));});
 const wss=new WebSocketServer({server:upstream.server});
 wss.on('connection',(socket,req)=>socket.on('message',data=>socket.send(JSON.stringify({authorized:req.headers.project_id===token,echo:data.toString()}))));
 const proxy=await providerProxy({http:upstream.http,ws:upstream.ws,rpc:upstream.ws,token});
 try{
   for(const route of[proxy.http,proxy.ws,proxy.rpc])assert.equal(route.includes(token),false);
   const result=await(await fetch(proxy.http,{method:'POST',body:'{}'})).json();assert.equal(result.authorized,true);
   const response=await new Promise((resolve,reject)=>{const socket=new WebSocket(proxy.ws,'graphql-transport-ws');socket.on('open',()=>socket.send('probe'));socket.on('message',data=>{socket.close();resolve(JSON.parse(data));});socket.on('error',reject);});
   assert.deepEqual(response,{authorized:true,echo:'probe'});
 }finally{await proxy.close();wss.close();await upstream.close();}
});
test('upstream redirect cannot move provider authentication to another destination',async()=>{
 let redirectedRequests=0;const forbidden=await fixture((req,res)=>{redirectedRequests++;res.end('unexpected');});
 const upstream=await fixture((req,res)=>{res.writeHead(302,{location:forbidden.http});res.end('provider response must not enter an error report');});
 const proxy=await providerProxy({http:upstream.http,ws:upstream.ws,rpc:upstream.ws,token:'synthetic-token'});
 try{const response=await fetch(proxy.http,{method:'POST',body:'{}'});assert.equal(response.status,502);assert.equal(await response.text(),'');assert.equal(redirectedRequests,0);}
 finally{await proxy.close();await upstream.close();await forbidden.close();}
});
test('protected CLI emits only sanitized failure evidence when its worker fails',async()=>{
 const secret='synthetic-secret-that-must-not-appear';
 const result=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,[new URL('./sync-wallet.mjs',import.meta.url).pathname,`/missing/${secret}`]);child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));});
 assert.equal(result.code,1);assert.equal(result.stderr,'');assert.equal(result.stdout.includes(secret),false);assert.equal(JSON.parse(result.stdout).category,'protected-wallet-not-established');
});
