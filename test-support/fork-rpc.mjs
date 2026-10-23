// The native test node cannot broadcast to the upstream network through this gateway.
import http from 'node:http';
export const READ_METHODS=new Set(['eth_chainId','eth_blockNumber','net_version','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getBalance','eth_getStorageAt','eth_getTransactionCount','eth_getProof','eth_getTransactionByHash','eth_getTransactionReceipt','eth_gasPrice']);
export async function startReadOnlyForkRpc(upstream){
  const server=http.createServer(async(req,res)=>{
    let id=null;
    const reply=data=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    try{
      if(req.method!=='POST' || req.url!=='/')throw Error('Only JSON-RPC POST supported');
      let body='',bytes=0;for await(const part of req){bytes+=part.length;if(bytes>65536)throw Error('Request too large');body+=part;}
      const rpc=JSON.parse(body);id=rpc.id ?? null;
      if(Array.isArray(rpc) || !READ_METHODS.has(rpc.method))throw Error('Upstream mutation/unsupported method blocked: '+rpc.method);
      const value=await upstream.send(rpc.method,rpc.params || []);
      // Monad omits the withdrawals array; use the same normalization as the prior fork.
      const result=value && ['eth_getBlockByNumber','eth_getBlockByHash'].includes(rpc.method)?{...value,withdrawals:value.withdrawals || []}:value;
      reply({jsonrpc:'2.0',id,result});
    }catch(error){reply({jsonrpc:'2.0',id,error:{code:-32600,message:error.message}});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
