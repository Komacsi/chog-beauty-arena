// Opt-in asset review. Public Monad reads, all writes confined to disposable Anvil.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,JsonRpcSigner,Wallet,Interface,TypedDataEncoder,keccak256,toBeHex,ZeroAddress,MaxUint256,id as selectorId} from 'ethers';
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {startReadOnlyForkRpc} from '../test-support/fork-rpc.mjs';
import {CHOG_TOKEN,CHAIN_ID,RPC_URL} from '../lib/config.mjs';
const [output,blockArg]=process.argv.slice(2);if(!output)throw Error('Pass a NEW output report path');
const implementation='0x7f64ccfeb3e3afd7691ea0ef404e947786cefae8';
const expectedHash='0x6dda419a8059dd56106bc3bc80bb22ffbe6e5a6f37bf42bf3a655a843e341c26';
// Nad.fun's official v3 ABI plus the two standard allowance adjustment methods
// actually present in this runtime. ABI provenance is not source verification.
const abi=[
  'function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function tokenURI() view returns(string)',
  'function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)','function increaseAllowance(address,uint256) returns(bool)','function decreaseAllowance(address,uint256) returns(bool)',
  'function transfer(address,uint256) returns(bool)','function transferFrom(address,address,uint256) returns(bool)','function burn(uint256)','function burnFrom(address,uint256)',
  'function initialize(string,string,string,address)','function setIsGraduated()',
  'function DOMAIN_SEPARATOR() view returns(bytes32)','function nonces(address) view returns(uint256)','function permitTypeHash() pure returns(bytes32)',
  'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  'error AlreadyInitialized()','error InvalidName()','error InvalidSymbol()','error TransferNotAllowedToPool()','error Unauthorized()'
];
const iface=new Interface(abi),connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const upstream=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});let evm,gateway;
function instructions(code){
  const bytes=Buffer.from(code.slice(2),'hex'),metadataSize=bytes.readUInt16BE(bytes.length-2),end=bytes.length-metadataSize-2,out=[];
  assert(end>0&&end<bytes.length);
  for(let pc=0;pc<end;pc++){const op=bytes[pc],size=op>=0x60&&op<=0x7f?op-0x5f:0;out.push({pc,op,arg:size?'0x'+bytes.subarray(pc+1,pc+1+size).toString('hex'):null});pc+=size;}
  return {out,executableBytes:end,metadataHex:'0x'+bytes.subarray(end).toString('hex')};
}
try{
  assert.equal(Number((await upstream.getNetwork()).chainId),CHAIN_ID);
  const block=blockArg?Number(blockArg):await upstream.getBlockNumber();assert(Number.isSafeInteger(block)&&block>0);
  const [code,proxyCode]=await Promise.all([upstream.getCode(implementation,block),upstream.getCode(CHOG_TOKEN,block)]);
  assert.equal(keccak256(code),expectedHash);assert.equal(proxyCode.toLowerCase(),'0x363d3d373d3d3d363d73'+implementation.slice(2)+'5af43d82803e903d91602b57fd5bf3');
  const scan=instructions(code),dispatcher=scan.out.filter((x,i)=>x.pc<0x16c&&x.op===0x63&&scan.out[i+1]?.op===0x14).map(x=>({selector:x.arg,pc:x.pc}));
  assert.equal(dispatcher.length,20);const functions=iface.fragments.filter(x=>x.type==='function');
  assert.deepEqual(dispatcher.map(x=>x.selector).sort(),functions.map(x=>x.selector).sort());
  const forbidden=scan.out.filter(x=>[0xf1,0xf2,0xf4,0xf5,0xff,0xf0].includes(x.op));assert.deepEqual(forbidden,[]);
  assert.equal(scan.out.filter(x=>x.op===0xfa).length,1);
  gateway=await startReadOnlyForkRpc(upstream);evm=await startLocalEvm({accounts:4,forkUrl:gateway.url,forkBlockNumber:block,stepsTracing:true});const p=evm.provider;
  const signers=await Promise.all(Array.from({length:4},(_,i)=>p.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const token=new Contract(CHOG_TOKEN,abi,signers[0]);
  const readSlot=n=>p.send('eth_getStorageAt',[CHOG_TOKEN,toBeHex(n),'latest']);
  const slot5=await readSlot(5),slot6=await readSlot(6),flags=BigInt(slot6),controller='0x'+slot5.slice(-40),pool='0x'+slot6.slice(-40);
  assert.equal(Number((flags>>160n)&255n),1);assert.equal(Number((flags>>168n)&255n),1);
  const initialSupply=await token.totalSupply(),initialName=await token.name(),initialSymbol=await token.symbol(),initialUri=await token.tokenURI();
  assert.equal(await token.decimals(),18n);assert.equal(initialName,'Chog');assert.equal(initialSymbol,'CHOG');
  for(const a of [controller,pool]){await p.send('anvil_impersonateAccount',[a]);await p.send('anvil_setBalance',[a,toBeHex(10n**20n)]);}
  const controllerToken=token.connect(new JsonRpcSigner(p,controller)),poolToken=token.connect(new JsonRpcSigner(p,pool));
  const rejected=[];
  for(const [label,t]of [['outsider',token],['controller',controllerToken],['pool',poolToken]]){
    await assert.rejects(t.initialize.staticCall('Changed','CHANGED','changed',addresses[0]),/AlreadyInitialized/);rejected.push('reinitialize:'+label);
  }
  await assert.rejects(token.setIsGraduated.staticCall(),/Unauthorized/);rejected.push('graduate:outsider');
  await(await controllerToken.setIsGraduated()).wait();assert.equal(await readSlot(6),slot6);
  // These selectors all hit the default revert branch, including from controller.
  const absent=['mint(address,uint256)','mint(address)','pause()','unpause()','setTax(uint256)','setFee(uint256)','setBlacklist(address,bool)','blacklist(address)','upgradeTo(address)','upgradeToAndCall(address,bytes)','transferOwnership(address)','setIsGraduated(bool)'];
  for(const signature of absent)for(const from of [addresses[0],controller]){
    const selector=selectorId(signature).slice(0,10);assert(!dispatcher.some(x=>x.selector===selector));
    await assert.rejects(p.call({to:CHOG_TOKEN,from,data:selector+'00'.repeat(128)}));
  }
  const exactTransfers=[];
  for(const amount of [0n,1n,5000n*10n**18n+1n,123456789012345678901234n]){
    const a=await token.balanceOf(pool),b=await token.balanceOf(addresses[0]);await(await poolToken.transfer(addresses[0],amount)).wait();
    assert.equal(await token.balanceOf(pool),a-amount);assert.equal(await token.balanceOf(addresses[0]),b+amount);exactTransfers.push(String(amount));
  }
  const funded=await token.balanceOf(addresses[0]);await assert.rejects(token.transfer.staticCall(ZeroAddress,1));await assert.rejects(token.transfer.staticCall(addresses[1],funded+1n));
  await assert.rejects(token.connect(signers[1]).transferFrom.staticCall(addresses[0],addresses[1],1));
  await assert.rejects(token.connect(signers[1]).burnFrom.staticCall(addresses[0],1));
  assert.equal(await token.balanceOf(addresses[0]),funded);assert.equal(await token.totalSupply(),initialSupply);
  await(await token.approve(addresses[1],1000)).wait();await(await token.increaseAllowance(addresses[1],20)).wait();await(await token.decreaseAllowance(addresses[1],10)).wait();assert.equal(await token.allowance(addresses[0],addresses[1]),1010n);
  const beforeRecipient=await token.balanceOf(addresses[2]);await(await token.connect(signers[1]).transferFrom(addresses[0],addresses[2],101)).wait();assert.equal(await token.balanceOf(addresses[2]),beforeRecipient+101n);assert.equal(await token.allowance(addresses[0],addresses[1]),909n);
  await(await token.connect(signers[1]).burnFrom(addresses[0],9)).wait();await(await token.burn(1)).wait();assert.equal(await token.totalSupply(),initialSupply-10n);
  await(await token.approve(addresses[1],MaxUint256)).wait();await(await token.connect(signers[1]).transferFrom(addresses[0],addresses[2],1)).wait();assert.equal(await token.allowance(addresses[0],addresses[1]),MaxUint256);
  // A reverting receiver confirms ordinary ERC20 transfer has no receiver callback.
  const receiver=await new ContractFactory([], '0x6005600c60003960056000f360006000fd',signers[0]).deploy();await receiver.waitForDeployment();
  await(await token.transfer(receiver.target,1)).wait();assert.equal(await token.balanceOf(receiver.target),1n);
  const owner=Wallet.createRandom(),domain={name:'Chog',version:'1',chainId:1337,verifyingContract:CHOG_TOKEN};
  assert.equal(await token.DOMAIN_SEPARATOR(),TypedDataEncoder.hashDomain(domain));
  await(await poolToken.transfer(owner.address,1000)).wait();const nonce=await token.nonces(owner.address),head=await p.getBlock('latest'),deadline=Number(head.timestamp)+600;
  const types={Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},values={owner:owner.address,spender:addresses[1],value:100n,nonce,deadline};
  const {Signature}=await import('ethers'),sig=Signature.from(await owner.signTypedData(domain,types,values));
  await assert.rejects(token.permit.staticCall(owner.address,addresses[1],101,deadline,sig.v,sig.r,sig.s));assert.equal(await token.nonces(owner.address),nonce);
  const receipt=await(await token.permit(owner.address,addresses[1],100,deadline,sig.v,sig.r,sig.s)).wait();assert.equal(await token.nonces(owner.address),nonce+1n);
  await assert.rejects(token.permit.staticCall(owner.address,addresses[1],100,deadline,sig.v,sig.r,sig.s));
  await(await token.connect(signers[1]).transferFrom(owner.address,addresses[2],100)).wait();assert.equal(await token.balanceOf(owner.address),900n);
  const trace=await p.send('debug_traceTransaction',[receipt.hash,{disableMemory:true,disableStorage:true}]);
  const calls=trace.structLogs.filter(s=>['CALL','CALLCODE','DELEGATECALL','STATICCALL','SELFDESTRUCT'].includes(s.op)).map(s=>({pc:s.pc,op:s.op,to:['STATICCALL','DELEGATECALL'].includes(s.op)?toBeHex(BigInt(s.stack.at(-2)),20):null}));
  assert.deepEqual(calls,[{pc:0x1f,op:'DELEGATECALL',to:implementation},{pc:0x1488,op:'STATICCALL',to:'0x0000000000000000000000000000000000000001'}]);
  // Diagnostic state override ONLY in the local fork: exercise the pre-graduation
  // branch and verify the privileged method can only set, never clear, bit 168.
  await p.send('anvil_setStorageAt',[CHOG_TOKEN,toBeHex(6,32),toBeHex(flags&~(255n<<168n),32)]);
  await assert.rejects(token.transfer.staticCall(pool,1),/TransferNotAllowedToPool/);await(await token.transfer(addresses[2],1)).wait();await(await poolToken.transfer(addresses[0],1)).wait();
  await(await controllerToken.setIsGraduated()).wait();assert.equal(await readSlot(6),slot6);await(await token.transfer(pool,1)).wait();
  assert.equal(await readSlot(5),slot5);assert.equal(await token.name(),initialName);assert.equal(await token.symbol(),initialSymbol);assert.equal(await token.tokenURI(),initialUri);
  assert.equal(await p.getCode(implementation),code);assert.equal(await p.getCode(CHOG_TOKEN),proxyCode);
  const result={checkedAt:new Date().toISOString(),chainId:143,forkBlock:block,localChainId:1337,token:CHOG_TOKEN,implementation,proxyCode,implementationCodeHash:keccak256(code),runtimeBytes:(code.length-2)/2,executableBytes:scan.executableBytes,metadataHex:scan.metadataHex,abiReference:'https://github.com/Naddotfun/contract-v3-abi/blob/35ca13bd26bb2a5418698b13ddcd07008eecc30a/IToken.json',sourceVerified:false,dispatcher:dispatcher.map(x=>({...x,signature:iface.getFunction(x.selector).format('sighash')})),controller,pool,initialFlags:{initialized:true,graduated:true},staticFindings:{callOrDelegatecallCreateSelfdestructOpcodes:0,staticcallOpcodes:1,defaultSelectorBranch:'revert at 0x016c',transferCore:'0x119f subtracts amount from sender and adds the same amount to recipient; no tax branch',initializeGuard:'slot 6 byte 20 already set; one-time mint constant 10^27',graduationWrite:'slot 6 byte 21 is only set to 1 by controller; no exposed clear path'},dynamicChecks:{reinitializationRejectedFromAllRoles:rejected,absentAdminSelectors:absent,controllerCannotMintOrReinitialize:true,graduationIdempotentAndOnlySetsBit168:true,exactTransferAmounts:exactTransfers,zeroAndInsufficientTransfersRejected:true,allowanceAndDelegatedBurnEnforced:true,authorizedBurnOnlyReducesSupply:true,unlimitedAllowancePreserved:true,revertingReceiverTransferSucceeded:true,validPermitWrongValueAndReplayChecked:true,permitExternalCalls:calls,diagnosticPreGraduationPoolRestrictionConfirmed:true,proxyAndImplementationCodeUnchanged:true,metadataAndRolesUnchanged:true},realTransactionsSent:0,limitations:'Independent bounded bytecode review plus single-state local Anvil adversarial tests, not matching compiler/source verification, formal proof or a Monad consensus test. Original Solidity/metadata source was not retrieved. Diagnostic storage override is local only and not an attack available to real users. Fixed code hash and current state are material assumptions; CHOG issuer/platform economics and future chain changes are outside this review.'};
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}finally{await evm?.close();await gateway?.close();upstream.destroy();}
