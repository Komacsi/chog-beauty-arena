import {auditWithRetry} from '../lib/audit.mjs';
if(process.argv.slice(2).some(arg=>arg!=='--json'))throw Error('Only --json is supported; this command never modifies dependencies');
try{
  const result=await auditWithRetry({npmCli:process.env.npm_execpath,onRetry:attempt=>console.error('npm audit connection interrupted; retrying complete request ('+attempt+'/3).')});
  process.stdout.write(JSON.stringify(result.report,null,2)+'\n');process.exitCode=result.exitCode;
}catch(error){console.error(error.message);process.exitCode=2;}
