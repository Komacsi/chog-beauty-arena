// Read-only production asset preflight. Refuses overwriting evidence.
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {writeFile} from 'node:fs/promises';
import {validateChogAsset} from '../lib/chog-asset.mjs';
import {RPC_URL} from '../lib/config.mjs';
const output=process.argv[2];if(!output)throw Error('Pass a NEW output JSON path');
const request=new FetchRequest(RPC_URL);request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1});
try{
  const result={checkedAt:new Date().toISOString(),...await validateChogAsset(provider),transactionsSigned:0,transactionsSent:0};
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();}
