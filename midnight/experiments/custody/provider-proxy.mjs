import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

// Keep provider credentials out of every SDK URL: dependencies log URL failures.
// Upstream errors and payloads are deliberately never forwarded to logs.
export async function providerProxy({http,ws,rpc,token}) {
  const capability=randomBytes(24).toString('hex');
  const routes=new Map([[`/${capability}/indexer`,http],[`/${capability}/rpc`,rpc.replace(/^ws/,'http')]]);
  const sockets=new Set();
  const server=createServer(async(req,res)=>{
    const target=routes.get(req.url);
    if(!target || req.method!=='POST'){res.writeHead(404).end();return;}
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw Error('size');chunks.push(chunk);}
      const upstream=await fetch(target,{method:'POST',headers:{project_id:token,'content-type':'application/json'},body:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(30000)});
      res.writeHead(upstream.status,{'content-type':'application/json'});
      for await(const chunk of upstream.body){if(res.destroyed)break;res.write(chunk);}res.end();
    }catch{if(!res.headersSent)res.writeHead(502);res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:16*1024*1024});
  server.on('upgrade',(req,socket,head)=>{
    const target=req.url===`/${capability}/indexer`?ws:req.url===`/${capability}/rpc`?rpc.replace(/^http/,'ws'):null;
    if(!target){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,downstream=>{
      const upstream=new WebSocket(target,downstream.protocol?[downstream.protocol]:[],{headers:{project_id:token},handshakeTimeout:30000,maxPayload:16*1024*1024});
      sockets.add(upstream);sockets.add(downstream);const pending=[];let queued=0;
      const close=()=>{sockets.delete(upstream);sockets.delete(downstream);upstream.terminate();downstream.terminate();};
      for(const peer of [upstream,downstream]){peer.on('error',close);peer.on('close',close);}
      downstream.on('message',(data,binary)=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary});else{queued+=data.length;if(queued>16*1024*1024)close();else pending.push([data,binary]);}});
      upstream.on('open',()=>{for(const [data,binary]of pending)upstream.send(data,{binary});pending.length=0;});
      upstream.on('message',(data,binary)=>{if(downstream.readyState===WebSocket.OPEN)downstream.send(data,{binary});});
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`127.0.0.1:${server.address().port}/${capability}`;
  return {http:`http://${base}/indexer`,ws:`ws://${base}/indexer`,rpc:`ws://${base}/rpc`,close:async()=>{for(const s of sockets)s.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
