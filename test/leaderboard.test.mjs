import test from 'node:test';
import assert from 'node:assert/strict';
import {leaderboard} from '../lib/leaderboard.mjs';
test('leaderboard excludes 0–0, includes losses-only NFTs and orders by total wins',()=>{
  const nfts=[1,2,3,4,5].map(tokenId=>({tokenId,name:'NFT '+tokenId}));
  const rows=leaderboard(nfts,{1:2,2:5,4:2},{1:3,3:7});
  assert.deepEqual(rows.map(n=>[n.tokenId,n.wins,n.losses,n.rank]),[[2,5,0,1],[1,2,3,2],[4,2,0,3],[3,0,7,4]]);
  assert.equal(nfts.length,5);assert.deepEqual(leaderboard(nfts),[]);
});
