// Exact identity/state check for the reviewed deployed CHOG. No signer or writes.
import {Interface,keccak256,toBeHex,toQuantity} from 'ethers';
export const REVIEWED_CHOG=Object.freeze({
  chainId:143n,
  token:'0x350035555e10d9afaf1566aaebfced5ba6c27777',
  implementation:'0x7f64ccfeb3e3afd7691ea0ef404e947786cefae8',
  implementationCodeHash:'0x6dda419a8059dd56106bc3bc80bb22ffbe6e5a6f37bf42bf3a655a843e341c26',
  controller:'0xa7283d07812a02afb7c09b60f8896bcea3f90ace',
  pool:'0x116e7d070f1888b81e1e0324f56d6746b2d7d8f1'
});
const abi=new Interface(['function decimals() view returns(uint8)']);
const proxyCode='0x363d3d373d3d3d363d73'+REVIEWED_CHOG.implementation.slice(2)+'5af43d82803e903d91602b57fd5bf3';
const expectedFlags=BigInt(REVIEWED_CHOG.pool)|(1n<<160n)|(1n<<168n);
function requireMatch(condition,reason){if(!condition)throw Error('CHOG asset check failed: '+reason);}
export async function validateChogAsset(provider,token=REVIEWED_CHOG.token){
  requireMatch(String(token).toLowerCase()===REVIEWED_CHOG.token,'unexpected token address');
  requireMatch((await provider.getNetwork()).chainId===REVIEWED_CHOG.chainId,'wrong chain');
  const block=await provider.getBlockNumber();
  requireMatch(Number.isSafeInteger(block)&&block>0,'missing block number');
  // send bypasses AbstractProvider's short request cache for the two headers.
  const before=await provider.send('eth_getBlockByNumber',[toQuantity(block),false]);
  requireMatch(before&&Number(BigInt(before.number))===block&&/^0x[0-9a-f]{64}$/i.test(before.hash),'missing block identity');
  const [proxy,implementation,controllerWord,flagsWord,decimalsWord]=await Promise.all([
    provider.getCode(REVIEWED_CHOG.token,block),
    provider.getCode(REVIEWED_CHOG.implementation,block),
    provider.getStorage(REVIEWED_CHOG.token,5,block),
    provider.getStorage(REVIEWED_CHOG.token,6,block),
    provider.call({to:REVIEWED_CHOG.token,data:abi.encodeFunctionData('decimals'),blockTag:block})
  ]);
  requireMatch(proxy.toLowerCase()===proxyCode,'proxy bytecode changed');
  requireMatch(keccak256(implementation)===REVIEWED_CHOG.implementationCodeHash,'implementation bytecode changed');
  for(const word of [controllerWord,flagsWord])requireMatch(/^0x[0-9a-f]{64}$/i.test(word),'malformed storage response');
  requireMatch(BigInt(controllerWord)===BigInt(REVIEWED_CHOG.controller),'controller state changed');
  requireMatch(BigInt(flagsWord)===expectedFlags,'pool or initialized/graduated state changed');
  requireMatch(/^0x[0-9a-f]{64}$/i.test(decimalsWord)&&abi.decodeFunctionResult('decimals',decimalsWord)[0]===18n,'decimals changed');
  const after=await provider.send('eth_getBlockByNumber',[toQuantity(block),false]);
  requireMatch(after?.hash===before.hash,'snapshot block reorganized');
  return {chainId:143,block,blockHash:before.hash,token:REVIEWED_CHOG.token,
    proxyCodeHash:keccak256(proxy),implementation:REVIEWED_CHOG.implementation,
    implementationCodeHash:keccak256(implementation),controller:REVIEWED_CHOG.controller,
    pool:REVIEWED_CHOG.pool,initialized:true,graduated:true,decimals:18,
    controllerWord:toBeHex(BigInt(controllerWord),32),flagsWord:toBeHex(BigInt(flagsWord),32),
    sourceVerified:false,scope:'Exact reviewed identity and storage assumptions at one block; not source verification or release approval.'};
}
