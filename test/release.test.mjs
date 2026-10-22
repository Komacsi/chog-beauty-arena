import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RELEASE_STATUS,assertLiveReleaseAllowed} from '../lib/release.mjs';
const root=new URL('..',import.meta.url);

test('release permits only the reviewed deployment and rejects another arena before touching demo state',async()=>{
  assert.equal(RELEASE_STATUS.realFundsEnabled,true);assert.doesNotThrow(()=>assertLiveReleaseAllowed(''));
  assert.doesNotThrow(()=>assertLiveReleaseAllowed(RELEASE_STATUS.arenaAddress));
  assert.ok(!RELEASE_STATUS.blockingFindings.includes('SEC-02'));assert.ok(RELEASE_STATUS.acceptedRisks.includes('SEC-02'));
  assert.ok(RELEASE_STATUS.acceptedRisks.includes('CHOG-SOURCE'));
  assert.deepEqual(RELEASE_STATUS.blockingFindings,[]);
  const dir=await mkdtemp(join(tmpdir(),'chog-release-'));
  try{
    for(const script of ['server.mjs','scripts/keeper.mjs']){
      const result=spawnSync(process.execPath,[script],{cwd:root,env:{...process.env,ARENA_STATE_DIR:dir,ARENA_CONTRACT_ADDRESS:'0x1111111111111111111111111111111111111111',KEEPER_PRIVATE_KEY:''},encoding:'utf8',timeout:10000});
      assert.equal(result.status,1);assert.match(result.stderr,/approved only for the reviewed Monad arena/);
    }
    await assert.rejects(access(join(dir,'arena.sqlite')));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit demo launcher stays in demo even when a live address is present in the environment',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-preserve-demo-'));
  const child=spawn(process.execPath,['scripts/demo.mjs'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',ARENA_STATE_DIR:dir,ARENA_CONTRACT_ADDRESS:'0x1111111111111111111111111111111111111111'},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>{});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Demo startup timeout')),10000);child.stdout.on('data',d=>{if(String(d).includes('(DEMO)')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Demo exited '+code));});});
  }finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
