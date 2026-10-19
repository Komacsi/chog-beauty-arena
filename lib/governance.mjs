import {Contract,getAddress,keccak256,ZeroAddress,Interface} from 'ethers';
import hashes from './safe-codehashes.json' with {type:'json'};
const safeAbi=['function masterCopy() view returns(address)','function getThreshold() view returns(uint256)','function getOwners() view returns(address[])','function getModulesPaginated(address,uint256) view returns(address[],address)'];
export async function validateGovernance(provider,address){
  address=getAddress(address);
  if(keccak256(await provider.getCode(address))!==hashes.proxy)throw Error('Governance must be a verified Safe 1.5.0 proxy');
  const safe=new Contract(address,safeAbi,provider),implementation=await safe.masterCopy(),codeHash=keccak256(await provider.getCode(implementation));
  if(![hashes.safe,hashes.safeL2].includes(codeHash))throw Error('Unsupported governance implementation');
  const [threshold,owners,[modules]]=await Promise.all([safe.getThreshold(),safe.getOwners(),safe.getModulesPaginated('0x0000000000000000000000000000000000000001',1)]);
  if(threshold<2n || threshold>BigInt(owners.length))throw Error('Governance requires at least two confirmations');
  if(modules.length)throw Error('Disable governance modules that can bypass owner signatures');
  return {address,version:hashes.version,threshold:Number(threshold),owners:[...owners]};
}
const actions=new Interface(['function revokeRevealer()','function setRevealer(address)','function emergencyCancelRound(uint256)','function transferOwnership(address)','function acceptOwnership()']);
export function governanceProposal({arena,governance,chainId,action,value,createdAt=Date.now()}){
  if(!Number.isSafeInteger(Number(chainId)) || Number(chainId)<1)throw Error('Positive chain ID required');
  const address=getAddress(arena),safe=getAddress(governance);if(address===ZeroAddress || safe===ZeroAddress)throw Error('Nonzero arena and governance required');
  const methods={revoke:['revokeRevealer',[]],replace:['setRevealer',[value]],cancel:['emergencyCancelRound',[value]],'transfer-governance':['transferOwnership',[value]],'accept-governance':['acceptOwnership',[]]};
  const selected=Object.hasOwn(methods,action)?methods[action]:null;if(!selected)throw Error('Unknown governance action');
  if(action==='cancel' && (!/^\d+$/.test(String(value)) || BigInt(value)<1n))throw Error('Positive round ID required');
  if(['replace','transfer-governance'].includes(action) && getAddress(value)===ZeroAddress)throw Error('Nonzero replacement required');
  return {version:'1.0',chainId:String(chainId),createdAt,meta:{name:'Chog Arena: '+action,description:'Verify chain, arena, function and parameters in Safe before approving.',txBuilderVersion:'1.18.0',createdFromSafeAddress:safe},transactions:[{to:address,value:'0',data:actions.encodeFunctionData(...selected),contractMethod:null,contractInputsValues:null}]};
}
