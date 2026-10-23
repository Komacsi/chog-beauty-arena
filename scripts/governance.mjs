// Produces a Safe Transaction Builder import. Never signs or broadcasts.
import {Contract,FetchRequest,JsonRpcProvider} from 'ethers';
import {readFile,writeFile} from 'node:fs/promises';
import {RPC_URL,CHAIN_ID} from '../lib/config.mjs';
import {validateGovernance,governanceProposal} from '../lib/governance.mjs';
const args=process.argv.slice(2),outputIndex=args.indexOf('--output');
const output=outputIndex<0?null:args.splice(outputIndex,2)[1];
if(outputIndex>=0 && !output)throw Error('--output requires a file path');
const [action,value]=args,address=process.env.ARENA_CONTRACT_ADDRESS;
if(args.length>2)throw Error('Usage: governance ACTION [VALUE] [--output FILE]');
if(!address)throw Error('Set the public ARENA_CONTRACT_ADDRESS');
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const provider=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
try{
  if(Number((await provider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Wrong network');
  const {abi}=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8')),arena=new Contract(address,abi,provider);
  const governance=action==='accept-governance'?await arena.pendingOwner():await arena.owner();await validateGovernance(provider,governance);
  const proposal=governanceProposal({arena:address,governance,chainId:CHAIN_ID,action,value});
  // Simulate the arena call as the Safe. Approvals are still required in Safe.
  await provider.call({from:governance,to:address,data:proposal.transactions[0].data});
  const json=JSON.stringify(proposal,null,2)+'\n';
  if(output){await writeFile(output,json,{flag:'wx'});console.log('Safe proposal saved: '+output);}else process.stdout.write(json);
}finally{provider.destroy();}
