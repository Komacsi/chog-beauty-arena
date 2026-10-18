export function leaderboard(nfts,wins={},losses={},draws={}){
  return nfts.map(n=>({...n,wins:wins[n.tokenId] || 0,losses:losses[n.tokenId] || 0,draws:draws[n.tokenId] || 0}))
    .filter(n=>n.wins>0 || n.losses>0 || n.draws>0)
    .sort((a,b)=>b.wins-a.wins || a.tokenId-b.tokenId)
    .map((n,i)=>({...n,rank:i+1}));
}
// Used to backfill persisted demo history and aggregate live finalized rounds.
export function drawTotals(rounds){
  const draws={};
  for(const r of rounds)if(r.settled && !r.cancelled && r.winner===2 && Number(r.votesA)+Number(r.votesB)>1){
    for(const token of [r.nftA,r.nftB])draws[token]=(draws[token] || 0)+1;
  }
  return draws;
}
