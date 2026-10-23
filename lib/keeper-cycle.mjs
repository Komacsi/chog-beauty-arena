import {toUtf8String} from 'ethers';
import {openBallot} from './timelock.mjs';

// Production path: bounded, durable queue; the old processRound helper is for isolated tests.
export async function keeperCycle({arena,provider,index,transactions,client,expectedRevealer,chainId,maxRounds=5,maxEntries=10,maxCycleMs=10000,now=Date.now}){
  const started=now(),results=[];
  const [revealer,cutoff,head]=await Promise.all([arena.revealer(),arena.interruptedThroughRound(),provider.getBlock('latest')]);
  if(revealer.toLowerCase()!==expectedRevealer.toLowerCase())return {phase:'revoked',results};
  if(!head || Math.abs(now()/1000-Number(head.timestamp))>120)throw Error('Stale RPC clock; keeper will not send');
  const sync=await index.sync({provider,arena});
  if(sync.backlogBlocks)return {phase:'indexing',sync,results};
  const recovered=await transactions.recover();
  if(!['idle','confirmed','reverted'].includes(recovered.phase))return {phase:recovered.phase,sync,transaction:recovered,results};
  let processed=0;
  const send=async(operation,request)=>{
    try{return await transactions.send(operation,request);}catch(error){error.keeperSigningFailure=true;throw error;}
  };
  for(const id of index.ready(Number(head.timestamp),Number(cutoff),maxRounds)){
    if(now()-started>=maxCycleMs || processed>=maxEntries)break;
    index.touch(id,now());
    try{
      let r=await arena.getRound(id);
      if(r.settled){results.push({id,phase:'awaiting-index'});continue;}
      const settle=async()=>{
        await arena.settle.staticCall(id);
        // Check role immediately before signing as well as at cycle start.
        if((await arena.revealer()).toLowerCase()!==expectedRevealer.toLowerCase())throw Error('Keeper revoked during cycle');
        return send('settle:'+id,await arena.settle.populateTransaction(id));
      };
      if(id<=Number(cutoff) || Number(head.timestamp)>=Number(r.revealEndsAt) || r.revealedCount===r.committedCount){
        return {phase:'pending',sync,results,transaction:await settle()};
      }
      for(const entry of index.ballots(id,Math.floor(now()/1000),maxEntries-processed)){
        if(now()-started>=maxCycleMs)break;
        processed++;index.attempted(entry.key,Math.floor(now()/1000));
        try{
          const holder=entry.kind==='holder',e=holder?await arena.holderEntries(id,entry.number):await arena.bets(id,entry.account,entry.number);
          if(e.revealed)continue; // Only confirmed events permanently remove queue entries.
          const ballot=await openBallot(toUtf8String(entry.ciphertext),{arena:await arena.getAddress(),chainId,roundId:id,account:entry.account,amount:holder?0:e.amount,commitment:e.commitment,beaconRound:Number(r.beaconRound),nftA:Number(r.nftA),nftB:Number(r.nftB),...(holder?{holderKey:entry.number,holderTokenIdsHash:e.tokenIdsHash}:{betNonce:entry.number})},Number(r.unlockAt)*1000,client,now());
          const method=holder?arena.revealHolderVotes:arena.revealVote,args=holder?[id,entry.number,ballot.side,ballot.tokenId,ballot.salt]:[id,entry.account,entry.number,ballot.side,ballot.tokenId,ballot.salt];
          await method.staticCall(...args);
          if((await arena.revealer()).toLowerCase()!==expectedRevealer.toLowerCase())return {phase:'revoked',sync,results};
          return {phase:'pending',sync,results,transaction:await send(entry.key,await method.populateTransaction(...args))};
        }catch(error){
          // A broadcast failure has a durable pending intent. Never move to a new nonce.
          if(transactions.pending())return {phase:'pending',sync,results};
          if(error.keeperSigningFailure)throw error;
          results.push({id,phase:'retry-entry'});
        }
      }
      results.push({id,phase:'opening'});
    }catch(error){if(transactions.pending())return {phase:'pending',sync,results};if(error.keeperSigningFailure)throw error;results.push({id,phase:'retry-round'});}
  }
  return {phase:'ready',sync,processed,results};
}
