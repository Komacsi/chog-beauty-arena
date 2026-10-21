import {Contract,JsonRpcProvider,FetchRequest} from 'ethers';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RPC_URL,CHAIN_ID} from '../lib/config.mjs';
import {drandClient} from '../lib/timelock.mjs';
import {keeperCycle} from '../lib/keeper-cycle.mjs';
import {ChainIndex} from '../lib/chain-index.mjs';
import {KeeperTransactions} from '../lib/keeper-transactions.mjs';
import {writeKeeperHealth} from '../lib/keeper-health.mjs';
import {assertLiveReleaseAllowed} from '../lib/release.mjs';
import {loadKeeperSigner} from '../lib/keeper-signer.mjs';
import {validateGovernance} from '../lib/governance.mjs';
const address=process.env.ARENA_CONTRACT_ADDRESS;
assertLiveReleaseAllowed(address);
if(!address)throw Error('Set ARENA_CONTRACT_ADDRESS and encrypted keeper credential paths.');
if(!/^\d+$/.test(process.env.KEEPER_FROM_BLOCK || ''))throw Error('Set KEEPER_FROM_BLOCK to the contract deployment block.');
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const provider=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
if(Number((await provider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Keeper RPC is on the wrong network');
const signer=await loadKeeperSigner(provider);
const artifact=JSON.parse(await readFile(resolve(import.meta.dirname,'../artifacts/BeautyArena.json'),'utf8'));
const arena=new Contract(address,artifact.abi,signer),client=drandClient();
await validateGovernance(provider,await arena.owner());
if((await arena.revealer()).toLowerCase()!==signer.address.toLowerCase())throw Error('Keeper wallet is not the current automatic revealer of this arena');
const fromBlock=Number(process.env.KEEPER_FROM_BLOCK),stateDir=process.env.KEEPER_STATE_DIR;
if(!stateDir)throw Error('Set a persistent private KEEPER_STATE_DIR outside the checkout');
if(fromBlock<1 || await provider.getCode(address,fromBlock-1)!=='0x' || await provider.getCode(address,fromBlock)==='0x')throw Error('KEEPER_FROM_BLOCK must be the actual arena deployment block');
await mkdir(stateDir,{recursive:true,mode:0o700});
const index=new ChainIndex(resolve(stateDir,'events.sqlite'),{chainId:CHAIN_ID,arena:address,fromBlock});
const transactions=new KeeperTransactions(resolve(stateDir,'transactions.sqlite'),{provider,signer,arena:address,chainId:CHAIN_ID});
const healthPath=process.env.KEEPER_HEALTH_PATH;
if(!healthPath)throw Error('Set a public KEEPER_HEALTH_PATH separate from the private journal directory');
console.log(`Automatic opening keeper: ${signer.address}; network ${CHAIN_ID}. The keeper pays MON gas and cannot redirect participant payouts.`);
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
while(!stopped){
  try{const result=await keeperCycle({arena,provider,index,transactions,chainId:CHAIN_ID,client,expectedRevealer:signer.address});await writeKeeperHealth(healthPath,result);console.log(JSON.stringify(result));if(result.phase==='revoked'){console.error('Keeper authorization revoked or replaced; stopping.');break;}}
  catch{await writeKeeperHealth(healthPath,{phase:'error'});console.error('Keeper cycle failed; will retry. Check RPC, pending nonce, fee caps, disk and MON balance.');}
  if(process.argv.includes('--once'))break;
  await new Promise(done=>setTimeout(done,1000));
}
index.close();transactions.close();provider.destroy();
