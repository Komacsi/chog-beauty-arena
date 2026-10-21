// Closed, fictional staging only. No wallet, signer, secrets or blockchain writes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=new URL(process.argv[2] || 'http://127.0.0.1:8080');
if(base.protocol!=='http:' || !['127.0.0.1','localhost'].includes(base.hostname))throw Error('Loopback staging URL required');
const started=Date.now(),config=await(await fetch(new URL('/api/config',base))).json();
assert.equal(config.mode,'demo');assert.equal(config.release.realFundsEnabled,false);assert.equal(config.arenaAddress,'');
assert.equal(config.chainId,143);assert.equal(config.minStake,'5000000000000000000000');
for(const path of ['/','/profile','/leaderboard','/bundle.js',config.nfts[0].image]){
  const response=await fetch(new URL(path,base));assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0);
}
assert.equal((await fetch(new URL('/api/deployment',base))).status,403);
const durations=[];
for(let group=0;group<5;group++)await Promise.all(Array.from({length:10},async()=>{
  const start=performance.now(),response=await fetch(new URL('/api/state?fresh=1',base));assert.equal(response.status,200);
  const state=await response.json();assert.ok(Array.isArray(state.rounds));assert.ok(Array.isArray(state.challenges));durations.push(performance.now()-start);
}));
const oversized=await fetch(new URL('/api/challenges/create',base),{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(20000)});
assert.ok([400,413].includes(oversized.status));assert.equal((await fetch(new URL('/api/config',base))).status,200);
durations.sort((a,b)=>a-b);
const report={checkedAt:new Date().toISOString(),mode:'closed fictional staging',requests:50,concurrency:10,p95Ms:Math.round(durations[Math.ceil(durations.length*0.95)-1]),maxMs:Math.round(durations.at(-1)),elapsedMs:Date.now()-started,assets:'passed',oversizedBodyStatus:oversized.status,realDeploymentBlocked:true,blockchainTransactionsSent:0,limitations:'Loopback HTTP smoke, not public DDoS or live reveal throughput measurement.'};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report,null,2));
