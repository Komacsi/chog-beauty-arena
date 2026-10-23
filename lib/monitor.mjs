// Read-only health checks. No signer, keys, transaction submission or game API.
export function roundAlerts(id,round,now,cutoff=0){
  if(round.settled)return [];
  if(id<=cutoff)return [{code:'REFUND_PENDING',round:id}];
  if(now>=Number(round.revealEndsAt))return [{code:'SETTLEMENT_PENDING',round:id}];
  if(now>=Number(round.unlockAt) && Number(round.revealEndsAt)-now<=300 && round.revealedCount<round.committedCount)return [{code:'REVEAL_DEADLINE_NEAR',round:id,missing:String(round.committedCount-round.revealedCount)}];
  return [];
}
export async function monitorArena({arena,provider,validateGovernance,minimumGas,now=Math.floor(Date.now()/1000),maxRounds=200,includeRounds=true}){
  if(!Number.isSafeInteger(maxRounds) || maxRounds<1 || maxRounds>1000)throw Error('Monitor round limit must be 1..1000');
  const [revealer,owner,count,cutoff,block]=await Promise.all([arena.revealer(),arena.owner(),arena.currentRoundId(),arena.interruptedThroughRound(),provider.getBlock('latest')]);
  const alerts=[];
  if(!block || now-Number(block.timestamp)>120)alerts.push({code:'RPC_STALE'});
  try{await validateGovernance(provider,owner);}catch{alerts.push({code:'GOVERNANCE_CONFIGURATION'});}
  if(/^0x0+$/.test(revealer))alerts.push({code:'KEEPER_REVOKED'});
  else if(await provider.getBalance(revealer)<minimumGas)alerts.push({code:'KEEPER_LOW_MON'});
  if(!includeRounds)return {checkedAt:new Date(now*1000).toISOString(),revealer,governance:owner,checkedRounds:0,alerts};
  const total=Number(count),start=Math.max(1,total-maxRounds+1);
  if(start>1)alerts.push({code:'COVERAGE_LIMIT',uncheckedBefore:start});
  for(let id=start;id<=total;id++)alerts.push(...roundAlerts(id,await arena.getRound(id),now,Number(cutoff)));
  return {checkedAt:new Date(now*1000).toISOString(),revealer,governance:owner,checkedRounds:Math.min(total,maxRounds),alerts};
}
