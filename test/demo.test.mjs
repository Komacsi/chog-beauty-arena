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
test('winners split the entire pool proportionally after a 2.5% fee',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(10),1);d.vote(state,'b',0,units(30),1);d.vote(state,'c',1,units(60),1);
  assert.throws(()=>d.settle(state,round,2),/active/);
  d.settle(state,round,86400000);assert.equal(d.payout(round,'a'),units('24.375'));assert.equal(d.payout(round,'b'),units('73.125'));assert.equal(d.payout(round,'c'),0n);assert.equal(BigInt(state.fees),units('2.5'));
  assert.equal(state.points[round.nftA],1);d.settle(state,round,86400000);assert.equal(state.points[round.nftA],1);
  d.claim(state,round,'a');assert.equal(d.payout(round,'a'),0n);assert.throws(()=>d.claim(state,round,'a'),/Nothing/);
});
test('tie refunds 97.5% with no points',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,units(10),1);d.vote(state,'b',1,units(30),1);d.settle(state,round,86400000);
  assert.equal(d.payout(round,'a'),units('9.75'));assert.equal(d.payout(round,'b'),units('29.25'));assert.deepEqual(state.points,{});
});
test('winner without stakes: losers get refund minus fee; winning NFT gets one point',()=>{
  const {state,round}=fixture();d.vote(state,'a',0,0n,1);d.vote(state,'b',0,0n,1);d.vote(state,'c',1,units(100),1);d.settle(state,round,86400000);
  assert.equal(round.refund,true);assert.equal(d.payout(round,'c'),units('97.5'));assert.equal(state.points[round.nftA],1);
});
test('expired rounds reject votes and zero-pool settlement is safe',()=>{
  const {state,round}=fixture();assert.throws(()=>d.vote(state,'a',0,0n,86400000),/closed/);d.settle(state,round,86400000);assert.equal(d.payout(round,'a'),0n);
});
