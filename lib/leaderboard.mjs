export function leaderboard(nfts,wins={},losses={}){
  return nfts.map(n=>({...n,wins:wins[n.tokenId] || 0,losses:losses[n.tokenId] || 0}))
    .filter(n=>n.wins>0 || n.losses>0)
    .sort((a,b)=>b.wins-a.wins || a.tokenId-b.tokenId)
    .map((n,i)=>({...n,rank:i+1}));
}
