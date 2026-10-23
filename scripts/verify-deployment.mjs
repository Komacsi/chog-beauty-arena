// Post-signing read-only verification. The human supplies their public tx hash.
import {Contract,FetchRequest,JsonRpcProvider,keccak256,formatEther} from 'ethers';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {validateDeploymentDraft,DEPLOYER,DEPLOYMENT_ADDRESSES} from '../lib/deployment-draft.mjs';
import {validateChogAsset} from '../lib/chog-asset.mjs';
import {validateGovernance} from '../lib/governance.mjs';
import {RPC_URL} from '../lib/config.mjs';
const [directory,hash,output]=process.argv.slice(2);
if(!directory||!/^0x[0-9a-f]{64}$/i.test(hash??'')||!output)throw Error('Usage: node scripts/verify-deployment.mjs PREPARED_DIRECTORY PUBLIC_TX_HASH NEW_REPORT.json');
const draft=JSON.parse(await readFile(resolve(directory,'deployment.json'),'utf8'));validateDeploymentDraft(draft);
const artifact=JSON.parse(await readFile(resolve(directory,'artifact.json'),'utf8')),template=JSON.parse(await readFile(resolve(directory,'runtime-template.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),sources=await readFile(resolve(directory,'source-input.json'));
if(createHash('sha256').update(sources).digest('hex')!==manifest.sourceInputSha256||manifest.initcodeHash!==draft.initcodeHash)throw Error('Prepared bundle identity changed');
const request=new FetchRequest(RPC_URL);request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
const requireMatch=(ok,reason)=>{if(!ok)throw Error('Deployment verification: '+reason);};
try{
  requireMatch((await provider.getNetwork()).chainId===143n,'wrong RPC chain');
  const [tx,receipt,head]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash),provider.getBlockNumber()]);
  requireMatch(tx&&receipt&&receipt.status===1&&head>=receipt.blockNumber+1,'transaction missing, failed or needs another block confirmation');
  requireMatch(tx.chainId===143n&&tx.to===null&&tx.from.toLowerCase()===DEPLOYER.toLowerCase()&&tx.value===0n,'wrong sender/network/value or not contract creation');
  requireMatch(keccak256(tx.data)===draft.initcodeHash&&tx.nonce===Number(BigInt(draft.request.nonce)),'creation input or nonce differs');
  requireMatch(receipt.contractAddress?.toLowerCase()===draft.predictedAddress.toLowerCase(),'created address differs from the prepared request');
  const address=receipt.contractAddress,code=await provider.getCode(address,receipt.blockNumber);let masked=code.slice(2);
  requireMatch(masked.length===template.object.length,'runtime length differs');
  for(const references of Object.values(template.immutableReferences))for(const {start,length}of references){
    requireMatch(Number.isSafeInteger(start)&&start>=0&&length===32&&start+length<=masked.length/2,'invalid compiler immutable reference');
    masked=masked.slice(0,start*2)+'0'.repeat(length*2)+masked.slice((start+length)*2);
  }
  requireMatch(masked===template.object,'runtime differs outside compiler immutable references');
  const arena=new Contract(address,artifact.abi,provider),at={blockTag:receipt.blockNumber};
  const methods=['chog','collection','treasury','revealer','owner','FEE_BPS','MIN_STAKE','DURATION','UNLOCK_DELAY','REVEAL_DURATION','currentRoundId','challengeCount'];
  const values=Object.fromEntries(await Promise.all(methods.map(async method=>[method,String(await arena[method](at))])));
  for(const [method,key]of Object.entries({chog:'token',collection:'collection',treasury:'treasury',revealer:'revealer',owner:'governance'}))requireMatch(values[method].toLowerCase()===DEPLOYMENT_ADDRESSES[key].toLowerCase(),'wrong '+method);
  for(const [method,expected]of Object.entries({FEE_BPS:'100',MIN_STAKE:'5000000000000000000000',DURATION:'86400',UNLOCK_DELAY:'300',REVEAL_DURATION:'3600',currentRoundId:'0',challengeCount:'0'}))requireMatch(values[method]===expected,'unexpected '+method);
  if(draft.rulesVersion===8){requireMatch(await arena.RULES_VERSION(at)===8n,'wrong V2 rules version');values.RULES_VERSION='8';}
  const [chog,governance]=await Promise.all([validateChogAsset(provider),validateGovernance(provider,values.owner)]);
  requireMatch(governance.threshold===manifest.governance.threshold&&JSON.stringify(governance.owners.map(x=>x.toLowerCase()).sort())===JSON.stringify(manifest.governance.owners.map(x=>x.toLowerCase()).sort()),'governance changed since review');
  const canonical=await provider.getBlock(receipt.blockNumber);requireMatch(canonical?.hash===receipt.blockHash,'deployment block was reorganized');
  const simulationOnly=['127.0.0.1','localhost','[::1]'].includes(new URL(RPC_URL).hostname);
  const result={checkedAt:new Date().toISOString(),chainId:143,simulationOnly,mainnetDeploymentVerified:!simulationOnly,transactionHash:hash,arena:address,deploymentBlock:receipt.blockNumber,blockHash:receipt.blockHash,from:tx.from,initcodeHash:draft.initcodeHash,runtimeCodeHash:keccak256(code),runtimeMatchesCompiledTemplate:true,constructorAndRules:values,gasUsed:receipt.gasUsed.toString(),actualGasFeeMON:formatEther(receipt.gasUsed*receipt.gasPrice),chog,governance,realFundsEnabled:false,transactionsSignedByVerifier:0,transactionsSentByVerifier:0,limitation:'Creation/source-template/parameter check at configured RPC, not source publication or operational launch approval. Local RPC results are simulation only. App guard, keeper setup and controlled real-game rehearsal remain separate.'};
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();}
