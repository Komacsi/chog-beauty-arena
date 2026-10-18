import test from 'node:test';
import assert from 'node:assert/strict';
import {leaderboard,drawTotals} from '../lib/leaderboard.mjs';
test('leaderboard excludes 0–0, includes losses-only NFTs and orders by total wins',()=>{
  const nfts=[1,2,3,4,5].map(tokenId=>({tokenId,name:'NFT '+tokenId}));
  const rows=leaderboard(nfts,{1:2,2:5,4:2},{1:3,3:7});
  assert.deepEqual(rows.map(n=>[n.tokenId,n.wins,n.losses,n.rank]),[[2,5,0,1],[1,2,3,2],[4,2,0,3],[3,0,7,4]]);
  assert.equal(nfts.length,5);assert.deepEqual(leaderboard(nfts),[]);
});
test('draws-only NFTs are visible and wins remain the primary sort order',()=>{
  const rows=leaderboard([1,2,3].map(tokenId=>({tokenId})),{2:1},{},{1:5});
  assert.deepEqual(rows.map(n=>[n.tokenId,n.wins,n.losses,n.draws]),[[2,1,0,0],[1,0,0,5]]);
});
test('historical draw totals include only finalized ties with more than one vote',()=>{
  const base={settled:true,winner:2,nftA:1,nftB:2,votesA:1,votesB:1};
  const rounds=[base,{...base,votesA:2,votesB:2},{...base,votesA:0,votesB:0},{...base,cancelled:true},{...base,settled:false},{...base,winner:0,votesA:2}];
  assert.deepEqual(drawTotals(rounds),{1:2,2:2});assert.equal(rounds[0].winner,2);
});
