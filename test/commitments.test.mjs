import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSalt,makeCommitment,phase,secretKey,DEMO_ARENA} from '../lib/commitments.mjs';
const input={arena:DEMO_ARENA,chainId:143,roundId:1,account:'0x1111111111111111111111111111111111111111',side:0,tokenId:1090,amount:100n,salt:'0x'+'ab'.repeat(32)};
test('paid bet commitments are domain separated and bound to an individual bet nonce',()=>{
  const paid=makeCommitment({...input,betNonce:0});assert.notEqual(paid,makeCommitment(input));assert.notEqual(paid,makeCommitment({...input,betNonce:1}));
});
test('commitment binds the arena, chain, round, voter, NFT, side, amount and secret',()=>{
  const original=makeCommitment(input);
  for(const change of [{arena:'0x2222222222222222222222222222222222222222'},{chainId:144},{roundId:2},{account:'0x3333333333333333333333333333333333333333'},{side:1},{tokenId:1233},{amount:101n},{salt:'0x'+'cd'.repeat(32)}])assert.notEqual(makeCommitment({...input,...change}),original);
  assert.throws(()=>makeCommitment({...input,side:2}),/Invalid side/);
});
test('secrets are random 32-byte values and storage is scoped to the voter and deployment',()=>{
  const a=makeSalt(),b=makeSalt();assert.match(a,/^0x[0-9a-f]{64}$/i);assert.notEqual(a,b);
  assert.notEqual(secretKey(input),secretKey({...input,roundId:2}));assert.notEqual(secretKey(input),secretKey({...input,account:'0x3333333333333333333333333333333333333333'}));
});
test('commit and reveal phases never overlap at their boundaries',()=>{
  const round={endsAt:100,revealEndsAt:200,settled:false};assert.equal(phase(round,99),'commit');assert.equal(phase(round,100),'reveal');assert.equal(phase(round,199),'reveal');assert.equal(phase(round,200),'settlement');assert.equal(phase({...round,settled:true},101),'settled');
});
test('the post-close clock margin is a distinct waiting phase',()=>{
  const r={endsAt:100,unlockAt:150,revealEndsAt:200};assert.equal(phase(r,99),'commit');assert.equal(phase(r,100),'waiting');assert.equal(phase(r,149),'waiting');assert.equal(phase(r,150),'reveal');assert.equal(phase(r,200),'settlement');
  assert.equal(phase({...r,interrupted:true},1),'interrupted');
  assert.equal(phase({...r,interrupted:true,settled:true},1),'settled');
});
