// Read-only cutover guard. Never signs, sends, cancels or migrates deposits.
import {Contract,FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
const request=new FetchRequest('https://rpc.monad.xyz');request.timeout=15000;
const provider=new JsonRpcProvider(request,143,{batchMaxCount:1,cacheTimeout:-1});
try{
  const address='0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5',blockTag=await provider.getBlockNumber();
  if(keccak256(await provider.getCode(address,blockTag))!=='0xbd74a3b91d02ec76e7420b32847d4972fffc2f685564e4d3907cb6b8c7b7e9b5')throw Error('V1 identity changed');
  const old=new Contract(address,['function currentRoundId() view returns(uint256)','function challengeCount() view returns(uint256)'],provider);
  const token=new Contract('0x350035555e10d9afaf1566aaebfced5ba6c27777',['function balanceOf(address) view returns(uint256)'],provider);
  const [rounds,challenges,balance]=await Promise.all([old.currentRoundId({blockTag}),old.challengeCount({blockTag}),token.balanceOf(address,{blockTag})]);
  if(rounds!==0n||challenges!==0n||balance!==0n)throw Error('V1 is no longer empty; preserve its keeper and review a migration separately');
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),block:blockTag,arena:address,rounds:0,challenges:0,bankCHOGUnits:'0',transactionsSent:0}));
}finally{provider.destroy();}
