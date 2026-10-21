import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('HTTP flow: empty lobby, profile ownership, cancel, accept, concurrent matches and selected-round commits',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-matchmaking-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',ARENA_STATE_DIR:dir,ARENA_CONTRACT_ADDRESS:'',DEMO_FAST_ROUNDS:'0',ARENA_WEB_ORIGINS:'https://arena.netlify.app'},stdio:['ignore','pipe','pipe']});
  let logs='',cookies=new Map();child.stderr.on('data',()=>{});
  try{
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),15000);child.stdout.on('data',d=>{logs+=d;const m=logs.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
    async function request(path,body,expected=200){const response=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const c of response.headers.getSetCookie()){const [key,value]=c.split(';')[0].split('=');cookies.set(key,value);}const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
    let s=await request('state');assert.equal(s.rounds.length,0);assert.equal(s.challenges.length,0);assert.equal(s.ownedTokens.length,5);const a=s.ownedTokens;
    for(const body of ['null','[]','{broken',JSON.stringify({padding:'a'.repeat(9000)}),JSON.stringify({padding:'界'.repeat(3000)})]){
      const response=await fetch(base+'/api/challenges/create',{method:'POST',headers:{'content-type':'application/json'},body});
      assert.equal(response.status,400);assert.equal((await request('state')).challenges.length,0);
    }
    const burst=await Promise.all(Array.from({length:40},()=>fetch(base+'/api/state?fresh=1')));assert.ok(burst.every(r=>r.status===200));
    const foreignOrigin=await fetch(base+'/api/challenges/create',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify({tokenId:a[0]})});
    assert.equal(foreignOrigin.status,403);assert.equal((await request('state')).challenges.length,0);
    const proxyPost=origin=>fetch(base+'/api/demo/wallet',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-host':'arena.netlify.app'},body:JSON.stringify({persona:'alice'})});
    assert.equal((await proxyPost('https://arena.netlify.app')).status,200);
    assert.equal((await proxyPost('https://another.netlify.app')).status,403);
    assert.equal((await proxyPost('null')).status,403);
    assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
    // A backslash is a separator on Windows and a literal filename on POSIX.
    assert.ok([403,404].includes((await fetch(base+'/%2e%2e%5cpackage.json')).status));
    await request('challenges/create',{tokenId:99999},400);await request('challenges/create',{tokenId:a[0]});await request('challenges/create',{tokenId:a[0]},400);assert.equal((await request('state')).rounds.length,0);
    await request('demo/wallet',{persona:'bob'});s=await request('state');const b=s.ownedTokens;assert.equal(b.length,5);await request('challenges/cancel',{id:1},400);
    await request('demo/wallet',{persona:'alice'});await request('challenges/cancel',{id:1});await request('challenges/create',{tokenId:a[0]});await request('demo/wallet',{persona:'bob'});
    await request('challenges/accept',{id:1,tokenId:b[0]},400);const before=Date.now();await request('challenges/accept',{id:2,tokenId:b[0]});s=await request('state?round=1');assert.equal(s.round.nftA,a[0]);assert.equal(s.round.nftB,b[0]);assert.ok(s.round.endsAt>=before+86400000);assert.equal(s.round.endsAt-s.round.startedAt,86400000);
    await request('challenges/create',{tokenId:b[0]},400);await request('challenges/cancel',{id:2},400);await request('demo/cancel',{id:1},404);
    await request('challenges/create',{tokenId:b[1]});await request('demo/wallet',{persona:'alice'});await request('challenges/accept',{id:3,tokenId:a[1]});s=await request('state?round=1');assert.equal(s.rounds.length,2);assert.equal(s.round.id,1);
    await request('demo/wallet',{persona:'visitor'});s=await request('state');assert.equal(s.ownedTokens.length,0);await request('challenges/create',{tokenId:a[2]},400);
    const config=await request('config');assert.equal(config.minStake,'5000000000000000000000');assert.equal(config.release.realFundsEnabled,false);await request('deployment',undefined,403);
    const payload={commitment:'0x'+'ab'.repeat(32),sealedChoice:'opaque ciphertext',amount:'5000',betNonce:0};await request('commit',payload,400);await request('commit',{...payload,roundId:999},400);
    await request('commit',{...payload,roundId:1,amount:'4999.999999999999999999'},400);
    await request('commit',{...payload,roundId:1});s=await request('state?round=1');assert.equal(s.round.committedCount,1);assert.equal(s.betCount,1);assert.equal(s.round.entries,undefined);assert.equal(s.rounds.find(r=>r.id===2).committedCount,0);
    await request('commit',{...payload,roundId:1},400);await request('commit',{...payload,roundId:1,betNonce:1});
    assert.equal((await request('state?round=1')).betCount,2);
    await request('holder-votes',{...payload,roundId:1,tokenIds:[a[0]]},400);
    await request('demo/wallet',{persona:'alice'});
    const nftPayload={roundId:1,tokenIds:[a[0],a[1]],commitment:payload.commitment,sealedChoice:payload.sealedChoice};
    await request('holder-votes',{...nftPayload,side:0},400);await request('holder-votes',{...nftPayload,salt:'secret'},400);
    await request('holder-votes',{...nftPayload,tokenIds:[a[0],b[0]]},400);assert.equal((await request('state?round=1')).usedNfts.length,0);
    await request('holder-votes',nftPayload);await request('holder-votes',nftPayload,400);
    await request('holder-votes',{...nftPayload,tokenIds:[a[2]]});await request('commit',{...payload,roundId:1});
    s=await request('state?round=1');assert.equal(s.round.committedCount,6);assert.equal(s.betCount,1);assert.equal(s.usedNfts.length,3);assert.equal(s.round.votesA,0);assert.equal(s.round.holderEntries,undefined);
    await request('commit',{...payload,roundId:2,amount:'0'},400);assert.equal((await request('state?round=999')).round,null);
    const details=await request('nfts/'+a[0]);assert.equal(details.tokenId,a[0]);assert.ok(details.name.startsWith('CHOG #'));assert.ok(details.image.startsWith('/nfts/'));
    assert.equal((await fetch(base+'/api/nfts/'+a[0]+'/image',{redirect:'manual'})).status,302);
    await request('nfts/0',undefined,400);await request('nfts/1970',undefined,400);
    assert.equal((await fetch(base+'/nft-placeholder.svg')).headers.get('content-type'),'image/svg+xml');
    assert.equal((await fetch(base+'/profile')).status,200);await request('pair',undefined,404);
  }finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
