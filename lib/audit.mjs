import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile);
const networkError=/ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ENOTFOUND|ERR_SOCKET|network timeout|socket hang up/i;
async function invoke(npmCli){
  const args=[npmCli,'audit','--json','--prefer-online','--maxsockets=1','--fetch-retries=0','--fetch-timeout=20000'];
  try{const result=await exec(process.execPath,args,{timeout:45000,maxBuffer:2*1024*1024,windowsHide:true});return {...result,code:0};}
  catch(error){return {code:error.code,stdout:error.stdout || '',stderr:error.stderr || '',timedOut:Boolean(error.killed)};}
}
// Retry transport failure, never findings. Only return a complete npm report.
export async function auditWithRetry({npmCli,run=invoke,sleep=delay,onRetry=()=>{},attempts=3}){
  if(!npmCli)throw Error('Run this command through npm run audit:security');
  if(!Number.isInteger(attempts) || attempts<1 || attempts>3)throw Error('Audit attempts must be 1..3');
  for(let attempt=1;attempt<=attempts;attempt++){
    const result=await run(npmCli);let report;
    try{report=JSON.parse(result.stdout);}catch{}
    const counts=report?.metadata?.vulnerabilities;
    if([0,1].includes(result.code) && !report?.error && report?.auditReportVersion===2 && report?.vulnerabilities && counts && ['info','low','moderate','high','critical','total'].every(k=>Number.isSafeInteger(counts[k]) && counts[k]>=0)){
      return {report,exitCode:counts.total>0?1:0,attempts:attempt};
    }
    const retryable=result.timedOut || networkError.test(result.stdout+'\n'+result.stderr);
    if(!retryable)throw Error('npm audit did not return a complete report; check npm configuration and registry access');
    if(attempt===attempts)throw Error('npm audit connection failed after '+attempts+' attempts; no complete report received');
    onRetry(attempt);await sleep(attempt*1000);
  }
}
