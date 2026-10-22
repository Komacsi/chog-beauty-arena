// Operator-only read-only simulation; no signer, credential access or send RPC.
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,formatEther,keccak256} from 'ethers';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {validateGovernance} from '../lib/governance.mjs';
import {RELEASE_STATUS} from '../lib/release.mjs';
import {validateChogAsset} from '../lib/chog-asset.mjs';
const root=resolve(import.meta.dirname,'..');
const addresses={
  token:'0x350035555e10d9afaf1566aaebfced5ba6c27777',
  collection:'0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
  treasury:'0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D',
  revealer:'0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908',
  governance:'0xa94995D21B5e02eED9472651fe6c4B2a8d6fD47d'
};
const proposedDeployer=addresses.treasury;
// Owner confirmation is recorded in security/deployment-addresses.json.
const addressSelection=JSON.parse(await readFile(resolve(root,'security/deployment-addresses.json'),'utf8'));
if(addressSelection.status!=='addresses_confirmed_by_owner' || addressSelection.chainId!==143)throw Error('Owner address selection is not confirmed');
for(const [key,value]of Object.entries({deployer:proposedDeployer,treasury:addresses.treasury,governance:addresses.governance,keeper:addresses.revealer})){
  if(String(addressSelection[key]).toLowerCase()!==value.toLowerCase())throw Error('Owner address selection mismatch: '+key);
}
const request=new FetchRequest('https://rpc.monad.xyz');request.timeout=15000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1});
try{
  if((await provider.getNetwork()).chainId!==143n)throw Error('Wrong chain');
  const chogAsset=await validateChogAsset(provider,addresses.token);
  const artifactBytes=await readFile(resolve(root,'artifacts/BeautyArena.json'));
  const artifact=JSON.parse(artifactBytes),factory=new ContractFactory(artifact.abi,artifact.bytecode);
  const unsigned=await factory.getDeployTransaction(...Object.values(addresses));
  const block=await provider.getBlockNumber();
  const [governance,gas,fees,deployerBalance,keeperBalance,keeperCode,decimals]=await Promise.all([
    validateGovernance(provider,addresses.governance),
    provider.estimateGas({...unsigned,from:proposedDeployer}),provider.getFeeData(),
    provider.getBalance(proposedDeployer),provider.getBalance(addresses.revealer),provider.getCode(addresses.revealer),
    new Contract(addresses.token,['function decimals() view returns(uint8)'],provider).decimals()
  ]);
  const expectedOwners=['0x6084D9f004206E4d548AEA2b694411CC6F07f6e5','0xbB3e1fD0962676D04B77EFf69c21Fa51692A5338',addresses.treasury].map(a=>a.toLowerCase()).sort();
  if(JSON.stringify(governance.owners.map(a=>a.toLowerCase()).sort())!==JSON.stringify(expectedOwners))throw Error('Safe owner mismatch');
  if(keeperCode!=='0x' || decimals!==18n)throw Error('Keeper or token assumptions changed');
  const gasLimit=(gas*120n+99n)/100n,feeCap=fees.maxFeePerGas??fees.gasPrice;
  if(feeCap===null)throw Error('Fee quote unavailable');
  const report={
    checkedAt:new Date().toISOString(),operatorDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),timezone:'Europe/Moscow',chainId:143,observedBlock:block,
    purpose:'Read-only contract-creation estimate. Draft only; no deployment approval or transaction.',
    constructorParameters:addresses,proposedDeployer,deployerConfirmedByOwner:true,treasuryConfirmedByOwner:true,addressSelection:'security/deployment-addresses.json',
    chogAsset,
    compilation:{artifactSha256:createHash('sha256').update(artifactBytes).digest('hex'),creationBytecodeKeccak256:keccak256(artifact.bytecode),creationBytecodeBytes:(artifact.bytecode.length-2)/2,unsignedInitcodeKeccak256:keccak256(unsigned.data),unsignedInitcodeBytes:(unsigned.data.length-2)/2,optimizerRuns:200,evmVersion:'shanghai'},
    governance:{...governance,suppliedOwnersMatch:true},keeper:{address:addresses.revealer,code:keeperCode,balanceMON:formatEther(keeperBalance)},
    estimate:{gasUnits:gas.toString(),illustrativeGasLimitWith20PercentBuffer:gasLimit.toString(),gasPriceWei:fees.gasPrice?.toString()??null,maxFeePerGasWei:fees.maxFeePerGas?.toString()??null,maxPriorityFeePerGasWei:fees.maxPriorityFeePerGas?.toString()??null,illustrativeGasBudgetMON:formatEther(gasLimit*feeCap),proposedDeployerBalanceMON:formatEther(deployerBalance),proposedDeployerCoversIllustrativeBudget:deployerBalance>=gasLimit*feeCap},
    release:{realFundsEnabled:RELEASE_STATUS.realFundsEnabled,blockingFindings:RELEASE_STATUS.blockingFindings,acceptedRisks:RELEASE_STATUS.acceptedRisks,arenaDeployed:false,keeperServiceStarted:false},
    transactionsSigned:0,transactionsSent:0,
    limitations:['RPC estimation executes the constructor in simulation only; it does not deploy code or prove game security.','CHOG identity/state is checked at its recorded block. Safe state, balances and fee quote are latest reads, not an atomic shared snapshot. Recheck immediately before any user-signed deployment.','Gas budget is a temporary quote with a 20% gas-unit buffer, not a fee guarantee.','No matching CHOG implementation source verified and no mainnet reveal-throughput check. Telegram/external API alert delivery is separately recorded in security/operational-readiness.json. SEC-03/04 remain open.','No credential file is read by this tool. The owner confirmed the deployer and immutable treasury address; actual transaction review/signing and release readiness remain separate.']
  };
  await writeFile(resolve(root,'security/deployment-preflight.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{provider.destroy();}
