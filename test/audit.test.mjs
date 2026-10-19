import test from 'node:test';
import assert from 'node:assert/strict';
import {auditWithRetry} from '../lib/audit.mjs';
const report=total=>({auditReportVersion:2,vulnerabilities:total?{example:{severity:'high'}}:{},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:total,critical:0,total}}});
test('audit retries response resets but reports vulnerabilities once without treating exit 1 as network failure',async()=>{
  let calls=0;const retries=[];
  const result=await auditWithRetry({npmCli:'test-cli',run:async()=>++calls<3?{code:1,stdout:JSON.stringify({error:{message:'ECONNRESET'}}),stderr:''}:{code:1,stdout:JSON.stringify(report(1)),stderr:''},sleep:async()=>{},onRetry:n=>retries.push(n)});
  assert.equal(result.exitCode,1);assert.equal(result.attempts,3);assert.deepEqual(retries,[1,2]);assert.deepEqual(result.report,report(1));
});
test('audit accepts a complete clean report without retries and never invents a report after exhausted retries',async()=>{
  const clean=await auditWithRetry({npmCli:'test-cli',run:async()=>({code:0,stdout:JSON.stringify(report(0))})});assert.equal(clean.exitCode,0);assert.equal(clean.attempts,1);
  let calls=0;await assert.rejects(auditWithRetry({npmCli:'test-cli',run:async()=>{calls++;return {code:1,stdout:'',stderr:'read ECONNRESET'};},sleep:async()=>{}}),/no complete report received/);assert.equal(calls,3);
});
test('audit fails immediately on configuration errors or malformed output',async()=>{
  for(const output of [{code:1,stdout:JSON.stringify({error:{message:'Unauthorized'}}),stderr:''},{code:0,stdout:'not JSON',stderr:''}]){
    let calls=0;await assert.rejects(auditWithRetry({npmCli:'test-cli',run:async()=>{calls++;return output;}}),/complete report/);assert.equal(calls,1);
  }
});
