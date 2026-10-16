import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import * as d from '../lib/demo.mjs';
const units=n=>parseUnits(String(n),18);
function fixture(){const state=d.createState();const round=d.startRound(state,[{tokenId:1},{tokenId:2}],0);return {state,round};}
test('one vote per wallet, stake does not increase voting power',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(100),1);d.vote(state,'b',1,units(1),1);
  assert.equal(round.votesA,1);assert.equal(round.votesB,1);
  assert.throws(()=>d.vote(state,'a',1,units(2),1),/Already voted/);
});
test('holders can vote free; non-holders require a stake',()=>{
  const {state}=fixture();d.user(state,'visitor').holder=false;
  assert.throws(()=>d.vote(state,'visitor',0,0n,1),/stake is required/);
  d.vote(state,'holder',0,0n,1);d.vote(state,'visitor',1,units(10),1);
});
test('winners split the entire two-sided pool proportionally after a 1% fee',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(10),1);d.vote(state,'b',0,units(30),1);d.vote(state,'c',1,units(60),1);
  assert.throws(()=>d.settle(state,round,2),/active/);
  d.settle(state,round,86400000);assert.equal(d.payout(round,'a'),units('24.75'));assert.equal(d.payout(round,'b'),units('74.25'));assert.equal(d.payout(round,'c'),0n);assert.equal(BigInt(state.fees),units('1'));
  assert.equal(state.points[round.nftA],1);d.settle(state,round,86400000);assert.equal(state.points[round.nftA],1);
  d.claim(state,round,'a');assert.equal(d.payout(round,'a'),0n);assert.throws(()=>d.claim(state,round,'a'),/Nothing/);
});
test('tie refunds every stake in full with no fee or points',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(10),1);d.vote(state,'b',1,units(30),1);d.settle(state,round,86400000);
  assert.equal(d.payout(round,'a'),units('10'));assert.equal(d.payout(round,'b'),units('30'));assert.equal(state.fees,'0');assert.deepEqual(state.points,{});
});
test('winner without stakes: full refund without fee; winning NFT gets one point',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,0n,1);d.vote(state,'b',0,0n,1);d.vote(state,'c',1,units(100),1);d.settle(state,round,86400000);
  assert.equal(round.refund,true);assert.equal(d.payout(round,'c'),units('100'));assert.equal(state.fees,'0');assert.equal(state.points[round.nftA],1);
});
for(const side of [0,1])test(`winning side ${side} with the only bank receives full stakes without fees`,()=>{
  const {state,round}=fixture();d.vote(state,'a',side,units(10),1);d.vote(state,'b',side,units(30),1);d.vote(state,'c',1-side,0n,1);
  d.settle(state,round,86400000);assert.equal(round.refund,true);assert.equal(round.winner,side);
  assert.equal(d.payout(round,'a'),units(10));assert.equal(d.payout(round,'b'),units(30));assert.equal(state.fees,'0');
  assert.equal(state.points[side===0?round.nftA:round.nftB],1);
  d.claim(state,round,'a');assert.equal(BigInt(state.users.a.balance),units(1000));
});
test('side B winners receive stake plus winnings after the 1% total-pool fee',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(60),1);d.vote(state,'b',1,units(10),1);d.vote(state,'c',1,units(30),1);
  d.settle(state,round,86400000);assert.equal(d.payout(round,'b'),units('24.75'));assert.equal(d.payout(round,'c'),units('74.25'));assert.equal(d.payout(round,'a'),0n);assert.equal(state.fees,units(1).toString());
});
test('expired rounds reject votes and zero-pool settlement is safe',()=>{
  const {state,round}=fixture();assert.throws(()=>d.vote(state,'a',0,0n,86400000),/closed/);d.settle(state,round,86400000);assert.equal(d.payout(round,'a'),0n);
});
