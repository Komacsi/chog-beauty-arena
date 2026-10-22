// Public, unsigned contract-creation request. No key loading or broadcasting.
import {AbiCoder,ContractFactory,getAddress,getCreateAddress,keccak256,toQuantity} from 'ethers';
import {validateChogAsset} from './chog-asset.mjs';
import {validateGovernance} from './governance.mjs';
export const DEPLOYMENT_ADDRESSES=Object.freeze({
  token:'0x350035555e10d9afaf1566aaebfced5ba6c27777',
  collection:'0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
  treasury:'0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D',
  revealer:'0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908',
  governance:'0xa94995D21B5e02eED9472651fe6c4B2a8d6fD47d'
});
export const DEPLOYER=DEPLOYMENT_ADDRESSES.treasury;
export const CREATION_HASH='0x77d268dd2950a9f2e21ffbc60d6ae84c419fa95584ee1ffa7745ea143e10199e';
export const V2_CREATION_HASH='0x34bfa423690d3a62ffabebb06dec6b99cbdb056a4fab5eafc548333cf1a6f0cd';
function creationHash(version){check(version===7||version===8,'unknown rules version');return version===8?V2_CREATION_HASH:CREATION_HASH;}
const args=Object.values(DEPLOYMENT_ADDRESSES),types=Array(5).fill('address');
const owners=['0x6084D9f004206E4d548AEA2b694411CC6F07f6e5','0xbB3e1fD0962676D04B77EFf69c21Fa51692A5338',DEPLOYER].map(x=>x.toLowerCase()).sort();
function check(ok,reason){if(!ok)throw Error('Deployment review: '+reason);}
export async function deploymentDraft(artifact,{nonce,gasLimit,maxFeePerGas,maxPriorityFeePerGas,checkedAt=new Date().toISOString(),rulesVersion=7}){
  check(keccak256(artifact.bytecode)===creationHash(rulesVersion),'creation bytecode differs from reviewed build');
  const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...args);
  check(tx.data===artifact.bytecode+AbiCoder.defaultAbiCoder().encode(types,args).slice(2),'constructor layout differs');
  check(Number.isSafeInteger(nonce)&&nonce>=0,'invalid nonce');
  const request={chainId:'0x8f',from:DEPLOYER,type:'0x2',nonce:toQuantity(nonce),value:'0x0',data:tx.data,
    gas:toQuantity(gasLimit),maxFeePerGas:toQuantity(maxFeePerGas),maxPriorityFeePerGas:toQuantity(maxPriorityFeePerGas)};
  const draft={schema:1,...(rulesVersion===8?{rulesVersion}:{}),checkedAt,addresses:{...DEPLOYMENT_ADDRESSES},creationBytecode:artifact.bytecode,
    initcodeHash:keccak256(tx.data),predictedAddress:getCreateAddress({from:DEPLOYER,nonce}),
    maximumGasCostWei:(BigInt(gasLimit)*BigInt(maxFeePerGas)).toString(),request,
    purpose:rulesVersion===8?'New V2 arena: battle participants may bet CHOG but cannot vote. Current live arena remains unchanged until separate verified cutover. Human signing in Rabby only.':'Single mainnet contract creation for human review/signing in Rabby. App real-funds release remains disabled.'};
  validateDeploymentDraft(draft);return draft;
}
export function validateDeploymentDraft(draft){
  check(draft?.schema===1,'unknown draft format');
  const tx=draft.request;
  check(tx&&tx.chainId==='0x8f'&&tx.type==='0x2'&&tx.value==='0x0'&&!Object.hasOwn(tx,'to'),'must be zero-value Monad contract creation');
  check(Object.keys(tx).sort().join(',')==='chainId,data,from,gas,maxFeePerGas,maxPriorityFeePerGas,nonce,type,value','unexpected transaction fields');
  check(getAddress(tx.from)===getAddress(DEPLOYER),'wrong deployer');
  check(Object.keys(draft.addresses??{}).sort().join(',')===Object.keys(DEPLOYMENT_ADDRESSES).sort().join(','),'address fields changed');
  for(const [key,value]of Object.entries(DEPLOYMENT_ADDRESSES))check(getAddress(draft.addresses[key])===getAddress(value),'wrong '+key);
  check(keccak256(draft.creationBytecode)===creationHash(draft.rulesVersion??7),'creation bytecode changed');
  check(tx.data===draft.creationBytecode+AbiCoder.defaultAbiCoder().encode(types,args).slice(2),'constructor/initcode changed');
  check(keccak256(tx.data)===draft.initcodeHash,'initcode hash changed');
  const nonce=Number(BigInt(tx.nonce)),gas=BigInt(tx.gas),fee=BigInt(tx.maxFeePerGas),tip=BigInt(tx.maxPriorityFeePerGas);
  check(Number.isSafeInteger(nonce)&&nonce>=0&&gas>0n&&gas<=30_000_000n&&fee>0n&&tip>=0n&&tip<=fee,'invalid nonce/gas/fee');
  check(draft.maximumGasCostWei===(gas*fee).toString(),'gas budget differs');
  check(getCreateAddress({from:DEPLOYER,nonce})===draft.predictedAddress,'predicted contract differs');
  return {...tx};
}
// Re-run immediately before a human-triggered wallet request. Never calls send.
export async function reviewDeploymentWallet(provider,draft){
  const tx=validateDeploymentDraft(draft),accounts=await provider.send('eth_accounts',[]);
  check(Array.isArray(accounts)&&getAddress(accounts[0])===getAddress(DEPLOYER),'select the confirmed deployer in Rabby');
  check(BigInt(await provider.send('eth_chainId',[]))===143n,'select Monad mainnet in Rabby');
  const [chog,safe,latest,pending,balance,gas,head]=await Promise.all([
    validateChogAsset(provider),validateGovernance(provider,DEPLOYMENT_ADDRESSES.governance),
    provider.send('eth_getTransactionCount',[DEPLOYER,'latest']),provider.send('eth_getTransactionCount',[DEPLOYER,'pending']),
    provider.getBalance(DEPLOYER),provider.estimateGas(tx),provider.getBlock('latest')
  ]);
  check(safe.threshold===2&&JSON.stringify(safe.owners.map(x=>x.toLowerCase()).sort())===JSON.stringify(owners),'Safe owners/threshold changed');
  check(BigInt(latest)===BigInt(pending)&&BigInt(pending)===BigInt(tx.nonce),'nonce changed or a transaction is pending; prepare a new draft');
  check(balance>=BigInt(draft.maximumGasCostWei),'insufficient MON for the displayed gas cap');
  check(gas<=BigInt(tx.gas),'gas estimate exceeds the displayed limit');
  check(head?.baseFeePerGas!==null&&head?.baseFeePerGas!==undefined&&head.baseFeePerGas+BigInt(tx.maxPriorityFeePerGas)<=BigInt(tx.maxFeePerGas),'network fee exceeds the displayed cap; prepare a new draft');
  const after=await provider.send('eth_accounts',[]),chain=await provider.send('eth_chainId',[]);
  check(getAddress(after[0])===getAddress(DEPLOYER)&&BigInt(chain)===143n,'wallet account/network changed during checks');
  return {request:tx,chog,safe};
}
