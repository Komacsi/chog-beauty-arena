// Real Safe 1.5.0 runtime; only disposable local EVM signers are used here.
import {readFile} from 'node:fs/promises';
import {Contract,ContractFactory,ZeroAddress,ZeroHash,concat,zeroPadValue} from 'ethers';
const base=new URL('../node_modules/@safe-global/safe-smart-account/build/artifacts/contracts/',import.meta.url);
export const safeArtifact=JSON.parse(await readFile(new URL('SafeL2.sol/SafeL2.json',base),'utf8'));
export const proxyArtifact=JSON.parse(await readFile(new URL('proxies/SafeProxy.sol/SafeProxy.json',base),'utf8'));
export async function deploySafe(owners,{threshold=2}={}){
  const singleton=await new ContractFactory(safeArtifact.abi,safeArtifact.bytecode,owners[0]).deploy();await singleton.waitForDeployment();
  const proxy=await new ContractFactory(proxyArtifact.abi,proxyArtifact.bytecode,owners[0]).deploy(await singleton.getAddress());await proxy.waitForDeployment();
  const safe=new Contract(await proxy.getAddress(),safeArtifact.abi,owners[0]);
  await(await safe.setup(await Promise.all(owners.map(s=>s.getAddress())),threshold,ZeroAddress,'0x',ZeroAddress,ZeroAddress,0,ZeroAddress)).wait();
  async function execute(to,data,approvers=owners.slice(0,threshold)){
    const args=[to,0,data,0,0,0,0,ZeroAddress,ZeroAddress],nonce=await safe.nonce();
    const hash=await safe.getTransactionHash(...args,nonce),approved=[];
    for(const signer of approvers){await(await safe.connect(signer).approveHash(hash)).wait();approved.push(await signer.getAddress());}
    const signatures=concat(approved.sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())).map(address=>concat([zeroPadValue(address,32),ZeroHash,'0x01'])));
    if(!await safe.execTransaction.staticCall(...args,signatures))throw Error('Safe rejected transaction');
    return (await safe.execTransaction(...args,signatures,{gasLimit:2000000})).wait();
  }
  return {safe,execute};
}
