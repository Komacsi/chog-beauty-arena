// Small, read-only latency sample. Never broadcasts or reads wallet credentials.
import {writeFile} from 'node:fs/promises';
const output=process.argv[2];
if(!output)throw Error('Pass a NEW output JSON path');
const url='https://rpc.monad.xyz',rows=[];let id=0;
async function rpc(method,params){
  const start=performance.now();
  try{
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(8000)});
    const body=await r.json();if(!r.ok||body.error||body.result===undefined)throw Error('RPC response failed');
    rows.push({method,ms:Math.round(performance.now()-start),ok:true});return body.result;
  }catch{rows.push({method,ms:Math.round(performance.now()-start),ok:false});return null;}
  finally{await new Promise(done=>setTimeout(done,150));}
}
if(await rpc('eth_chainId',[])!=='0x8f')throw Error('Wrong or unavailable Monad RPC');
const latest=await rpc('eth_getBlockByNumber',['latest',false]);if(!latest)throw Error('No block');
const old=await rpc('eth_getBlockByNumber',['0x'+(BigInt(latest.number)-64n).toString(16),false]);
for(let i=0;i<12;i++){
  await rpc('eth_getBlockByNumber',['latest',false]);
  await rpc('eth_call',[{to:'0x350035555e10d9afaf1566aaebfced5ba6c27777',data:'0x313ce567'},'latest']);
}
const times=rows.filter(r=>r.ok).map(r=>r.ms).sort((a,b)=>a-b);
const result={checkedAt:new Date().toISOString(),endpoint:url,chainId:143,host:process.platform,node:process.version,requests:rows.length,failures:rows.filter(r=>!r.ok).length,meanMs:Math.round(times.reduce((a,b)=>a+b,0)/times.length),p95Ms:times[Math.ceil(times.length*.95)-1],minMs:times[0],maxMs:times.at(-1),blockSample:old?{from:Number(BigInt(old.number)),to:Number(BigInt(latest.number)),span:64,timestampSpanSeconds:Number(BigInt(latest.timestamp)-BigInt(old.timestamp)),meanBlockMs:Number(BigInt(latest.timestamp)-BigInt(old.timestamp))*1000/64}:null,rows,transactionsSent:0,limitations:'Short sequential low-rate read sample, not a load test of the public endpoint and not a bound on future availability, eth_estimateGas, transaction inclusion or drand.'};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
