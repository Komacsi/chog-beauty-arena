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
  function paid(id,side){const b={...base(id,side),amount:amount.toString(),betNonce:d.nextBetNonce(round,id)};d.commitVote(state,id,{roundId:1,betNonce:b.betNonce,amount,commitment:makeCommitment(b),sealedChoice:'opaque'},now);return b;}
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
test('mixed demo votes and repeated bets preserve one paid vote, independent claims and gross-first fees',()=>{
  const f=fixture(),a=f.holder('a',0,[0,1]),b=f.holder('a',1,[2]),bets=[f.paid('a',0),f.paid('a',1),f.paid('a',0),f.paid('b',1)];
  d.revealHolderVotes(f.state,'a',a,f.round.unlockAt);d.revealHolderVotes(f.state,'a',b,f.round.unlockAt);
  for(const ballot of bets)d.revealVote(f.state,ballot.account===f.state.users.a.address?'a':'b',ballot,f.round.unlockAt);
  assert.equal(f.round.votesA,3);assert.equal(f.round.votesB,2);assert.equal(f.round.poolA,2n*amount+'');assert.equal(f.round.poolB,2n*amount+'');
  d.settle(f.state,f.round,f.round.unlockAt);assert.equal(d.claimsFor(f.state,'a').length,2);
  for(const nonce of [0,2]){assert.deepEqual(d.payoutBreakdown(f.round,'a',nonce),{gross:2n*amount,fee:amount/50n,amount:2n*amount-amount/50n});d.claim(f.state,f.round,'a',nonce);assert.throws(()=>d.claim(f.state,f.round,'a',nonce),/Nothing/);}
  assert.equal(d.payout(f.round,'a',1),0n);assert.equal(f.state.fees,amount/25n+'');
});
test('a broken first bet cannot grant its paid vote to a subsequent bet and delays settlement until the deadline',()=>{
  const f=fixture();f.paid('a',0);const later=f.paid('a',1);d.revealVote(f.state,'a',later,f.round.unlockAt);
  assert.equal(f.round.votesB,0);assert.throws(()=>d.settle(f.state,f.round,f.round.unlockAt),/incomplete/);
  d.settle(f.state,f.round,f.round.revealEndsAt);assert.equal(d.claimsFor(f.state,'a').length,2);assert.equal(d.payout(f.round,'a',0),amount);assert.equal(d.payout(f.round,'a',1),amount);assert.deepEqual(f.state.draws,{});
});
