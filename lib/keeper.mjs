import {toUtf8String} from 'ethers';
import {openBallot,drandClient} from './timelock.mjs';

export async function processRound({arena,provider,fromBlock,client=drandClient(),id:requestedId}){
  const id=requestedId ?? Number(await arena.currentRoundId());if(!id)return {phase:'none'};
  const round=await arena.getRound(id);if(round.settled)return {phase:'settled'};
  const block=await provider.getBlock('latest');const now=Number(block.timestamp);
  if(now<Number(round.unlockAt))return {phase:'waiting',id};
  const {chainId}=await provider.getNetwork();let revealed=0,failed=0;
  if(now<Number(round.revealEndsAt)){
    const to=await provider.getBlockNumber();
    for(let start=fromBlock;start<=to;start+=500){
      const logs=await arena.queryFilter(arena.filters.VoteCommitted(id),start,Math.min(to,start+499));
      for(const log of logs){
        const account=log.args.account,e=await arena.entries(id,account);if(e.revealed)continue;
        try{
          const ballot=await openBallot(toUtf8String(log.args.sealedChoice),{arena:await arena.getAddress(),chainId,roundId:id,account,amount:e.amount,commitment:e.commitment},Number(round.unlockAt)*1000,client);
          await(await arena.revealVote(id,account,ballot.side,ballot.tokenId,ballot.salt)).wait();revealed++;
        }catch{failed++;}
      }
    }
  }
  const latest=await arena.getRound(id),lastBlock=await provider.getBlock('latest');
  if(latest.revealedCount===latest.committedCount || Number(lastBlock.timestamp)>=Number(latest.revealEndsAt)){
    await(await arena.settle(id)).wait();return {phase:'settled',id,revealed,failed};
  }
  return {phase:'opening',id,revealed,failed};
}

// Keep processing older matches even when a more recent match is still accepting votes.
export async function processRounds(options){
  const count=Number(await options.arena.currentRoundId()),results=[];
  for(let id=1;id<=count;id++){
    try{if((await options.arena.getRound(id)).settled)continue;results.push(await processRound({...options,id}));}
    catch{results.push({id,phase:'retry'});}
  }
  return results;
}
