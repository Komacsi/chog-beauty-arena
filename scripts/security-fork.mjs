// Opt-in LOCAL fork test. All transactions go to an in-process Ganache provider.
// The upstream Monad connection is used only for state reads; no real keys loaded.
import ganache from 'ganache';
import assert from 'node:assert/strict';
import {BrowserProvider,Contract,ContractFactory,JsonRpcProvider,FetchRequest,parseUnits,toUtf8Bytes} from 'ethers';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {RPC_URL,CHAIN_ID,CHOG_TOKEN,COLLECTION} from '../lib/config.mjs';
import {makeCommitment,makeSalt} from '../lib/commitments.mjs';
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const upstream=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
let transport,provider;
try{
  assert.equal(Number((await upstream.getNetwork()).chainId),CHAIN_ID);
  const block=await upstream.getBlockNumber(),collection=new Contract(COLLECTION,['function ownerOf(uint256) view returns(address)'],upstream);
  const nftA=299,nftB=379,ownerA=await collection.ownerOf(nftA,{blockTag:block}),ownerB=await collection.ownerOf(nftB,{blockTag:block});
  assert.notEqual(ownerA.toLowerCase(),ownerB.toLowerCase());
  // Public pool address is only impersonated inside the disposable local fork.
  const tokenSource='0x116e7D070f1888B81E1E0324F56d6746B2D7d8f1';
  const forkRequest=new URL(RPC_URL);assert.ok(['https:','http:'].includes(forkRequest.protocol));
  const readMethods=new Set(['eth_chainId','eth_blockNumber','net_version','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getBalance','eth_getStorageAt','eth_getTransactionCount','eth_getProof','eth_getTransactionByHash','eth_getTransactionReceipt','eth_gasPrice']);
  const forkProvider={request:async({method,params=[]})=>{
    if(!readMethods.has(method))throw Error('Upstream mutation/unsupported method blocked: '+method);
    const value=await upstream.send(method,params);
    // Monad RPC supplies withdrawalsRoot but omits the withdrawals array Ganache requires.
    if(value && ['eth_getBlockByNumber','eth_getBlockByHash'].includes(method))return {...value,withdrawals:value.withdrawals || []};
    return value;
  }};
  transport=ganache.provider({logging:{quiet:true},fork:{provider:forkProvider,blockNumber:block},chain:{chainId:1337,hardfork:'shanghai'},wallet:{totalAccounts:5,unlockedAccounts:[ownerA,ownerB,tokenSource]}});
  provider=new BrowserProvider(transport);provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:5},(_,i)=>provider.getSigner(i)));
  for(const account of [ownerA,ownerB,tokenSource])await provider.send('evm_setAccountBalance',[account,'0x56bc75e2d63100000']);
  const token=new Contract(CHOG_TOKEN,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'],provider);
  const artifact=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8'));
  const arena=await new ContractFactory(artifact.abi,artifact.bytecode,signers[0]).deploy(CHOG_TOKEN,COLLECTION,await signers[4].getAddress());await arena.waitForDeployment();
  await(await arena.connect(await provider.getSigner(ownerA)).createChallenge(nftA)).wait();
  await(await arena.connect(await provider.getSigner(ownerB)).acceptChallenge(1,nftB)).wait();
  const amount=parseUnits('5000',18),ballots=[];
  for(let i=0;i<3;i++){
    const account=await signers[i].getAddress();
    await(await token.connect(await provider.getSigner(tokenSource)).transfer(account,amount)).wait();
    await(await token.connect(signers[i]).approve(await arena.getAddress(),amount)).wait();
    const ballot={arena:await arena.getAddress(),chainId:1337,roundId:1,account,amount:amount.toString(),side:i===2?1:0,tokenId:i===2?nftB:nftA,salt:makeSalt()};
    await(await arena.connect(signers[i]).commitVote(1,makeCommitment(ballot),amount,0,toUtf8Bytes('local-fork-manual-reveal'))).wait();ballots.push(ballot);
  }
  const round=await arena.getRound(1),latest=await provider.send('eth_getBlockByNumber',['latest',false]);
  await provider.send('evm_increaseTime',[Number(round.unlockAt)-Number(BigInt(latest.timestamp))]);await provider.send('evm_mine',[]);
  for(const b of ballots)await(await arena.revealVote(1,b.account,b.side,b.tokenId,b.salt)).wait();await(await arena.settle(1)).wait();
  for(let i=0;i<2;i++){
    const p=await arena.payoutBreakdown(1,ballots[i].account),before=await token.balanceOf(ballots[i].account);
    assert.equal(p.gross,parseUnits('7500',18));assert.equal(p.fee,parseUnits('75',18));
    await(await arena.connect(signers[i]).claim(1)).wait();assert.equal(await token.balanceOf(ballots[i].account),before+p.amount);
  }
  await(await arena.connect(signers[4]).withdrawFees()).wait();assert.equal(await token.balanceOf(await arena.getAddress()),0n);
  assert.equal(await token.balanceOf(await signers[4].getAddress()),parseUnits('150',18));
  const result={checkedAt:new Date().toISOString(),upstreamChainId:CHAIN_ID,forkBlock:block,localChainId:1337,nftA,nftB,depositAndPayout:'passed',realTransactionsSent:0,limitations:'Single-state integration test in Shanghai EVM, manual reveals, missing Monad withdrawals array normalized to empty. Not a Monad consensus/gas test, source audit, protocol proof, outage or future admin-behavior guarantee.'};
  const output=resolve(process.argv[2] || 'outputs/security-fork.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{provider?.destroy();await transport?.disconnect();upstream.destroy();}
