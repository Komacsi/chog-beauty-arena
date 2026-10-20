import {toUtf8String} from 'ethers';
import {openBallot,drandClient} from './timelock.mjs';

export async function processRound({arena,provider,fromBlock,client=drandClient(),id:requestedId,receiptTimeoutMs=30000,interruptedThroughRound=0}){
  const id=requestedId ?? Number(await arena.currentRoundId());if(!id)return {phase:'none'};
  const round=await arena.getRound(id);if(round.settled)return {phase:'settled'};
  if(id<=interruptedThroughRound){await(await arena.settle(id)).wait(1,receiptTimeoutMs);return {phase:'refunded',id};}
  const block=await provider.getBlock('latest');const now=Number(block.timestamp);
  if(now<Number(round.unlockAt))return {phase:'waiting',id};
  const {chainId}=await provider.getNetwork();let revealed=0,failed=0;
  if(now<Number(round.revealEndsAt)){
    const to=await provider.getBlockNumber();
    // Public Monad RPC rejects a range larger than 100 blocks (HTTP 413).
    for(let start=fromBlock;start<=to;start+=100){
      const logs=await arena.queryFilter(arena.filters.VoteCommitted(id),start,Math.min(to,start+99));
      if(arena.filters.HolderVotesCommitted)logs.push(...await arena.queryFilter(arena.filters.HolderVotesCommitted(id),start,Math.min(to,start+99)));
      logs.sort((a,b)=>(a.blockNumber || 0)-(b.blockNumber || 0) || (a.index || 0)-(b.index || 0));
      for(const log of logs){
        const account=log.args.account,isHolder=log.args.holderKey!==undefined;
        const e=isHolder?await arena.holderEntries(id,log.args.holderKey):await arena.entries(id,account);if(e.revealed)continue;
        const weight=isHolder?Number(e.weight):1;
        try{
          const ballot=await openBallot(toUtf8String(log.args.sealedChoice),{arena:await arena.getAddress(),chainId,roundId:id,account,amount:isHolder?0:e.amount,commitment:e.commitment,beaconRound:Number(round.beaconRound),nftA:Number(round.nftA),nftB:Number(round.nftB),...(isHolder?{holderKey:log.args.holderKey,holderTokenIdsHash:e.tokenIdsHash}:{})},Number(round.unlockAt)*1000,client);
          // Simulate before paying gas, including the current onchain reveal deadline.
          const method=isHolder?arena.revealHolderVotes:arena.revealVote,args=[id,isHolder?log.args.holderKey:account,ballot.side,ballot.tokenId,ballot.salt];
          await method.staticCall(...args);
          await(await method(...args)).wait(1,receiptTimeoutMs);revealed+=weight;
        }catch(error){
          failed+=weight;
          // A receipt timeout does not cancel a broadcast transaction. Move on to
          // other matches; the next cycle rechecks onchain state before retrying.
          if(error.code==='TIMEOUT')return {phase:'pending',id,revealed,failed};
        }
      }
    }
  }
  const latest=await arena.getRound(id),lastBlock=await provider.getBlock('latest');
  if(latest.revealedCount===latest.committedCount || Number(lastBlock.timestamp)>=Number(latest.revealEndsAt)){
    await(await arena.settle(id)).wait(1,receiptTimeoutMs);return {phase:'settled',id,revealed,failed};
  }
  return {phase:'opening',id,revealed,failed};
}

// Keep processing older matches even when a more recent match is still accepting votes.
export async function processRounds(options){
  if(options.expectedRevealer && (await options.arena.revealer()).toLowerCase()!==options.expectedRevealer.toLowerCase())return [{phase:'revoked'}];
  const interruptedThroughRound=Number(await options.arena.interruptedThroughRound());
  const count=Number(await options.arena.currentRoundId()),results=[];
  for(let id=1;id<=count;id++){
    try{if((await options.arena.getRound(id)).settled)continue;results.push(await processRound({...options,id,interruptedThroughRound}));}
    catch{results.push({id,phase:'retry'});}
  }
  return results;
}
