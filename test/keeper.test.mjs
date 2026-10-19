import test from 'node:test';
import assert from 'node:assert/strict';
import {processRound,processRounds} from '../lib/keeper.mjs';
import {readFile} from 'node:fs/promises';
import {toUtf8Bytes} from 'ethers';
import {sealBallot,drandClient} from '../lib/timelock.mjs';
test('keeper stops after role revocation without touching any match',async()=>{
  const result=await processRounds({arena:{revealer:async()=>'0x'+'0'.repeat(40)},expectedRevealer:'0x'+'1'.repeat(40)});
  assert.deepEqual(result,[{phase:'revoked'}]);
});
test('interrupted matches refund before unlock without trying decryption',async()=>{
  let settled=0;
  const arena={getRound:async()=>({settled:false,unlockAt:999999}),settle:async id=>({wait:async()=>{settled=id;}})};
  assert.deepEqual(await processRound({arena,id:2,interruptedThroughRound:2}),{phase:'refunded',id:2});assert.equal(settled,2);
});
test('keeper settles an older ready match while the newest match is still accepting votes',async()=>{
  const rounds={1:{settled:false,unlockAt:10,revealEndsAt:20,revealedCount:0,committedCount:0},2:{settled:false,unlockAt:1000,revealEndsAt:2000}},settled=[];
  const arena={interruptedThroughRound:async()=>0n,currentRoundId:async()=>2n,getRound:async id=>rounds[id],settle:async id=>({wait:async()=>{rounds[id].settled=true;settled.push(id);}})};
  const provider={getBlock:async()=>({timestamp:30}),getNetwork:async()=>({chainId:143n})};
  const result=await processRounds({arena,provider,fromBlock:0});assert.deepEqual(settled,[1]);assert.equal(result[1].phase,'waiting');
});
test('one failing match cannot prevent another match from progressing',async()=>{
  const arena={interruptedThroughRound:async()=>0n,currentRoundId:async()=>2n,getRound:async id=>{if(id===1)throw Error('RPC unavailable');return {settled:false,unlockAt:1000};}};
  const result=await processRounds({arena,provider:{getBlock:async()=>({timestamp:30})}});assert.deepEqual(result.map(r=>r.phase),['retry','waiting']);
});

test('receipt waits are bounded so an unmined settlement cannot stall every later match',async()=>{
  const waits=[];
  const arena={interruptedThroughRound:async()=>0n,currentRoundId:async()=>2n,getRound:async id=>({settled:false,unlockAt:id===1?10:1000,revealEndsAt:20,revealedCount:0,committedCount:0}),
    settle:async()=>({wait:async(confirmations,timeout)=>{waits.push([confirmations,timeout]);if(timeout===undefined)throw Error('Unbounded receipt wait');const error=Error('Not mined');error.code='TIMEOUT';throw error;}})};
  const result=await processRounds({arena,provider:{getBlock:async()=>({timestamp:30}),getNetwork:async()=>({chainId:143n})},receiptTimeoutMs:30000});
  assert.deepEqual(waits,[[1,30000]]);assert.deepEqual(result.map(r=>r.phase),['retry','waiting']);
});

test('event scans respect the public Monad RPC limit of 100 blocks and cover the final partial range',async()=>{
  const ranges=[],round={settled:false,unlockAt:1,revealEndsAt:100,committedCount:1n,revealedCount:0n};
  const arena={getRound:async()=>round,filters:{VoteCommitted:()=>({})},queryFilter:async(filter,from,to)=>{assert.ok(to-from<100);ranges.push([from,to]);return [];}};
  const provider={getBlock:async()=>({timestamp:50}),getBlockNumber:async()=>350,getNetwork:async()=>({chainId:143n})};
  assert.equal((await processRound({arena,provider,fromBlock:100,id:1})).phase,'opening');
  assert.deepEqual(ranges,[[100,199],[200,299],[300,350]]);
});

for(const rejectSimulation of [false,true])test(`keeper simulates a valid reveal before paying gas (simulation rejected: ${rejectSimulation})`,async()=>{
  const beacon=JSON.parse(await readFile(new URL('./fixtures/drand-round-1.json',import.meta.url),'utf8'));
  const client=drandClient(async()=>({ok:true,json:async()=>beacon}));
  const account='0x1111111111111111111111111111111111111111',address='0x2222222222222222222222222222222222222222';
  const sealed=await sealBallot({arena:address,chainId:143,roundId:1,account,amount:'5000000000000000000000',side:0,tokenId:1},1,client);
  const round={unlockAt:0,revealEndsAt:Math.floor(Date.now()/1000)+3600,beaconRound:1,nftA:1,nftB:2,revealedCount:0,committedCount:1,settled:false};
  const calls=[];
  const revealVote=async()=>{calls.push('send');return {wait:async()=>{round.revealedCount++;}};};
  revealVote.staticCall=async()=>{calls.push('simulate');if(rejectSimulation)throw Error('Contract rejects reveal');};
  const arena={
    getRound:async()=>round,getAddress:async()=>address,filters:{VoteCommitted:()=>({})},
    queryFilter:async()=>[{args:{account,sealedChoice:toUtf8Bytes(sealed.sealedChoice)}}],
    entries:async()=>({amount:5000000000000000000000n,commitment:sealed.commitment,revealed:false}),
    revealVote,settle:async()=>({wait:async()=>{round.settled=true;}})
  };
  const provider={getBlock:async()=>({timestamp:Math.floor(Date.now()/1000)}),getBlockNumber:async()=>100,getNetwork:async()=>({chainId:143n})};
  const result=await processRound({arena,provider,fromBlock:100,client,id:1});
  assert.deepEqual(calls,rejectSimulation?['simulate']:['simulate','send']);
  assert.equal(result.phase,rejectSimulation?'opening':'settled');assert.equal(result.failed,rejectSimulation?1:0);
});
