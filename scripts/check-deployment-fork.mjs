// Executes the exact prepared request ONLY on a disposable loopback Anvil fork.
// The read-only gateway prevents upstream mutation even with local chain ID 143.
import assert from 'node:assert/strict';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {startReadOnlyForkRpc} from '../test-support/fork-rpc.mjs';
import {reviewDeploymentWallet,DEPLOYER} from '../lib/deployment-draft.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]),output=process.argv[3];
if(!output)throw Error('Pass PREPARED_DIRECTORY and NEW_REPORT.json');
const draft=JSON.parse(await readFile(resolve(directory,'deployment.json'),'utf8')),manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
const connection=new FetchRequest('https://rpc.monad.xyz');connection.timeout=15000;
const upstream=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});let gateway,evm;
try{
  assert.equal((await upstream.getNetwork()).chainId,143n);gateway=await startReadOnlyForkRpc(upstream);
  evm=await startLocalEvm({forkUrl:gateway.url,forkBlockNumber:manifest.chog.block,chainId:143});const p=evm.provider;
  await p.send('anvil_impersonateAccount',[DEPLOYER]);await p.send('anvil_setBalance',[DEPLOYER,'0x56bc75e2d63100000']);
  const reader=new Proxy(p,{get(target,key){if(key==='send')return async(method,params)=>method==='eth_accounts'?[DEPLOYER]:target.send(method,params);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const review=await reviewDeploymentWallet(reader,draft);
  const hash=await p.send('eth_sendTransaction',[review.request]);await p.waitForTransaction(hash);await p.send('evm_mine',[]);
  const verificationPath=output+'.verification.json';
  const result=await promisify(execFile)(process.execPath,['scripts/verify-deployment.mjs',directory,hash,verificationPath],{cwd:root,env:{...process.env,MONAD_RPC_URL:evm.url},windowsHide:true,timeout:45000,maxBuffer:300000});
  const verified=JSON.parse(await readFile(verificationPath,'utf8'));assert.equal(verified.simulationOnly,true);assert.equal(verified.mainnetDeploymentVerified,false);assert.equal(verified.runtimeMatchesCompiledTemplate,true);
  const report={checkedAt:new Date().toISOString(),upstreamChainId:143,forkBlock:manifest.chog.block,localChainId:143,environment:'Disposable loopback Anvil through read-only upstream gateway; local chain 143 intentionally tests the exact prepared request',preparedInitcodeHash:draft.initcodeHash,preparedNonce:Number(BigInt(draft.request.nonce)),constructorAndRuntimeVerification:'passed',predictedAddressMatchesLocalReceipt:true,governanceAndChogRechecked:true,localGasUsed:verified.gasUsed,transactionsSentToLocalFork:1,realTransactionsSent:0,mainnetArenaDeployed:false,limitations:'Local Shanghai EVM, fake MON and impersonation only; no real key/signing or mainnet transaction. Not a mainnet gas/consensus proof or launch approval.'};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
}finally{await evm?.close();await gateway?.close();upstream.destroy();}
