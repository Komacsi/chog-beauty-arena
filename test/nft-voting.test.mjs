import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import * as d from '../lib/demo.mjs';
import {holderTokensHash} from '../lib/holder-ballots.mjs';
import {makeCommitment,makeSalt,DEMO_ARENA} from '../lib/commitments.mjs';
const amount=parseUnits('5000',18);
function fixture(){
  const state=d.createState(),now=Date.now(),account=d.user(state,'a').address,opponent=d.user(state,'b').address;
  for(let id=0;id<56;id++)state.ownership[id]=account;state.ownership[100]=opponent;
  d.createChallenge(state,'a',1,now);const round=d.acceptChallenge(state,'b',1,100,now,true);
  const base=(id,side)=>({arena:DEMO_ARENA,chainId:143,roundId:1,account:d.user(state,id).address,side,tokenId:side?100:1,salt:makeSalt()});
  function holder(id,side,tokenIds){const b={...base(id,side),amount:'0',holderKey:Math.min(...tokenIds),holderTokenIdsHash:holderTokensHash(tokenIds)};d.commitHolderVotes(state,id,{roundId:1,tokenIds,commitment:makeCommitment(b),sealedChoice:'opaque'},now);return b;}
  function paid(id,side,value=amount){const b={...base(id,side),amount:value.toString(),betNonce:d.nextBetNonce(round,id)};d.commitVote(state,id,{roundId:1,betNonce:b.betNonce,amount:value,commitment:makeCommitment(b),sealedChoice:'opaque'},now);return b;}
  return {state,round,now,holder,paid};
}
test('demo has no five-NFT cap; batches can back different sides without moving NFTs',()=>{
  const f=fixture(),a=f.holder('a',0,Array.from({length:50},(_,i)=>i)),b=f.holder('a',1,[50,51,52,53,54,55]);
  d.revealHolderVotes(f.state,'a',a,f.round.unlockAt);d.revealHolderVotes(f.state,'a',b,f.round.unlockAt);d.settle(f.state,f.round,f.round.unlockAt);
  assert.equal(f.round.votesA,50);assert.equal(f.round.votesB,6);assert.equal(Object.keys(f.round.usedNfts).length,56);assert.equal(d.ownedTokens(f.state,'a').length,56);assert.equal(f.state.users.a.balance,parseUnits('100000',18).toString());
});
test('demo rejects reused or unowned NFT batches atomically, even after a transfer',()=>{
  const f=fixture();assert.throws(()=>f.holder('a',0,[0,100]),/owner/);assert.deepEqual(f.round.usedNfts,{});
  f.holder('a',0,[0]);f.state.ownership[0]=d.user(f.state,'b').address;assert.throws(()=>f.holder('b',1,[0]),/already used/);assert.equal(f.round.committedCount,1);
});
test('mixed demo votes and repeated bets preserve one paid vote and a single aggregate payout',()=>{
  const f=fixture(),a=f.holder('a',0,[0,1]),b=f.holder('a',1,[2]),bets=[f.paid('a',0),f.paid('a',1),f.paid('a',0),f.paid('b',1)];
  d.revealHolderVotes(f.state,'a',a,f.round.unlockAt);d.revealHolderVotes(f.state,'a',b,f.round.unlockAt);
  for(const ballot of bets)d.revealVote(f.state,ballot.account===f.state.users.a.address?'a':'b',ballot,f.round.unlockAt);
  assert.equal(f.round.votesA,3);assert.equal(f.round.votesB,2);assert.equal(f.round.poolA,2n*amount+'');assert.equal(f.round.poolB,2n*amount+'');
  d.settle(f.state,f.round,f.round.unlockAt);assert.equal(d.claimsFor(f.state,'a').length,1);
  assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:4n*amount,fee:amount/25n,amount:4n*amount-amount/25n});d.claim(f.state,f.round,'a');assert.throws(()=>d.claim(f.state,f.round,'a'),/Nothing/);
  assert.equal(d.payout(f.round,'a'),0n);assert.equal(f.state.fees,amount/25n+'');
});
test('a broken first bet cannot grant its paid vote to a subsequent bet and delays settlement until the deadline',()=>{
  const f=fixture();f.paid('a',0);const later=f.paid('a',1);d.revealVote(f.state,'a',later,f.round.unlockAt);
  assert.equal(f.round.votesB,0);assert.throws(()=>d.settle(f.state,f.round,f.round.unlockAt),/incomplete/);
  d.settle(f.state,f.round,f.round.revealEndsAt);assert.equal(d.claimsFor(f.state,'a').length,1);assert.equal(d.payout(f.round,'a'),2n*amount);assert.deepEqual(f.state.draws,{});
});
test('unfinished v6 rounds migrate to aggregate payouts while settled v6 claims remain unchanged',()=>{
  const f=fixture();f.round.protocolVersion=6;const a=f.paid('a',0),b=f.paid('a',0),c=f.paid('b',1);d.revealVote(f.state,'a',a,f.round.unlockAt);
  assert.equal(d.migrateAggregatePayouts(f.state),true);assert.equal(f.round.protocolVersion,7);assert.equal(f.round.walletBanks.a.total,2n*amount+'');assert.equal(f.round.walletBanks.a.amountA,amount+'');assert.equal(d.migrateAggregatePayouts(f.state),false);
  d.revealVote(f.state,'a',b,f.round.unlockAt);d.revealVote(f.state,'b',c,f.round.unlockAt);d.settle(f.state,f.round,f.round.unlockAt);
  assert.equal(d.claimsFor(f.state,'a').length,1);
  const historical=fixture();historical.round.protocolVersion=6;const bets=[historical.paid('a',0),historical.paid('a',0),historical.paid('b',1)];
  for(const ballot of bets)d.revealVote(historical.state,ballot.account===historical.state.users.a.address?'a':'b',ballot,historical.round.unlockAt);d.settle(historical.state,historical.round,historical.round.unlockAt);
  const before=structuredClone(historical.state);assert.equal(d.migrateAggregatePayouts(historical.state),false);assert.deepEqual(historical.state,before);assert.equal(d.claimsFor(historical.state,'a').length,2);
  d.claim(historical.state,historical.round,'a',0);d.claim(historical.state,historical.round,'a',1);assert.equal(d.claimsFor(historical.state,'a').length,0);
});
test('demo rounds the aggregate winning amount once and charges one aggregate fee',()=>{
  const f=fixture(),a=amount+49n,bets=[['a',f.paid('a',0,a)],['a',f.paid('a',0,a)],['b',f.paid('b',0,a)],['c',f.paid('c',1,3n*a+2n)]];
  for(const [id,b]of bets)d.revealVote(f.state,id,b,f.round.unlockAt);d.settle(f.state,f.round,f.round.unlockAt);
  assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:4n*amount+197n,fee:4n*amount/100n+1n,amount:4n*amount+196n-4n*amount/100n});
  assert.equal(d.claimsFor(f.state,'a').length,1);d.claim(f.state,f.round,'a');assert.equal(d.claimsFor(f.state,'a').length,0);assert.throws(()=>d.claim(f.state,f.round,'a'),/Nothing/);
});
test('demo preserves exact fractional deposits and returns their complete sum on a draw',()=>{
  const f=fixture(),before=f.state.users.a.balance,bets=[['a',f.paid('a',0,amount+1n)],['a',f.paid('a',1,amount+2n)],['b',f.paid('b',1,amount+3n)]];
  assert.equal(f.round.walletBanks.a.total,2n*amount+3n+'');for(const [id,b]of bets)d.revealVote(f.state,id,b,f.round.unlockAt);d.settle(f.state,f.round,f.round.unlockAt);
  assert.deepEqual(d.payoutBreakdown(f.round,'a'),{gross:2n*amount+3n,fee:0n,amount:2n*amount+3n});d.claim(f.state,f.round,'a');assert.equal(f.state.users.a.balance,before);
});
