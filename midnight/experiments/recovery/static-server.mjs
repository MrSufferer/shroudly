import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

// Loopback-only static server for the browser qualification pages. It serves
// this directory (and nothing credential-bearing) with module-safe MIME types.
const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json'};

export function startStaticServer(port=0) {
  const server=createServer(async(req,res)=>{
    try{
      const path=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname));
      if(path.includes('..')||path.includes('.env'))throw Error('forbidden');
      const file=path==='/'?'/qualification.html':path;const body=await readFile(join(root,file));
      res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-store'});
      res.end(body);
    }catch{res.writeHead(404).end();}
  });
  return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({
    url:`http://127.0.0.1:${server.address().port}`,
    close:()=>new Promise(done=>{server.closeAllConnections();server.close(done);}),
  })));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {url}=await startStaticServer(Number(process.argv[2]??0));
  console.log(url);
}
