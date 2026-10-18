import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import * as d from '../lib/demo.mjs';
import {makeCommitment,makeSalt,DEMO_ARENA} from '../lib/commitments.mjs';
const units=n=>parseUnits(String(n),18);
function fixture(){
  const state=d.createState(),now=Date.now(),ballots=new Map();state.ownership[1090]=d.user(state,'host').address;state.ownership[1233]=d.user(state,'opponent').address;
  const request=d.createChallenge(state,'host',1090,now),round=d.acceptChallenge(state,'opponent',request.id,1233,now);
  function commit(id,side,amount){const ballot={arena:DEMO_ARENA,chainId:143,roundId:round.id,account:d.user(state,id).address,side,tokenId:side?round.nftB:round.nftA,amount:amount.toString(),salt:makeSalt()};d.commitVote(state,id,{commitment:makeCommitment(ballot),sealedChoice:'opaque ciphertext',amount},now);ballots.set(id,ballot);return ballot;}
  function reveal(id){d.revealVote(state,id,ballots.get(id),round.unlockAt);}
  function finish(){for(const id of ballots.keys())reveal(id);d.settle(state,round,round.unlockAt);}
  return {state,round,commit,reveal,finish,ballots,now};
}
test('demo stores no plaintext side or salt before opening',()=>{
  const f=fixture();f.commit('a',1,units(100));const e=f.round.entries.a;assert.equal(e.side,undefined);assert.equal(e.salt,undefined);assert.equal(f.round.poolA,'0');assert.equal(f.round.poolB,'0');assert.equal(f.round.votesA,0);assert.equal(f.round.votesB,0);assert.equal(f.round.totalCommitted,units(100).toString());
});
test('one participation per wallet; holders choose a stake and non-holders must stake',()=>{
  const f=fixture();d.user(f.state,'visitor').holder=false;assert.throws(()=>f.commit('visitor',0,0n),/stake is required/);f.commit('holder',0,0n);f.commit('visitor',1,units(5));assert.throws(()=>f.commit('holder',1,units(1)),/Already voted/);
});
test('early reveals, late commits and mismatched choices are rejected',()=>{
  const f=fixture(),ballot=f.commit('a',0,units(10));assert.throws(()=>d.revealVote(f.state,'a',ballot,f.now),/Not revealing/);
  assert.throws(()=>d.commitVote(f.state,'b',{commitment:makeCommitment(ballot),sealedChoice:'opaque',amount:1n},f.round.endsAt),/closed/);
  assert.throws(()=>d.revealVote(f.state,'a',{...ballot,side:1,tokenId:f.round.nftB},f.round.unlockAt),/mismatch/);f.reveal('a');assert.throws(()=>f.reveal('a'),/Invalid reveal/);
});
test('gross payout first, then individual 1% fees on claiming',()=>{
  const f=fixture();f.commit('a',0,units(10));f.commit('b',0,units(30));f.commit('c',1,units(60));f.finish();
  assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:units(25),fee:units('0.25'),amount:units('24.75')});assert.equal(d.payout(f.round,'b'),units('74.25'));assert.equal(d.payout(f.round,'c'),0n);assert.equal(f.state.fees,'0');
  d.claim(f.state,f.round,'a');d.claim(f.state,f.round,'b');assert.equal(f.state.fees,units(1).toString());assert.throws(()=>d.claim(f.state,f.round,'a'),/Nothing/);assert.equal(f.state.points[f.round.nftA],1);assert.equal(f.state.losses[f.round.nftB],1);
});
test('ties refund stakes and record one draw for both NFTs without fees or wins',()=>{const f=fixture();f.commit('a',0,units(10));f.commit('b',1,units(30));f.finish();assert.equal(d.payout(f.round,'a'),units(10));assert.equal(d.payout(f.round,'b'),units(30));assert.equal(f.state.fees,'0');assert.deepEqual(f.state.points,{});assert.deepEqual(f.state.draws,{[f.round.nftA]:1,[f.round.nftB]:1});d.settle(f.state,f.round,f.round.unlockAt);assert.equal(f.state.draws[f.round.nftA],1);});
test('empty rounds do not count as draws; unstaked votes still qualify',()=>{
  const empty=fixture();empty.finish();assert.deepEqual(empty.state.draws,{});
  const f=fixture();f.commit('a',0,0n);f.commit('b',1,0n);f.finish();assert.equal(f.state.draws[f.round.nftA],1);assert.equal(f.state.draws[f.round.nftB],1);
});
for(const side of [0,1])test(`one-sided bank with winner ${side} returns each stake in full`,()=>{const f=fixture();f.commit('a',side,units(10));f.commit('b',side,units(30));f.commit('c',1-side,0n);f.finish();assert.equal(d.payout(f.round,'a'),units(10));assert.equal(d.payout(f.round,'b'),units(30));assert.equal(f.state.fees,'0');assert.equal(f.round.winner,side);});
test('unstaked winners return losing-side stakes without fees',()=>{const f=fixture();f.commit('a',0,0n);f.commit('b',0,0n);f.commit('c',1,units(100));f.finish();assert.equal(d.payout(f.round,'c'),units(100));assert.equal(f.state.points[f.round.nftA],1);});
test('incomplete opening cancels the entire round and refunds also the unopened stake',()=>{
  const f=fixture();f.commit('a',0,units(10));f.commit('b',1,units(30));f.reveal('a');assert.throws(()=>d.settle(f.state,f.round,f.round.unlockAt),/incomplete/);d.settle(f.state,f.round,f.round.revealEndsAt);
  assert.equal(f.round.cancelled,true);assert.deepEqual(f.state.points,{});assert.deepEqual(f.state.draws,{});assert.equal(d.payout(f.round,'a'),units(10));assert.equal(d.payout(f.round,'b'),units(30));assert.equal(f.state.fees,'0');
});
test('per-winner rounding differs from deducting a fee from the common pool',()=>{const f=fixture();f.commit('a',0,1n);f.commit('b',0,2n);f.commit('c',1,198n);f.finish();assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:67n,fee:0n,amount:67n});assert.deepEqual(d.payoutBreakdown(f.round,'b'),{gross:134n,fee:1n,amount:133n});});
test('historical settled records keep their recorded payouts and fees',()=>{
  const f=fixture();f.round.revealEndsAt=undefined;f.round.settled=true;f.round.refund=false;f.round.winner=0;f.round.poolA=units(40).toString();f.round.poolB=units(60).toString();f.round.distributable=units(99).toString();f.round.entries.a={amount:units(10).toString(),side:0,claimed:false};f.state.fees=units(1).toString();assert.equal(d.payout(f.round,'a'),units('24.75'));d.claim(f.state,f.round,'a');assert.equal(f.state.fees,units(1).toString());
});
