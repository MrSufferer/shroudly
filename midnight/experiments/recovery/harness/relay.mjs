import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,resolve,sep} from 'node:path';

// Participant-local relay for the browser harness. It serves the built bundle
// and the PUBLIC compiled circuit artifacts, and forwards indexer queries with
// the Operator's provider credential attached server-side so the credential
// never reaches page JavaScript, a VITE_ value, or a log. Loopback only.
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const OFFICIAL_INDEXER='https://midnight-preprod.blockfrost.io/api/v0';

export async function startRelay({port=4177,distDirectory,managedDirectory,indexerUrl=OFFICIAL_INDEXER,token,publicConfig,allowInsecureUpstreamForTests=false}) {
  if(!allowInsecureUpstreamForTests&&indexerUrl!==OFFICIAL_INDEXER)throw Error('indexer route is outside the approved Preprod endpoint');
  const dist=resolve(distDirectory),managed=resolve(managedDirectory);
  const within=(base,target)=>target===base||target.startsWith(base+sep);
  let origin;
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://relay');
      if(req.headers.host!==new URL(origin).host)throw Object.assign(Error('host'),{status:403});
      if(url.pathname==='/indexer') {
        if(req.method!=='POST')throw Object.assign(Error('method'),{status:404});
        if(req.headers.origin&&req.headers.origin!==origin)throw Object.assign(Error('origin'),{status:403});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(Error('size'),{status:413});chunks.push(chunk);}
        const upstream=await fetch(indexerUrl,{method:'POST',headers:{'content-type':'application/json',project_id:token},body:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(30000)});
        res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if(req.method!=='GET')throw Object.assign(Error('method'),{status:404});
      if(url.pathname==='/config.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(publicConfig));return;}
      const decoded=decodeURIComponent(url.pathname);
      let file;
      if(decoded.startsWith('/managed/recovery-probe/')) {
        const relative=decoded.slice('/managed/'.length);
        if(!/^recovery-probe\/(keys|zkir)\/[A-Za-z0-9_.-]+\.(prover|verifier|bzkir)$/.test(relative))throw Object.assign(Error('path'),{status:404});
        file=resolve(managed,relative);
        if(!within(managed,file))throw Object.assign(Error('path'),{status:404});
      } else {
        file=resolve(dist,'.'+(decoded==='/'?'/index.html':decoded));
        if(!within(dist,file))throw Object.assign(Error('path'),{status:404});
      }
      const body=await readFile(file);
      res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-store'});
      res.end(body);
    }catch(error){
      if(!res.headersSent)res.writeHead(error?.status??404);
      res.end();
    }
  });
  server.on('upgrade',(_req,socket)=>socket.destroy());
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {url:origin,close:()=>new Promise(done=>{server.closeAllConnections();server.close(done);})};
}
