import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
const phases=new Set(['ready','indexing','pending','confirming','revoked','fee-cap','error']);
export async function writeKeeperHealth(path,result,now=Date.now()){
  // Explicit public fields only; never serialize the journal, raw signed bytes or errors.
  const status={checkedAt:now,phase:result.phase,indexedBlock:result.sync?.indexedBlock,backlogBlocks:result.sync?.backlogBlocks,pendingAgeMs:result.transaction?.ageMs};
  const temp=path+'.tmp';await writeFile(temp,JSON.stringify(status)+'\n',{mode:0o600});await chmod(temp,0o644);await rename(temp,path);
}
export async function keeperHealthAlerts(path,now=Date.now()){
  try{
    const status=JSON.parse(await readFile(path,'utf8')),alerts=[];
    if(!status || !phases.has(status.phase) || ['indexedBlock','backlogBlocks','pendingAgeMs'].some(key=>status[key]!==undefined && (!Number.isSafeInteger(status[key]) || status[key]<0)))return [{code:'KEEPER_HEARTBEAT_INVALID'}];
    if(!Number.isFinite(status.checkedAt) || now-status.checkedAt>90000 || status.checkedAt>now+10000)alerts.push({code:'KEEPER_HEARTBEAT_STALE'});
    if(['error','fee-cap','revoked'].includes(status.phase))alerts.push({code:'KEEPER_'+status.phase.toUpperCase().replace('-','_')});
    if(status.pendingAgeMs>300000)alerts.push({code:'KEEPER_TRANSACTION_STUCK',ageMs:status.pendingAgeMs});
    if(status.backlogBlocks>2000)alerts.push({code:'KEEPER_INDEX_BACKLOG',blocks:status.backlogBlocks});
    return alerts;
  }catch{return [{code:'KEEPER_HEARTBEAT_UNAVAILABLE'}];}
}
