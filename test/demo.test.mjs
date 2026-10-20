import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import * as d from '../lib/demo.mjs';
import {makeCommitment,makeSalt,DEMO_ARENA} from '../lib/commitments.mjs';
// Monetary fixture values below are lots of 1,000 CHOG.
const lots=n=>parseUnits(String(Number(n)*1000),18);
// Historical v4 settlement remains unchanged after the voting upgrade.
function fixture(){
  const state=d.createState(),now=Date.now(),ballots=new Map();state.ownership[1090]=d.user(state,'host').address;state.ownership[1233]=d.user(state,'opponent').address;
  const request=d.createChallenge(state,'host',1090,now),round=d.acceptChallenge(state,'opponent',request.id,1233,now);
  round.protocolVersion=4;
  function commit(id,side,amount){const ballot={arena:DEMO_ARENA,chainId:143,roundId:round.id,account:d.user(state,id).address,side,tokenId:side?round.nftB:round.nftA,amount:amount.toString(),salt:makeSalt()};d.commitVote(state,id,{commitment:makeCommitment(ballot),sealedChoice:'opaque ciphertext',amount},now);ballots.set(id,ballot);return ballot;}
  function reveal(id){d.revealVote(state,id,ballots.get(id),round.unlockAt);}
  function finish(){for(const id of ballots.keys())reveal(id);d.settle(state,round,round.unlockAt);}
  return {state,round,commit,reveal,finish,ballots,now};
}
test('demo stores no plaintext side or salt before opening',()=>{
  const f=fixture();f.commit('a',1,lots(100));const e=f.round.entries.a;assert.equal(e.side,undefined);assert.equal(e.salt,undefined);assert.equal(f.round.poolA,'0');assert.equal(f.round.poolB,'0');assert.equal(f.round.votesA,0);assert.equal(f.round.votesB,0);assert.equal(f.round.totalCommitted,lots(100).toString());
});
test('legacy v4: one participation per wallet; holders choose a bet and non-holders must bet',()=>{
  const f=fixture();d.user(f.state,'visitor').holder=false;assert.throws(()=>f.commit('visitor',0,0n),/bet is required/);f.commit('holder',0,0n);f.commit('visitor',1,lots(5));assert.throws(()=>f.commit('holder',1,lots(1)),/Already voted/);
});
test('early reveals, late commits and mismatched choices are rejected',()=>{
  const f=fixture(),ballot=f.commit('a',0,lots(10));assert.throws(()=>d.revealVote(f.state,'a',ballot,f.now),/Not revealing/);
  assert.throws(()=>d.commitVote(f.state,'b',{commitment:makeCommitment(ballot),sealedChoice:'opaque',amount:1n},f.round.endsAt),/closed/);
  assert.throws(()=>d.revealVote(f.state,'a',{...ballot,side:1,tokenId:f.round.nftB},f.round.unlockAt),/mismatch/);f.reveal('a');assert.throws(()=>f.reveal('a'),/Invalid reveal/);
});
test('gross payout first, then individual 1% fees on claiming',()=>{
  const f=fixture();f.commit('a',0,lots(10));f.commit('b',0,lots(30));f.commit('c',1,lots(60));f.finish();
  assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:lots(25),fee:lots('0.25'),amount:lots('24.75')});assert.equal(d.payout(f.round,'b'),lots('74.25'));assert.equal(d.payout(f.round,'c'),0n);assert.equal(f.state.fees,'0');
  d.claim(f.state,f.round,'a');d.claim(f.state,f.round,'b');assert.equal(f.state.fees,lots(1).toString());assert.throws(()=>d.claim(f.state,f.round,'a'),/Nothing/);assert.equal(f.state.points[f.round.nftA],1);assert.equal(f.state.losses[f.round.nftB],1);
});
test('ties refund stakes and record one draw for both NFTs without fees or wins',()=>{const f=fixture();f.commit('a',0,lots(10));f.commit('b',1,lots(30));f.finish();assert.equal(d.payout(f.round,'a'),lots(10));assert.equal(d.payout(f.round,'b'),lots(30));assert.equal(f.state.fees,'0');assert.deepEqual(f.state.points,{});assert.deepEqual(f.state.draws,{[f.round.nftA]:1,[f.round.nftB]:1});d.settle(f.state,f.round,f.round.unlockAt);assert.equal(f.state.draws[f.round.nftA],1);});
test('empty rounds do not count as draws; unstaked votes still qualify',()=>{
  const empty=fixture();empty.finish();assert.deepEqual(empty.state.draws,{});
  const f=fixture();f.commit('a',0,0n);f.commit('b',1,0n);f.finish();assert.equal(f.state.draws[f.round.nftA],1);assert.equal(f.state.draws[f.round.nftB],1);
});
for(const side of [0,1])test(`one-sided bank with winner ${side} returns each stake in full`,()=>{const f=fixture();f.commit('a',side,lots(10));f.commit('b',side,lots(30));f.commit('c',1-side,0n);f.finish();assert.equal(d.payout(f.round,'a'),lots(10));assert.equal(d.payout(f.round,'b'),lots(30));assert.equal(f.state.fees,'0');assert.equal(f.round.winner,side);});
test('unstaked winners return losing-side stakes without fees',()=>{const f=fixture();f.commit('a',0,0n);f.commit('b',0,0n);f.commit('c',1,lots(100));f.finish();assert.equal(d.payout(f.round,'c'),lots(100));assert.equal(f.state.points[f.round.nftA],1);});
test('incomplete opening refunds unopened bets and resolves only the valid votes',()=>{
  const f=fixture();f.commit('a',0,lots(10));f.commit('b',1,lots(30));f.reveal('a');assert.throws(()=>d.settle(f.state,f.round,f.round.unlockAt),/incomplete/);d.settle(f.state,f.round,f.round.revealEndsAt);
  assert.notEqual(f.round.cancelled,true);assert.equal(f.state.points[f.round.nftA],1);assert.deepEqual(f.state.draws,{});assert.equal(d.payout(f.round,'a'),lots(10));assert.equal(d.payout(f.round,'b'),lots(30));assert.equal(f.state.fees,'0');
});
test('per-winner rounding differs from deducting a fee from the common pool',()=>{
  const f=fixture(),minimum=parseUnits('5000',18),stake=minimum+17n;
  f.commit('a',0,stake);f.commit('b',0,2n*stake);f.commit('c',1,3n*stake);f.finish();
  const a=d.payoutBreakdown(f.round,'a'),b=d.payoutBreakdown(f.round,'b');
  assert.deepEqual(a,{gross:2n*stake,fee:2n*minimum/100n,amount:2n*stake-2n*minimum/100n});
  assert.deepEqual(b,{gross:4n*stake,fee:4n*minimum/100n,amount:4n*stake-4n*minimum/100n});
  assert.equal((a.gross+b.gross)/100n,a.fee+b.fee+1n);
});

test('excluded funded demo entries are refunded outside the winners bank, with no fees',()=>{
  const f=fixture();f.commit('a',0,lots(10));f.commit('b',0,lots(30));f.commit('c',1,lots(60));f.commit('bad',1,lots(20));
  for(const id of ['a','b','c'])f.reveal(id);d.settle(f.state,f.round,f.round.revealEndsAt);
  assert.equal(f.round.winner,0);assert.deepEqual(d.payoutBreakdown(f.round,'bad'),{gross:lots(20),fee:0n,amount:lots(20)});
  assert.equal(d.payout(f.round,'a'),lots('24.75'));assert.equal(d.payout(f.round,'b'),lots('74.25'));assert.equal(d.payout(f.round,'c'),0n);
  for(const id of ['bad','a','b'])d.claim(f.state,f.round,id);assert.equal(f.state.fees,lots(1).toString());
});

test('legacy v3 unfinished demo rounds retain cancellation and refund rules',()=>{
  const f=fixture();f.round.protocolVersion=3;f.commit('a',0,lots(10));f.commit('b',1,lots(20));f.reveal('a');d.settle(f.state,f.round,f.round.revealEndsAt);
  assert.equal(f.round.cancelled,true);assert.deepEqual(f.state.points,{});assert.equal(d.payout(f.round,'a'),lots(10));assert.equal(d.payout(f.round,'b'),lots(20));
});
test('historical settled records keep their recorded payouts and fees',()=>{
  const f=fixture();f.round.protocolVersion=1;f.round.revealEndsAt=undefined;f.round.settled=true;f.round.refund=false;f.round.winner=0;f.round.poolA=lots(40).toString();f.round.poolB=lots(60).toString();f.round.distributable=lots(99).toString();f.round.entries.a={amount:lots(10).toString(),side:0,claimed:false};f.state.fees=lots(1).toString();assert.equal(d.payout(f.round,'a'),lots('24.75'));d.claim(f.state,f.round,'a');assert.equal(f.state.fees,lots(1).toString());
});

test('demo minimum rejects subminimum stakes without debiting balances; migration preserves history and runs once',()=>{
  const f=fixture(),minimum=parseUnits('5000',18),before=d.user(f.state,'a').balance;
  for(const amount of [1n,minimum-1n])assert.throws(()=>f.commit('a',0,amount),/Minimum bet/);
  assert.equal(d.user(f.state,'a').balance,before);assert.equal(f.round.committedCount,0);
  f.commit('a',0,minimum);f.commit('b',1,minimum+1n);
  const old={...d.createState(),minStakeVersion:undefined,users:{a:{balance:'123',holder:true}},rounds:[{settled:true,poolA:'500',poolB:'600',winner:0}]};
  const history=JSON.stringify(old.rounds);assert.equal(d.migrateMinimumStake(old),true);
  assert.equal(old.users.a.balance,(parseUnits('99000',18)+123n).toString());
  const credited=old.users.a.balance;assert.equal(d.migrateMinimumStake(old),false);assert.equal(old.users.a.balance,credited);assert.equal(JSON.stringify(old.rounds),history);
});
