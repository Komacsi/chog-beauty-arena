// Notification-only identity. No wallet, signer, transaction or inbound command handler.
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const codes=new Set(['RPC_STALE','GOVERNANCE_CONFIGURATION','KEEPER_REVOKED','KEEPER_LOW_MON','COVERAGE_LIMIT','REFUND_PENDING','SETTLEMENT_PENDING','REVEAL_DEADLINE_NEAR','KEEPER_HEARTBEAT_STALE','KEEPER_HEARTBEAT_UNAVAILABLE','KEEPER_HEARTBEAT_INVALID','KEEPER_ERROR','KEEPER_FEE_CAP','KEEPER_TRANSACTION_STUCK','KEEPER_INDEX_BACKLOG','MONITOR_FAILED']);
export function parseTelegramCredentials(text){
  try{
    if(text.length>4096)throw Error();
    const data=JSON.parse(text);
    if(!data || !/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(data.token) || typeof data.chatId!=='string' || !/^[1-9]\d{0,19}$/.test(data.chatId))throw Error();
    return {token:data.token,chatId:data.chatId};
  }catch{throw Error('Invalid Telegram credential configuration');}
}
export function summarizeAlerts(alerts){
  if(!Array.isArray(alerts))throw Error('Invalid monitor result');
  const items=[...new Set(alerts.map(alert=>{
    const code=codes.has(alert?.code)?alert.code:'MONITOR_FAILED';
    return code+(Number.isSafeInteger(alert?.round) && alert.round>0?' round '+alert.round:'');
  }))].sort();
  return {fingerprint:createHash('sha256').update(JSON.stringify(items)).digest('hex'),
    text:items.length?'CHOG Arena alert\n'+items.slice(0,20).join('\n')+(items.length>20?'\nAnd '+(items.length-20)+' more conditions.':''):'CHOG Arena: monitored conditions have recovered.',
    active:items.length>0};
}
async function storedState(path){
  try{
    const text=await readFile(path,'utf8');if(text.length>4096)throw Error();
    const value=JSON.parse(text);
    if(typeof value.active!=='boolean' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Number.isSafeInteger(value.deliveredAt))throw Error();
    return value;
  }catch(error){if(error.code==='ENOENT')return null;throw Error('Notification state unavailable');}
}
export async function deliverMonitorAlerts({alerts,credentialsPath,statePath,fetchImpl=fetch,now=Date.now()}){
  try{
    const current=summarizeAlerts(alerts),previous=await storedState(statePath);
    if(!current.active && !previous?.active)return {sent:false};
    if(previous?.fingerprint===current.fingerprint && now>=previous.deliveredAt && now-previous.deliveredAt<3600000)return {sent:false};
    const credentials=parseTelegramCredentials(await readFile(credentialsPath,'utf8'));
    const response=await fetchImpl('https://api.telegram.org/bot'+credentials.token+'/sendMessage',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:credentials.chatId,text:current.text,link_preview_options:{is_disabled:true}})
    });
    if(!response.ok)throw Error();
    const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw Error();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
    const reply=JSON.parse(text);
    if(reply.ok!==true || String(reply.result?.chat?.id)!==credentials.chatId || !Number.isSafeInteger(reply.result?.message_id))throw Error();
    const temp=statePath+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,JSON.stringify({...current,text:undefined,deliveredAt:now})+'\n',{mode:0o600,flag:'wx'});await rename(temp,statePath);}
    finally{await unlink(temp).catch(()=>{});}
    return {sent:true};
  }catch{throw Error('Telegram notification failed');} // Never log token-bearing URLs, remote text or cause.
}
