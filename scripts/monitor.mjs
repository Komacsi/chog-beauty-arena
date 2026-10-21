import {Contract,FetchRequest,JsonRpcProvider,parseUnits} from 'ethers';
import {readFile} from 'node:fs/promises';
import {RPC_URL,CHAIN_ID} from '../lib/config.mjs';
import {validateGovernance} from '../lib/governance.mjs';
import {monitorArena} from '../lib/monitor.mjs';
import {keeperHealthAlerts} from '../lib/keeper-health.mjs';
const address=process.env.ARENA_CONTRACT_ADDRESS;if(!address)throw Error('Set the public ARENA_CONTRACT_ADDRESS');
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const provider=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
try{
  if(Number((await provider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Wrong network');
  const {abi}=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8'));
  const minimumGas=parseUnits(process.env.KEEPER_MIN_MON || '0.1',18);if(minimumGas<0n)throw Error('Invalid gas alert threshold');
  const result=await monitorArena({arena:new Contract(address,abi,provider),provider,validateGovernance,minimumGas,maxRounds:Number(process.env.MONITOR_MAX_ROUNDS || 200)});
  if(process.env.KEEPER_HEALTH_PATH)result.alerts.push(...await keeperHealthAlerts(process.env.KEEPER_HEALTH_PATH));
  console.log(JSON.stringify(result));if(result.alerts.length)process.exitCode=2;
}catch{console.error(JSON.stringify({alerts:[{code:'MONITOR_FAILED'}]}));process.exitCode=2;}finally{provider.destroy();}
