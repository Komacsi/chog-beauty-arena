import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('HTTP flow: empty lobby, profile ownership, cancel, accept, concurrent matches and selected-round commits',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-matchmaking-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',ARENA_STATE_DIR:dir,ARENA_CONTRACT_ADDRESS:'',DEMO_FAST_ROUNDS:'0'},stdio:['ignore','pipe','pipe']});
  let logs='',cookies=new Map();child.stderr.on('data',()=>{});
  try{
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),15000);child.stdout.on('data',d=>{logs+=d;const m=logs.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
    async function request(path,body,expected=200){const response=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const c of response.headers.getSetCookie()){const [key,value]=c.split(';')[0].split('=');cookies.set(key,value);}const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
    let s=await request('state');assert.equal(s.rounds.length,0);assert.equal(s.challenges.length,0);assert.equal(s.ownedTokens.length,5);const a=s.ownedTokens;
    await request('challenges/create',{tokenId:99999},400);await request('challenges/create',{tokenId:a[0]});await request('challenges/create',{tokenId:a[0]},400);assert.equal((await request('state')).rounds.length,0);
    await request('demo/wallet',{persona:'bob'});s=await request('state');const b=s.ownedTokens;assert.equal(b.length,5);await request('challenges/cancel',{id:1},400);
    await request('demo/wallet',{persona:'alice'});await request('challenges/cancel',{id:1});await request('challenges/create',{tokenId:a[0]});await request('demo/wallet',{persona:'bob'});
    await request('challenges/accept',{id:1,tokenId:b[0]},400);const before=Date.now();await request('challenges/accept',{id:2,tokenId:b[0]});s=await request('state?round=1');assert.equal(s.round.nftA,a[0]);assert.equal(s.round.nftB,b[0]);assert.ok(s.round.endsAt>=before+86400000);assert.equal(s.round.endsAt-s.round.startedAt,86400000);
    await request('challenges/create',{tokenId:b[0]},400);await request('challenges/cancel',{id:2},400);await request('demo/cancel',{id:1},404);
    await request('challenges/create',{tokenId:b[1]});await request('demo/wallet',{persona:'alice'});await request('challenges/accept',{id:3,tokenId:a[1]});s=await request('state?round=1');assert.equal(s.rounds.length,2);assert.equal(s.round.id,1);
    await request('demo/wallet',{persona:'visitor'});s=await request('state');assert.equal(s.ownedTokens.length,0);await request('challenges/create',{tokenId:a[2]},400);
    const payload={commitment:'0x'+'ab'.repeat(32),sealedChoice:'opaque ciphertext',amount:'1'};await request('commit',payload,400);await request('commit',{...payload,roundId:999},400);await request('commit',{...payload,roundId:1});s=await request('state?round=1');assert.equal(s.round.committedCount,1);assert.equal(s.entry.side,undefined);assert.equal(s.rounds.find(r=>r.id===2).committedCount,0);
    await request('commit',{...payload,roundId:2,amount:'0'},400);assert.equal((await request('state?round=999')).round,null);
    assert.equal((await fetch(base+'/profile')).status,200);await request('pair',undefined,404);
  }finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
