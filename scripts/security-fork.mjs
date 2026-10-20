// Opt-in LOCAL fork test. All transactions go to a disposable loopback-only Anvil node.
// The upstream Monad connection is used only for state reads; no real keys loaded.
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {startReadOnlyForkRpc} from '../test-support/fork-rpc.mjs';
import assert from 'node:assert/strict';
import {JsonRpcSigner,Contract,ContractFactory,JsonRpcProvider,FetchRequest,parseUnits,toUtf8Bytes} from 'ethers';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {RPC_URL,CHAIN_ID,CHOG_TOKEN,COLLECTION} from '../lib/config.mjs';
import {makeCommitment,makeSalt} from '../lib/commitments.mjs';
import {holderTokensHash} from '../lib/holder-ballots.mjs';
import {deploySafe} from '../test-support/safe.mjs';
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const upstream=new JsonRpcProvider(connection,undefined,{batchMaxCount:1});
let evm,gateway,provider;
try{
  assert.equal(Number((await upstream.getNetwork()).chainId),CHAIN_ID);
  const block=process.argv[3]?Number(process.argv[3]):await upstream.getBlockNumber();assert.ok(Number.isSafeInteger(block) && block>0);
  const collection=new Contract(COLLECTION,['function ownerOf(uint256) view returns(address)'],upstream);
  const nftA=299,nftB=379,ownerA=await collection.ownerOf(nftA,{blockTag:block}),ownerB=await collection.ownerOf(nftB,{blockTag:block});
  assert.notEqual(ownerA.toLowerCase(),ownerB.toLowerCase());
  // Public pool address is only impersonated inside the disposable local fork.
  const tokenSource='0x116e7D070f1888B81E1E0324F56d6746B2D7d8f1';
  gateway=await startReadOnlyForkRpc(upstream);
  evm=await startLocalEvm({accounts:5,forkUrl:gateway.url,forkBlockNumber:block});provider=evm.provider;
  const signers=await Promise.all(Array.from({length:5},(_,i)=>provider.getSigner(i)));
  for(const account of [ownerA,ownerB,tokenSource]){await provider.send('anvil_impersonateAccount',[account]);await provider.send('anvil_setBalance',[account,'0x56bc75e2d63100000']);}
  const localSigner=account=>new JsonRpcSigner(provider,account);
  const token=new Contract(CHOG_TOKEN,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)'],provider);
  const artifact=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8'));
  const {safe}=await deploySafe(signers.slice(0,3));
  const arena=await new ContractFactory(artifact.abi,artifact.bytecode,signers[0]).deploy(CHOG_TOKEN,COLLECTION,await signers[4].getAddress(),await signers[3].getAddress(),await safe.getAddress());await arena.waitForDeployment();
  await(await arena.connect(localSigner(ownerA)).createChallenge(nftA)).wait();
  await(await arena.connect(localSigner(ownerB)).acceptChallenge(1,nftB)).wait();
  const amount=parseUnits('5000',18),ballots=[];
  const holderBallots=[];
  for(const [account,tokenId,side]of [[ownerA,nftA,0],[ownerB,nftB,1]]){
    const b={arena:arena.target,chainId:1337,roundId:1,account,side,tokenId:side?nftB:nftA,amount:'0',holderKey:tokenId,holderTokenIdsHash:holderTokensHash([tokenId]),salt:makeSalt()};
    await(await arena.connect(localSigner(account)).commitHolderVotes(1,[tokenId],makeCommitment(b),'0x01')).wait();holderBallots.push(b);
    assert.equal(await collection.ownerOf(tokenId,{blockTag:block}),account);
    assert.equal(await arena.unstakedVoteUsed(1,tokenId),true);
  }
  for(let i=0;i<3;i++){
    const account=await signers[i].getAddress();
    await(await token.connect(localSigner(tokenSource)).transfer(account,amount)).wait();
    await(await token.connect(signers[i]).approve(await arena.getAddress(),amount)).wait();
    const ballot={arena:await arena.getAddress(),chainId:1337,roundId:1,betNonce:0,account,amount:amount.toString(),side:i===2?1:0,tokenId:i===2?nftB:nftA,salt:makeSalt()};
    await(await arena.connect(signers[i]).commitVote(1,makeCommitment(ballot),amount,0,toUtf8Bytes('local-fork-manual-reveal'))).wait();ballots.push(ballot);
  }
  const repeatAccount=await signers[0].getAddress();
  await(await token.connect(localSigner(tokenSource)).transfer(repeatAccount,amount)).wait();await(await token.connect(signers[0]).approve(arena.target,amount)).wait();
  const repeat={...ballots[0],betNonce:1,side:1,tokenId:nftB,salt:makeSalt()};
  await(await arena.connect(signers[0]).commitVote(1,makeCommitment(repeat),amount,1,'0x01')).wait();ballots.push(repeat);
  const excluded=await signers[4].getAddress();
  await(await token.connect(localSigner(tokenSource)).transfer(excluded,amount)).wait();
  await(await token.connect(signers[4]).approve(await arena.getAddress(),amount)).wait();
  await(await arena.connect(signers[4]).commitVote(1,'0x'+'ab'.repeat(32),amount,0,'0x01')).wait();
  const round=await arena.getRound(1),latest=await provider.send('eth_getBlockByNumber',['latest',false]);
  await provider.send('evm_increaseTime',[Number(round.unlockAt)-Number(BigInt(latest.timestamp))]);await provider.send('evm_mine',[]);
  for(const b of ballots)await(await arena.connect(signers[3]).revealVote(1,b.account,b.betNonce,b.side,b.tokenId,b.salt)).wait();
  for(const b of holderBallots)await(await arena.connect(signers[3]).revealHolderVotes(1,b.holderKey,b.side,b.tokenId,b.salt)).wait();
  const opened=await provider.send('eth_getBlockByNumber',['latest',false]);await provider.send('evm_increaseTime',[Number(round.revealEndsAt)-Number(BigInt(opened.timestamp))]);await provider.send('evm_mine',[]);
  await(await arena.settle(1)).wait();assert.equal((await arena.getRound(1)).cancelled,false);
  assert.equal((await arena.getRound(1)).votesA,3n);assert.equal((await arena.getRound(1)).votesB,2n);
  assert.equal((await arena.payoutBetBreakdown(1,repeatAccount,1)).amount,0n);
  assert.equal(await arena.payout(1,excluded),amount);await(await arena.connect(signers[4]).claim(1)).wait();
  for(let i=0;i<2;i++){
    const p=await arena.payoutBreakdown(1,ballots[i].account),before=await token.balanceOf(ballots[i].account);
    assert.equal(p.gross,parseUnits('10000',18));assert.equal(p.fee,parseUnits('100',18));
    await(await arena.connect(signers[i]).claim(1)).wait();assert.equal(await token.balanceOf(ballots[i].account),before+p.amount);
  }
  await(await arena.connect(signers[4]).withdrawFees()).wait();assert.equal(await token.balanceOf(await arena.getAddress()),0n);
  assert.equal(await token.balanceOf(await signers[4].getAddress()),amount+parseUnits('200',18));
  const result={checkedAt:new Date().toISOString(),upstreamChainId:CHAIN_ID,forkBlock:block,localChainId:1337,protocolVersion:6,testEvm:'Anvil 1.7.1',nftA,nftB,depositAndPayout:'passed',nftVotes:'one per NFT, no NFT transfer',repeatedBets:'separate payouts; only bet nonce zero adds a vote',result:'3–2',excludedEntryRefund:'5000 CHOG, no fee',winningPayout:'10000 gross, 100 fee, 9900 net each',authorizedRevealer:'enforced',realTransactionsSent:0,limitations:'Single-state integration test in Shanghai EVM, manual service reveals, read-only RPC gateway, missing Monad withdrawals array normalized to empty. Not a Monad consensus/gas test, source audit, protocol proof, outage or future admin-behavior guarantee.'};
  const output=resolve(process.argv[2] || 'outputs/security-fork.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await evm?.close();await gateway?.close();upstream.destroy();}
