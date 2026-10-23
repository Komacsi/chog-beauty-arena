// Offline timing model around the real keeper/index/journal/crypto, not a chain emulator.
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Transaction,Interface,hexlify,toUtf8Bytes,keccak256} from 'ethers';
import {ChainIndex} from '../lib/chain-index.mjs';
import {KeeperTransactions} from '../lib/keeper-transactions.mjs';
import {keeperCycle} from '../lib/keeper-cycle.mjs';
import {makeCommitment} from '../lib/commitments.mjs';
import {sealBallot} from '../lib/timelock.mjs';
export const loadArena='0x2222222222222222222222222222222222222222',loadAccount='0x1111111111111111111111111111111111111111';
export async function loadFixtures(count,roundCount,client,onProgress=()=>{}){
  const fixtures=[];
  for(let i=0;i<count;i++){
    const roundId=i%roundCount+1,betNonce=Math.floor(i/roundCount),side=i%2;
    const ballot={arena:loadArena,chainId:1337,roundId,account:loadAccount,betNonce,side,tokenId:roundId*2-1+side,amount:'5000000000000000000000'};
    const sealed=await sealBallot(ballot,1,client);fixtures.push({...ballot,...sealed});
    if((i+1)%100===0)onProgress({stage:'prepare',entries:i+1,total:count});
  }
  return fixtures;
}
export async function runLoadModel({name,fixtures,roundCount,invalid=0,rpcMs=25,blockMs=300,pollMs=1000,outages=[],ambiguousEvery=0,restartEvery=0,client,abi,onProgress=()=>{}}){
  const dir=await mkdtemp(join(tmpdir(),'chog-load-')),events=new Interface(abi),wallet=Wallet.createRandom();
  let index,transactions,start=performance.now(),offset=0,base=1700000000000,cycles=0,errors=0,nonce=0,reads=0,broadcasts=0,ambiguous=0,restarts=0,logIndex=0,lastProgress=0,maxPending=0;
  const clock=()=>base+offset+performance.now()-start,head=()=>Math.floor(clock()/blockMs),blockHash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
  const logs=[],rounds=new Map(),entries=new Map(),sent=new Map(),operations=new Set(),firstReveal=new Map(),settledAt=new Map(),revealTimes=[],cycleTimes=[];
  const elapsed=()=>clock()-base,charge=()=>{offset+=rpcMs;reads++;if(outages.some(([a,b])=>elapsed()>=a&&elapsed()<b))throw Error('Injected RPC outage');};
  const addLog=(event,args,block)=>logs.push({...events.encodeEventLog(events.getEvent(event),args),address:loadArena,blockNumber:block,index:logIndex++});
  for(let id=1;id<=roundCount;id++){
    const r={nftA:BigInt(id*2-1),nftB:BigInt(id*2),endsAt:BigInt(base/1000-300),unlockAt:BigInt(base/1000),revealEndsAt:BigInt(base/1000+3600),beaconRound:1n,committedCount:0n,revealedCount:0n,settled:false};rounds.set(id,r);
    addLog('RoundStarted',[id,r.nftA,r.nftB,r.endsAt,r.unlockAt],head()-20);
  }
  for(const b of fixtures){
    entries.set(b.roundId+':'+b.betNonce,{...b,revealed:false,amount:BigInt(b.amount)});rounds.get(b.roundId).committedCount++;
    addLog('VoteCommitted',[b.roundId,loadAccount,b.betNonce,b.commitment,b.amount,hexlify(toUtf8Bytes(b.sealedChoice))],head()-19);
  }
  const validKeys=new Set(entries.keys());
  for(let i=0;i<invalid;i++){
    const id=i%roundCount+1,betNonce=1000000+i,b={amount:5000000000000000000000n,commitment:'0x'+'ab'.repeat(32),revealed:false};entries.set(id+':'+betNonce,b);rounds.get(id).committedCount++;
    addLog('VoteCommitted',[id,loadAccount,betNonce,b.commitment,b.amount,hexlify(toUtf8Bytes('invalid-ciphertext'))],head()-19);
  }
  function check(name,args){
    const id=Number(args[0]),r=rounds.get(id);assert(r&&!r.settled);
    if(name==='settle'){assert(r.revealedCount===r.committedCount||elapsed()>=3600000);return;}
    const [,account,n,side,tokenId,salt]=args,b=entries.get(id+':'+n);assert.equal(account.toLowerCase(),loadAccount.toLowerCase());assert(b&&!b.revealed);assert(elapsed()<3600000);
    assert.equal(makeCommitment({arena:loadArena,chainId:1337,roundId:id,account,betNonce:n,side:Number(side),tokenId:Number(tokenId),salt,amount:b.amount}).toLowerCase(),b.commitment.toLowerCase());
  }
  const arena={interface:events,revealer:async()=>{charge();return wallet.address;},interruptedThroughRound:async()=>{charge();return 0n;},getAddress:async()=>loadArena,getRound:async id=>{charge();return {...rounds.get(id)};},bets:async(id,account,n)=>{charge();return {...entries.get(Number(id)+':'+n)};}};
  for(const name of ['settle','revealVote'])arena[name]={staticCall:async(...args)=>{charge();check(name,args);},populateTransaction:async(...args)=>({to:loadArena,data:events.encodeFunctionData(name,args)})};
  const provider={getBlock:async n=>{charge();const number=n==='latest'?head():Number(n);return {number,hash:blockHash(number),timestamp:Math.floor(number*blockMs/1000)};},getBlockNumber:async()=>{charge();return head();},getLogs:async q=>{charge();const result=logs.filter(l=>l.blockNumber>=q.fromBlock&&l.blockNumber<=q.toBlock);if(result.length>5000)throw Error('Oversized simulated RPC range');return result;},getTransactionCount:async()=>{charge();return nonce;},getFeeData:async()=>{charge();return {maxFeePerGas:100n,maxPriorityFeePerGas:1n};},getTransactionReceipt:async hash=>{charge();const r=sent.get(hash);return r&&head()>=r.blockNumber?{status:1,blockNumber:r.blockNumber,blockHash:blockHash(r.blockNumber)}:null;},broadcastTransaction:async raw=>{
    charge();broadcasts++;const tx=Transaction.from(raw);assert.equal(tx.chainId,1337n);assert.equal(tx.from,wallet.address);assert.equal(tx.to,loadArena);
    const hash=keccak256(raw);if(sent.has(hash))return {hash};assert.equal(tx.nonce,nonce);nonce++;
    const call=events.parseTransaction({data:tx.data});check(call.name,call.args);const id=Number(call.args[0]),r=rounds.get(id),block=head()+1;
    if(call.name==='revealVote'){
      const b=entries.get(id+':'+call.args[2]);assert(!b.revealed);b.revealed=true;r.revealedCount++;revealTimes.push(elapsed());if(!firstReveal.has(id))firstReveal.set(id,elapsed());
      const op=id+':'+call.args[2];assert(!operations.has(op));operations.add(op);addLog('VoteRevealed',[id,loadAccount,call.args[2],call.args[3],b.amount],block);
    }else{r.settled=true;settledAt.set(id,elapsed());addLog('RoundSettled',[id,2,true,false],block);}
    sent.set(hash,{blockNumber:block});if(ambiguousEvery&&nonce%ambiguousEvery===0){ambiguous++;throw Error('Injected connection reset after acceptance');}return {hash};
  }};
  const signer={address:wallet.address,populateTransaction:async request=>{charge();charge();return {...request,type:2,gasLimit:200000n,maxFeePerGas:100n,maxPriorityFeePerGas:1n};},signTransaction:request=>wallet.signTransaction(request)};
  // Fixed scope across restarts even though the simulated head advances.
  const fromBlock=head()-25;
  function reopen(){index=new ChainIndex(join(dir,'events.sqlite'),{chainId:1337,arena:loadArena,fromBlock});transactions=new KeeperTransactions(join(dir,'transactions.sqlite'),{provider,signer,arena:loadArena,chainId:1337,now:clock});}
  try{
    reopen();
    while(elapsed()<3700000&&cycles<15000){
      const then=clock();cycles++;
      try{await keeperCycle({arena,provider,index,transactions,client,expectedRevealer:wallet.address,chainId:1337,now:clock});}catch{errors++;}
      cycleTimes.push(clock()-then);maxPending=Math.max(maxPending,transactions.pending()?1:0);
      if([...rounds.values()].every(r=>r.settled)&&!transactions.pending()&&index.db.prepare('SELECT count(*) AS n FROM rounds WHERE settled=0').get().n===0)break;
      if(restartEvery&&cycles%restartEvery===0){index.close();transactions.close();reopen();restarts++;}
      offset+=pollMs;
      if(performance.now()-start-lastProgress>=10000){lastProgress=performance.now()-start;onProgress({stage:'run',name,cycles,revealed:operations.size,elapsedModelSeconds:Math.round(elapsed()/1000)});}
    }
    const validUnopened=[...validKeys].filter(key=>!entries.get(key).revealed).length;assert.equal(operations.size+validUnopened,fixtures.length);assert([...rounds.values()].every(r=>r.settled));
    const queued=index.db.prepare('SELECT count(*) AS n FROM ballots WHERE done=0').get().n;assert.equal(queued,0);
    const sizes=await Promise.all(['events.sqlite','events.sqlite-wal','transactions.sqlite','transactions.sqlite-wal'].map(async p=>{try{return (await stat(join(dir,p))).size;}catch{return 0;}}));
    cycleTimes.sort((a,b)=>a-b);
    return {name,rounds:roundCount,validEntries:fixtures.length,malformedEntries:invalid,rpcMs,blockMs,pollMs,confirmations:3,outages,ambiguousBroadcasts:ambiguous,restarts,cycles,modelElapsedSeconds:Math.round(elapsed()/1000),actualHostElapsedMs:Math.round(performance.now()-start),revealed:operations.size,validUnopened,allRoundsSettled:true,settledBeforeDeadline:[...settledAt.values()].filter(t=>t<3600000).length,latestRevealModelSeconds:Math.round((revealTimes.at(-1)||0)/1000),firstRevealPerRoundModelSeconds:Object.fromEntries([...firstReveal].map(([id,t])=>[id,Math.round(t/1000)])),rpcCalls:reads,broadcasts,cycleErrors:errors,maxPendingNonces:maxPending,queueRemaining:queued,journalAndIndexBytes:sizes.reduce((a,b)=>a+b,0),cycleModelP95Ms:Math.round(cycleTimes[Math.ceil(cycleTimes.length*.95)-1]),realTransactionsSent:0,limitations:'Virtual RPC/block/inclusion timing; real crypto, signing, SQLite and production keeper code. Fake chain execution/receipts and historical beacon; gas, mainnet throughput and monetary accounting are not measured.'};
  }finally{index?.close();transactions?.close();await rm(dir,{recursive:true,force:true});}
}
