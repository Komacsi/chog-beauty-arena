import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sealBallot,openBallot,drandClient,unlockSchedule} from '../lib/timelock.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/drand-round-1.json',import.meta.url),'utf8'));
const input={arena:'0x0000000000000000000000000000000000000000',chainId:143,roundId:1,account:'0x1111111111111111111111111111111111111111',side:0,tokenId:1090,amount:'100'};
const client=()=>drandClient(async()=>({ok:true,json:async()=>fixture}));
test('timelock round-trip verifies a signed production quicknet beacon',async()=>{
  const sealed=await sealBallot(input,1,client());const opened=await openBallot(sealed.sealedChoice,{...input,commitment:sealed.commitment},0,client());assert.equal(opened.side,0);assert.equal(opened.tokenId,1090);
  await assert.rejects(openBallot(sealed.sealedChoice,{...input,account:'0x2222222222222222222222222222222222222222',commitment:sealed.commitment},0,client()),/account mismatch/);
});
test('ciphertext sizes do not reveal the side through token ID or amount length',async()=>{
  const a=await sealBallot(input,1,client()),b=await sealBallot({...input,side:1,tokenId:2,amount:'999999999999999999'},1,client());assert.equal(a.sealedChoice.length,b.sealedChoice.length);assert.notEqual(a.commitment,b.commitment);
});
test('opening before unlock never asks drand for a beacon',async()=>{
  let requested=false;const c=drandClient(async()=>{requested=true;throw Error('Must not fetch');});const sealed=await sealBallot(input,1,c);
  await assert.rejects(openBallot(sealed.sealedChoice,{...input,commitment:sealed.commitment},Date.now()+60000,c),/before its unlock/);assert.equal(requested,false);
});
test('invalid drand signatures cannot decrypt a ballot',async()=>{
  const sealed=await sealBallot(input,1,client());const bad=drandClient(async()=>({ok:true,json:async()=>({...fixture,signature:'00'.repeat(48)})}));await assert.rejects(openBallot(sealed.sealedChoice,{...input,commitment:sealed.commitment},0,bad));
});
test('unlock schedule leaves a clock margin after betting closes',()=>{const end=Date.now()+86400000,s=unlockSchedule(end);assert.ok(s.unlockAt>=end+300000);assert.ok(s.unlockAt<end+303000);assert.equal(s.revealEndsAt-s.unlockAt,3600000);});
