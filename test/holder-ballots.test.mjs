import test from 'node:test';
import assert from 'node:assert/strict';
import {holderTokensHash,makeHolderCommitment,normalizeHolderTokens} from '../lib/holder-ballots.mjs';
import {makeCommitment} from '../lib/commitments.mjs';
const ballot={arena:'0x1111111111111111111111111111111111111111',chainId:143,roundId:1,account:'0x2222222222222222222222222222222222222222',side:0,tokenId:299,holderTokenIdsHash:holderTokensHash([1,2,3,4,5]),salt:'0x'+'ab'.repeat(32)};
test('NFT selection is canonical, unique and bounded, including a valid zero token ID',()=>{
  assert.deepEqual(normalizeHolderTokens([5,0,2]),[0,2,5]);
  assert.equal(holderTokensHash([5,2,0]),holderTokensHash([0,2,5]));
  for(const ids of [[],[1,1],[-1],[1.5],['1'],Array.from({length:51},(_,i)=>i)])assert.throws(()=>normalizeHolderTokens(ids));
});
test('NFT ballot commits to the exact selected tokens, voter, battle, chain, arena and contender',()=>{
  const original=makeHolderCommitment(ballot);
  for(const change of [{holderTokenIdsHash:holderTokensHash([1,2])},{roundId:2},{chainId:144},{account:ballot.arena},{arena:ballot.account},{side:1},{tokenId:379},{salt:'0x'+'cd'.repeat(32)}])assert.notEqual(makeHolderCommitment({...ballot,...change}),original);
  const {holderTokenIdsHash,...paid}=ballot;assert.notEqual(original,makeCommitment({...paid,amount:0}));
  assert.throws(()=>makeHolderCommitment({...ballot,amount:1}),/cannot contain/);
});
