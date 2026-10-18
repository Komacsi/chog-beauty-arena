import {Contract,JsonRpcProvider,Wallet} from 'ethers';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RPC_URL,CHAIN_ID} from '../lib/config.mjs';
import {drandClient} from '../lib/timelock.mjs';
import {processRounds} from '../lib/keeper.mjs';
const key=process.env.KEEPER_PRIVATE_KEY,address=process.env.ARENA_CONTRACT_ADDRESS;
if(!key || !address)throw Error('Set KEEPER_PRIVATE_KEY and ARENA_CONTRACT_ADDRESS in your local .env; never put private keys in source control.');
if(!/^\d+$/.test(process.env.KEEPER_FROM_BLOCK || ''))throw Error('Set KEEPER_FROM_BLOCK to the contract deployment block.');
const provider=new JsonRpcProvider(RPC_URL,undefined,{batchMaxCount:1});
if(Number((await provider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Keeper RPC is on the wrong network');
const signer=new Wallet(key,provider);
const artifact=JSON.parse(await readFile(resolve(import.meta.dirname,'../artifacts/BeautyArena.json'),'utf8'));
const arena=new Contract(address,artifact.abi,signer),client=drandClient();
console.log(`Automatic opening keeper: ${signer.address}; network ${CHAIN_ID}. The keeper pays MON gas and cannot redirect participant payouts.`);
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
while(!stopped){
  try{console.log(JSON.stringify(await processRounds({arena,provider,fromBlock:Number(process.env.KEEPER_FROM_BLOCK),client})));}
  catch{console.error('Keeper cycle failed; will retry. Check RPC availability and keeper MON balance.');}
  if(process.argv.includes('--once'))break;
  await new Promise(done=>setTimeout(done,15000));
}
provider.destroy();
