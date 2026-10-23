// Static loopback operator UI. No deployment endpoint, signer or RPC forwarding.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateDeploymentDraft} from './deployment-draft.mjs';
export async function deploymentReviewServer(directory,port=3110){
  validateDeploymentDraft(JSON.parse(await readFile(resolve(directory,'deployment.json'),'utf8')));
  const routes=new Map([['/',['index.html','text/html; charset=utf-8']],['/client.js',['client.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/ethers.js',['ethers.js','text/javascript; charset=utf-8']],...['deployment.json','manifest.json','source-input.json'].map(name=>['/'+name,[name,'application/json']])]);
  const server=http.createServer({headersTimeout:10000,requestTimeout:15000,maxHeaderSize:8192},async(req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const actualPort=server.address().port,hosts=['127.0.0.1:'+actualPort,'localhost:'+actualPort];
    if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.map(x=>'http://'+x).includes(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
    const route=routes.get(req.url);if(!route){res.writeHead(404);res.end();return;}
    try{const bytes=await readFile(resolve(directory,route[0]));res.writeHead(200,{'content-type':route[1]});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(500);res.end();}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return {url:'http://127.0.0.1:'+server.address().port,async close(){server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
