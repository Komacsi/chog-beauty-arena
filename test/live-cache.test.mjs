import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveCache} from '../lib/live-cache.mjs';

test('simultaneous fresh requests cannot multiply RPC scans or bypass the freshness floor',async()=>{
  let time=0,calls=0,release;
  const read=createLiveCache(async()=>{calls++;await new Promise(done=>{release=done;});return {version:calls};},{now:()=>time});
  const pending=Array.from({length:100},()=>read(true));await Promise.resolve();assert.equal(calls,1);release();
  for(const result of await Promise.all(pending))assert.equal(result.version,1);
  time=999;assert.equal((await read(true)).version,1);assert.equal(calls,1);
  time=1000;const next=read(true);await Promise.resolve();assert.equal(calls,2);release();await next;
  time=10999;assert.equal((await read()).version,2);assert.equal(calls,2);
});

test('a failed RPC scan releases the single-flight lock and preserves a retry path',async()=>{
  let calls=0;const read=createLiveCache(async()=>{if(++calls===1)throw Error('RPC unavailable');return {ok:true};});
  const results=await Promise.allSettled([read(true),read(true)]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
  assert.deepEqual(await read(),{ok:true});assert.equal(calls,2);
});
