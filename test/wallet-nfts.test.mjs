import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverOwnedChogs,CHOG_COLLECTION} from '../lib/wallet-nfts.mjs';
const account='0x1111111111111111111111111111111111111111';
function fixture(ids=[6n,32n,53n,299n,942n,1445n]){const calls=[];return {calls,collection:{getAddress:async()=>CHOG_COLLECTION,tokensOfOwner:async(...args)=>{calls.push(['tokens',...args]);return ids;},balanceOf:async(...args)=>{calls.push(['balance',...args]);return BigInt(ids.length);}}};}
test('discovers every owned Chog outside the sample without querying artwork or scanning token IDs',async()=>{
  const f=fixture();assert.deepEqual(await discoverOwnedChogs({...f,account,blockTag:123}),[6,32,53,299,942,1445]);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c[2].blockTag===123));
});
test('empty wallets need no artwork or individual ownership requests',async()=>{const f=fixture([]);assert.deepEqual(await discoverOwnedChogs({...f,account,blockTag:10}),[]);});
test('discovery rejects wrong collection, incomplete lists, duplicate IDs and a changed wallet',async()=>{
  const wrong=fixture();wrong.collection.getAddress=async()=>account;await assert.rejects(discoverOwnedChogs({...wrong,account}),/collection/);assert.equal(wrong.calls.length,0);
  const missing=fixture();missing.collection.balanceOf=async()=>7n;await assert.rejects(discoverOwnedChogs({...missing,account}),/Incomplete/);
  for(const ids of [[1n,1n],[0n],[1970n]])await assert.rejects(discoverOwnedChogs({...fixture(ids),account}),/Invalid/);
  let checks=0;await assert.rejects(discoverOwnedChogs({...fixture(),account,assertWallet:async()=>{if(++checks===2)throw Error('Wallet changed');}}),/Wallet changed/);
});
