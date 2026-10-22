// Offline source bundle plus read-only RPC simulation. No signer or send calls.
import solc from 'solc';
import {ContractFactory,FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deploymentDraft,DEPLOYMENT_ADDRESSES,DEPLOYER,reviewDeploymentWallet} from '../lib/deployment-draft.mjs';
import {RELEASE_STATUS} from '../lib/release.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??'');
const v2=process.argv.includes('--v2'),contractName=v2?'BeautyArenaV2':'BeautyArena',sourceName=contractName+'.sol';
if(!process.argv[2]||!out.startsWith(resolve(root,'artifacts')+sep))throw Error('Pass a NEW directory inside artifacts/');
const confirmation=JSON.parse(await readFile(resolve(root,'security/deployment-addresses.json'),'utf8'));
for(const [key,value]of Object.entries({deployer:DEPLOYER,treasury:DEPLOYMENT_ADDRESSES.treasury,keeper:DEPLOYMENT_ADDRESSES.revealer,governance:DEPLOYMENT_ADDRESSES.governance})){
  if(confirmation.status!=='addresses_confirmed_by_owner'||confirmation.chainId!==143||String(confirmation[key]).toLowerCase()!==value.toLowerCase())throw Error('Owner confirmation mismatch');
}
if(!solc.version().startsWith('0.8.30+commit.73712a01'))throw Error('Use the reviewed solc 0.8.30 build');
const input={language:'Solidity',sources:{[sourceName]:{content:await readFile(resolve(root,'contracts',sourceName),'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode','evm.deployedBytecode']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{
  const file=resolve(root,'node_modules',path),base=resolve(root,'node_modules/@openzeppelin/contracts')+sep;
  if(!file.startsWith(base))return {error:'Import outside reviewed OpenZeppelin package'};
  const content=readFileSync(file,'utf8');input.sources[path]={content};return {contents:content};
}}));
const errors=compiled.errors?.filter(x=>x.severity==='error')??[];if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const contract=compiled.contracts[sourceName][contractName],artifact={abi:contract.abi,bytecode:'0x'+contract.evm.bytecode.object};
const old=JSON.parse(await readFile(resolve(root,'artifacts',contractName+'.json'),'utf8'));
if(artifact.bytecode!==old.bytecode||JSON.stringify(artifact.abi)!==JSON.stringify(old.abi))throw Error('Source bundle differs from current reviewed artifact');
const replay=JSON.parse(solc.compile(JSON.stringify(input)));
if(replay.contracts?.[sourceName]?.[contractName]?.evm.bytecode.object!==contract.evm.bytecode.object)throw Error('Self-contained source bundle does not reproduce the exact bytecode');
const request=new FetchRequest('https://rpc.monad.xyz');request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
  const [latest,pending,fees]=await Promise.all([provider.send('eth_getTransactionCount',[DEPLOYER,'latest']),provider.send('eth_getTransactionCount',[DEPLOYER,'pending']),provider.getFeeData()]);
  if(BigInt(latest)!==BigInt(pending))throw Error('Deployer has a pending transaction');
  const raw=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...Object.values(DEPLOYMENT_ADDRESSES));
  const gas=await provider.estimateGas({...raw,from:DEPLOYER}),maxFee=fees.maxFeePerGas;
  if(maxFee===null||fees.maxPriorityFeePerGas===null)throw Error('EIP-1559 fee quote missing');
  const draft=await deploymentDraft(artifact,{nonce:Number(BigInt(pending)),gasLimit:(gas*120n+99n)/100n,maxFeePerGas:maxFee,maxPriorityFeePerGas:fees.maxPriorityFeePerGas,rulesVersion:v2?8:7});
  // Review uses only eth_accounts for identity. No wallet authorization/signing.
  const reader=new Proxy(provider,{get(target,key){if(key==='send')return async(method,params)=>method==='eth_accounts'?[DEPLOYER]:target.send(method,params);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const review=await reviewDeploymentWallet(reader,draft);
  await mkdir(out); // Refuse overwriting any previous review bundle.
  const sourceText=JSON.stringify(input,null,2)+'\n';
  const manifest={createdAt:new Date().toISOString(),compiler:solc.version(),contract:sourceName+':'+contractName,rulesVersion:v2?8:7,optimizerRuns:200,evmVersion:'shanghai',sourceCount:Object.keys(input.sources).length,sourceInputSha256:createHash('sha256').update(sourceText).digest('hex'),creationBytecodeHash:keccak256(artifact.bytecode),initcodeHash:draft.initcodeHash,addresses:draft.addresses,deployer:DEPLOYER,predictedAddress:draft.predictedAddress,nonce:Number(BigInt(pending)),maximumGasCostWei:draft.maximumGasCostWei,chog:review.chog,governance:review.safe,release:v2?{realFundsEnabled:false,status:'pending_v2_deployment_and_cutover',currentLiveArena:RELEASE_STATUS.arenaAddress}:RELEASE_STATUS,transactionsSigned:0,transactionsSent:0,scope:'Prepared unsigned request and source verification bundle. Any wallet request/final send is a separate human action. Prediction depends on the unchanged nonce; not an existing contract.'};
  for(const [name,value]of Object.entries({'deployment.json':draft,'manifest.json':manifest,'artifact.json':artifact,'runtime-template.json':contract.evm.deployedBytecode}))await writeFile(resolve(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(out,'source-input.json'),sourceText,{flag:'wx'});
  execFileSync(process.execPath,['scripts/build-deployment-page.mjs',out],{cwd:root,stdio:'inherit'});
  console.log(JSON.stringify({output:relative(root,out),...manifest},null,2));
}finally{provider.destroy();}
