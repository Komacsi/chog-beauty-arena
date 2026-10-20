// Exercise the packaged server with its own temporary database, never the user's demo.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access,readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
const target=resolve(process.argv[2] || 'dist/runtime'),pkg=JSON.parse(await readFile(join(target,'package.json'),'utf8'));
for(const name of Object.keys(pkg.devDependencies))await assert.rejects(access(join(target,'node_modules',name)));
await assert.rejects(access(join(target,'.env')));
assert.deepEqual(await readdir(join(target,'data')),['collection.json']);
const stateDir=await mkdtemp(join(tmpdir(),'chog-runtime-check-'));
const child=spawn(process.execPath,['server.mjs'],{cwd:target,env:{...process.env,PORT:'0',HOST:'127.0.0.1',ARENA_STATE_DIR:stateDir,ARENA_CONTRACT_ADDRESS:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stderr.on('data',()=>{});
try{
  const base=await new Promise((done,reject)=>{
    let logs='';const timer=setTimeout(()=>reject(Error('Packaged server startup timed out')),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Packaged server exited '+code));});
    child.stdout.on('data',part=>{logs+=part;const match=logs.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);done('http://127.0.0.1:'+match[1]);}});
  });
  const config=await(await fetch(base+'/api/config')).json();assert.equal(config.mode,'demo');assert.equal(config.nfts.length,10);assert.equal(config.release.realFundsEnabled,false);
  const state=await(await fetch(base+'/api/state')).json();assert.equal(state.history.length,0);assert.equal(state.challenges.length,0);
  for(const path of ['/','/bundle.js',config.nfts[0].image]){const response=await fetch(base+path);assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0);}
  assert.equal((await fetch(base+'/api/deployment')).status,403);
  console.log('Packaged runtime starts and serves all assets with production dependencies only; live guard active.');
}finally{
  if(child.pid && child.exitCode===null && child.signalCode===null)await new Promise(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},3000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill();});
  assert.ok(resolve(stateDir).startsWith(resolve(tmpdir())+sep) && stateDir.includes('chog-runtime-check-'));
  await rm(stateDir,{recursive:true,force:true});
}
