import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {deliverMonitorAlerts,parseTelegramCredentials,summarizeAlerts} from '../lib/telegram-alerts.mjs';
const token='123456:DISPOSABLE_TEST_TOKEN_123456789',chatId='12345';
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'chog-telegram-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const credentialsPath=join(dir,'credential.json'),statePath=join(dir,'state.json');
  await writeFile(credentialsPath,JSON.stringify({token,chatId}));
  return {credentialsPath,statePath};
}
const ack=()=>new Response(JSON.stringify({ok:true,result:{message_id:1,chat:{id:Number(chatId)}}}));
test('Telegram sends one sanitized alert, deduplicates through restart and sends recovery once',async t=>{
  const paths=await fixture(t),calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return ack();};
  const send=(alerts,now)=>deliverMonitorAlerts({...paths,alerts,now,fetchImpl});
  assert.equal((await send([],1000)).sent,false);
  assert.equal((await send([{code:'KEEPER_LOW_MON',privateKey:'never forward',error:'secret'}],1000)).sent,true);
  assert.equal(calls[0].url,'https://api.telegram.org/bot'+token+'/sendMessage');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.signal.aborted,false);
  assert.equal(calls[0].options.body.includes('secret'),false);
  assert.equal((await send([{code:'KEEPER_LOW_MON'}],60000)).sent,false);
  assert.equal((await send([{code:'KEEPER_LOW_MON'}],3601000)).sent,true);
  assert.equal((await send([],3602000)).sent,true);
  assert.equal((await send([],3603000)).sent,false);
  assert.equal(calls.length,3);
  const state=await readFile(paths.statePath,'utf8');assert.equal(state.includes(token),false);assert.equal(state.includes(chatId),false);
});
test('Telegram API/network failures are sanitized and retry without advancing delivery state',async t=>{
  const paths=await fixture(t),alerts=[{code:'MONITOR_FAILED'}];
  for(const fetchImpl of [async()=>{throw Error('https://api.telegram.org/bot'+token);},async()=>new Response('token='+token,{status:500}),async()=>new Response(JSON.stringify({ok:false,description:token})),async()=>new Response(JSON.stringify({ok:true,result:{message_id:1,chat:{id:999}}}))]){
    await assert.rejects(deliverMonitorAlerts({...paths,alerts,fetchImpl}),{message:'Telegram notification failed'});
    await assert.rejects(readFile(paths.statePath),{code:'ENOENT'});
  }
  assert.equal((await deliverMonitorAlerts({...paths,alerts,fetchImpl:async()=>ack()})).sent,true);
});
test('Telegram rejects invalid credentials and truncates public condition lists without forwarding raw fields',()=>{
  assert.throws(()=>parseTelegramCredentials(JSON.stringify({token:'bad',chatId})),{message:'Invalid Telegram credential configuration'});
  assert.throws(()=>parseTelegramCredentials(JSON.stringify({token,chatId:'@somebody'})));
  const value=summarizeAlerts(Array.from({length:1000},(_,i)=>({code:'SETTLEMENT_PENDING',round:i+1,salt:'secret'})));
  assert(value.text.length<3500);assert(!value.text.includes('secret'));
  assert.match(summarizeAlerts([{code:token}]).text,/MONITOR_FAILED/);
  assert.equal(summarizeAlerts([{code:'RPC_STALE'},{code:'KEEPER_LOW_MON'}]).fingerprint,summarizeAlerts([{code:'KEEPER_LOW_MON'},{code:'RPC_STALE'}]).fingerprint);
});
test('monitor bootstrap failures produce a public alert and sanitize notification configuration errors',async t=>{
  const paths=await fixture(t),dir=join(paths.statePath,'..');
  await writeFile(join(dir,'telegram.json'),'INVALID_DISPOSABLE_SECRET');
  const result=spawnSync(process.execPath,['scripts/monitor.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,ARENA_CONTRACT_ADDRESS:'',MONITOR_TELEGRAM:'1',CREDENTIALS_DIRECTORY:dir,STATE_DIRECTORY:dir}});
  assert.equal(result.status,2,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).alerts,[{code:'MONITOR_FAILED'}]);
  assert.equal(result.stderr.trim(),'TELEGRAM_NOTIFICATION_FAILED');
  assert(!result.stderr.includes('INVALID_DISPOSABLE_SECRET'));
});
