// Read-only inventory. No signer, private key or transaction broadcast.
import {Contract,JsonRpcProvider,FetchRequest,keccak256,id,toBeHex} from 'ethers';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {RPC_URL,CHAIN_ID,CHOG_TOKEN,COLLECTION} from '../lib/config.mjs';
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const provider=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
const output=resolve(process.argv[2] || 'outputs/security-assets.json');
try{
  const network=await provider.getNetwork();if(Number(network.chainId)!==CHAIN_ID)throw Error('Wrong chain');
  const block=await provider.getBlockNumber(),result={checkedAt:new Date().toISOString(),chainId:CHAIN_ID,block,assets:{}};
  const slots=Object.fromEntries(['implementation','admin','beacon'].map(key=>[key,toBeHex(BigInt(id('eip1967.proxy.'+key))-1n,32)]));
  for(const [name,address]of Object.entries({CHOG:CHOG_TOKEN,collection:COLLECTION})){
    const code=await provider.getCode(address,block),record={address,codeBytes:(code.length-2)/2,codeHash:keccak256(code),eip1967:{},calls:{}};
    const clone=code.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i);
    if(clone){const implementation='0x'+clone[1],implementationCode=await provider.getCode(implementation,block);record.eip1167={implementation,codeBytes:(implementationCode.length-2)/2,codeHash:keccak256(implementationCode)};}
    for(const [key,slot]of Object.entries(slots))record.eip1967[key]=await provider.getStorage(address,slot,block);
    for(const [method,type]of [['name','string'],['symbol','string'],['decimals','uint8'],['totalSupply','uint256'],['owner','address']]){
      try{const c=new Contract(address,[`function ${method}() view returns(${type})`],provider);record.calls[method]=String(await c[method]({blockTag:block}));}
      catch{record.calls[method]='unavailable';}
    }
    result.assets[name]=record;
  }
  result.limitations='Read-only inventory, not proof of immutable/non-proxy behavior. No fork transfer or independent source audit.';
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();}
