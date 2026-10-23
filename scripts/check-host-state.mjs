// Linux staging restore rehearsal in a disposable directory; never replace the service DB.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,copyFile,chown,rm,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
const [runtime,source,backup,output]=process.argv.slice(2);
if(!runtime||!source||!backup||!output || process.platform!=='linux')throw Error('Usage on Linux: check-host-state RUNTIME SOURCE_DB BACKUP_DB NEW_REPORT');
function state(path){const db=new DatabaseSync(path,{readOnly:true});try{return JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value);}finally{db.close();}}
const expected=state(backup);assert.deepEqual(state(source),expected);
const uid=Number(execFileSync('id',['-u','chogweb'],{encoding:'utf8'}).trim()),gid=Number(execFileSync('id',['-g','chogweb'],{encoding:'utf8'}).trim());
const dir=await mkdtemp(join(tmpdir(),'chog-host-restore-'));let child;
try{
  await chown(dir,uid,gid);await copyFile(backup,join(dir,'arena.sqlite'));await chown(join(dir,'arena.sqlite'),uid,gid);
  child=spawn(process.execPath,['server.mjs'],{cwd:runtime,uid,gid,env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:'0',ARENA_STATE_DIR:dir,ARENA_CONTRACT_ADDRESS:'',DEMO_FAST_ROUNDS:'1'},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>{});
  const port=await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(Error('Restore startup timed out')),15000);let text='';
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Restore process exited '+code));});
    child.stdout.on('data',part=>{text+=part;const match=text.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);done(match[1]);}});
  });
  const response=await fetch('http://127.0.0.1:'+port+'/api/state');assert.equal(response.status,200);const restored=await response.json();
  assert.equal(restored.history.length,expected.rounds.filter(r=>r.settled).length);assert.deepEqual(state(join(dir,'arena.sqlite')),expected);
  const report={checkedAt:new Date().toISOString(),serviceRestartPreservedState:true,backupRestoreServedByUnprivilegedUser:true,restoredRounds:expected.rounds.length,restoredRequests:expected.challenges.length,realTransactionsSent:0};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
}finally{
  if(child && child.exitCode===null && child.signalCode===null)await new Promise(done=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill();});
  assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep) && dir.includes('chog-host-restore-'));
  await rm(dir,{recursive:true,force:true});
}
