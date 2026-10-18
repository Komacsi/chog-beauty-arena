import test from 'node:test';
import assert from 'node:assert/strict';
import {processRounds} from '../lib/keeper.mjs';
test('keeper settles an older ready match while the newest match is still accepting votes',async()=>{
  const rounds={1:{settled:false,unlockAt:10,revealEndsAt:20,revealedCount:0,committedCount:0},2:{settled:false,unlockAt:1000,revealEndsAt:2000}},settled=[];
  const arena={currentRoundId:async()=>2n,getRound:async id=>rounds[id],settle:async id=>({wait:async()=>{rounds[id].settled=true;settled.push(id);}})};
  const provider={getBlock:async()=>({timestamp:30}),getNetwork:async()=>({chainId:143n})};
  const result=await processRounds({arena,provider,fromBlock:0});assert.deepEqual(settled,[1]);assert.equal(result[1].phase,'waiting');
});
test('one failing match cannot prevent another match from progressing',async()=>{
  const arena={currentRoundId:async()=>2n,getRound:async id=>{if(id===1)throw Error('RPC unavailable');return {settled:false,unlockAt:1000};}};
  const result=await processRounds({arena,provider:{getBlock:async()=>({timestamp:30})}});assert.deepEqual(result.map(r=>r.phase),['retry','waiting']);
});
