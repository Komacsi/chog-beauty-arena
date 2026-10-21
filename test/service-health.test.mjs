import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serviceHealth} from '../lib/service-health.mjs';
test('public health keeps fictional demo healthy without accessing a keeper file',async()=>{
  assert.deepEqual(await serviceHealth({live:false}),{status:200,body:{status:'ok',mode:'demo',keeper:'not-required-for-demo',alerts:[]}});
});
test('public live health rejects unavailable, malformed, stale, error and congested heartbeats without disclosing raw fields',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-health-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'public.json'),now=1000000;
  assert.equal((await serviceHealth({live:true,healthPath:path,now})).status,503);
  for(const value of [{},[],{checkedAt:now,phase:'made-up'},{checkedAt:now,phase:'ready',backlogBlocks:-1},{checkedAt:0,phase:'ready'},{checkedAt:now,phase:'error'},{checkedAt:now,phase:'pending',pendingAgeMs:400000},{checkedAt:now,phase:'indexing',backlogBlocks:3000}]){
    await writeFile(path,JSON.stringify({...value,privateKey:'NEVER_PUBLIC',raw:'NEVER_PUBLIC'}));
    const result=await serviceHealth({live:true,healthPath:path,now});assert.equal(result.status,503);assert(!JSON.stringify(result.body).includes('NEVER_PUBLIC'));
  }
  await writeFile(path,JSON.stringify({checkedAt:now,phase:'ready',indexedBlock:12,backlogBlocks:0,raw:'NEVER_PUBLIC'}));
  assert.deepEqual(await serviceHealth({live:true,healthPath:path,now}),{status:200,body:{status:'ok',mode:'live',keeper:'healthy',alerts:[]}});
});
