import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseUnits,toUtf8Bytes} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {makeCommitment,makeSalt} from '../lib/commitments.mjs';
const compiled=compile({'Mocks.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
contract MockToken is ERC20 { constructor() ERC20('Chog','CHOG') {} function mint(address a,uint256 n) external {_mint(a,n);} }
contract MockNFT is ERC721 { constructor() ERC721('Chog','CHOG') {} function mint(address a,uint256 n) external {_mint(a,n);} }`}});
// Monetary fixture values below are lots of 1,000 CHOG.
const lots=n=>parseUnits(String(Number(n)*1000),18);
async function fixture(){
  const transport=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{totalAccounts:6}}),provider=new BrowserProvider(transport);provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  async function deploy(file,name,args=[]){const a=compiled[file][name],c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
  const token=await deploy('Mocks.sol','MockToken'),nft=await deploy('Mocks.sol','MockNFT'),arena=await deploy('BeautyArena.sol','BeautyArena',[await token.getAddress(),await nft.getAddress(),await signers[5].getAddress()]);
  for(let i=0;i<5;i++){await(await token.mint(await signers[i].getAddress(),lots(1000))).wait();await(await token.connect(signers[i]).approve(await arena.getAddress(),lots(1000))).wait();}
  for(const [id,owner]of [[1,0],[2,4],[3,0],[4,4]])await(await nft.mint(await signers[owner].getAddress(),id)).wait();
  await(await arena.createChallenge(1)).wait();await(await arena.connect(signers[4]).acceptChallenge(1,2)).wait();
  const ballots=[];
  async function commit(i,side,amount,holderId=0){const id=Number(await arena.currentRoundId()),b={arena:await arena.getAddress(),chainId:Number((await provider.getNetwork()).chainId),roundId:id,account:await signers[i].getAddress(),side,tokenId:side?2:1,amount:amount.toString(),salt:makeSalt()};const tx=await arena.connect(signers[i]).commitVote(id,makeCommitment(b),amount,holderId,toUtf8Bytes('opaque encrypted choice'));const receipt=await tx.wait();ballots.push(b);return {b,receipt};}
  async function goto(time){const block=await provider.send('eth_getBlockByNumber',['latest',false]);await provider.send('evm_increaseTime',[Math.max(0,Number(time)-Number(BigInt(block.timestamp)))]);await provider.send('evm_mine',[]);}
  async function reveal(b){await(await arena.connect(signers[4]).revealVote(b.roundId,b.account,b.side,b.tokenId,b.salt)).wait();}
  async function finish(){const id=Number(await arena.currentRoundId());await goto((await arena.getRound(id)).unlockAt);for(const b of ballots.filter(b=>b.roundId===id))await reveal(b);await(await arena.settle(id)).wait();}
  async function close(){provider.destroy();await transport.disconnect();}
  return {provider,signers,token,nft,arena,commit,goto,reveal,finish,close,ballots};
}
test('contract commitments contain no side or per-NFT totals during betting',async()=>{const f=await fixture();try{
  const {b,receipt}=await f.commit(1,1,lots(10)),r=await f.arena.getRound(1),e=await f.arena.entries(1,b.account);assert.equal(r.poolA,0n);assert.equal(r.poolB,0n);assert.equal(r.votesA,0n);assert.equal(r.votesB,0n);assert.equal(r.totalCommitted,lots(10));assert.equal(e.revealed,false);
  const log=receipt.logs.map(l=>{try{return f.arena.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='VoteCommitted');assert.ok(log);assert.equal(log.fragment.inputs.some(x=>x.name==='side'),false);
  assert.equal(f.arena.interface.getFunction('commitVote').inputs.some(x=>x.name==='side'),false);
  await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));
}finally{await f.close();}});
test('contract disallows early opening, late commitments and changing the bound NFT',async()=>{const f=await fixture();try{
  const {b}=await f.commit(1,0,lots(10));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,b.side,b.tokenId,b.salt));
  const r=await f.arena.getRound(1);await f.goto(r.endsAt);await assert.rejects(f.arena.connect(f.signers[2]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,b.side,b.tokenId,b.salt));
  await f.goto(r.unlockAt);await assert.rejects(f.arena.revealVote.staticCall(1,b.account,1,2,b.salt));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,0,2,b.salt));await f.reveal(b);await assert.rejects(f.arena.revealVote.staticCall(1,b.account,0,1,b.salt));
}finally{await f.close();}});
test('relayer opens choices; only original winners claim gross minus their individual fee',async()=>{const f=await fixture();try{
  await f.commit(1,0,lots(10));await f.commit(2,0,lots(30));await f.commit(3,1,lots(60));await f.finish();
  const p=await f.arena.payoutBreakdown(1,await f.signers[1].getAddress());assert.equal(p.gross,lots(25));assert.equal(p.fee,lots('0.25'));assert.equal(p.amount,lots('24.75'));assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.points(1),1n);
  await assert.rejects(f.arena.connect(f.signers[4]).claim.staticCall(1));await(await f.arena.connect(f.signers[1]).claim(1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).claim.staticCall(1));await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.arena.treasuryCredit(),lots(1));
  await assert.rejects(f.arena.withdrawFees.staticCall());await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.signers[5].getAddress()),lots(1));assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});
test('holder no-stake eligibility is checked at commit and cannot be reused after transfer',async()=>{const f=await fixture();try{
  const b={arena:await f.arena.getAddress(),chainId:1337,roundId:1,account:await f.signers[1].getAddress(),side:0,tokenId:1,amount:0n,salt:makeSalt()};await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(0,0,0n,1);await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(2,1,lots(20));await f.finish();assert.equal((await f.arena.getRound(1)).refund,true);assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),lots(20));assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('incomplete automatic opening cancels rather than trusting a selective tally',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10));await f.commit(2,1,lots(30));let r=await f.arena.getRound(1);await f.goto(r.unlockAt);await f.reveal(a.b);await assert.rejects(f.arena.settle.staticCall(1));await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();r=await f.arena.getRound(1);
  assert.equal(r.cancelled,true);assert.equal(r.refund,true);assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),lots(10));assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),lots(30));assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('one-sided banks return all stakes in either winning direction',async()=>{const f=await fixture();try{
  for(const side of [0,1]){if(side){await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,2)).wait();}await f.commit(1,side,lots(10));await f.commit(2,side,lots(30));await f.commit(0,1-side,0n,1);await f.finish();const id=side+1;assert.equal(await f.arena.payout(id,await f.signers[1].getAddress()),lots(10));assert.equal(await f.arena.payout(id,await f.signers[2].getAddress()),lots(30));assert.equal(await f.arena.treasuryCredit(),0n);}
}finally{await f.close();}});
test('gross-first rounding conserves the complete encrypted round bank',async()=>{const f=await fixture();try{
  const minimum=parseUnits('5000',18),stake=minimum+17n;
  await f.commit(1,0,stake);await f.commit(2,0,2n*stake);await f.commit(3,1,3n*stake);await f.finish();
  const a=await f.arena.payoutBreakdown(1,await f.signers[1].getAddress()),b=await f.arena.payoutBreakdown(1,await f.signers[2].getAddress());
  assert.equal(a.gross,2n*stake);assert.equal(a.fee,2n*minimum/100n);assert.equal(b.gross,4n*stake);assert.equal(b.fee,4n*minimum/100n);
  assert.equal((a.gross+b.gross)/100n,a.fee+b.fee+1n);
  await(await f.arena.connect(f.signers[1]).claim(1)).wait();await(await f.arena.connect(f.signers[2]).claim(1)).wait();await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});

test('holder-created requests enforce ownership, single NFT use, cancellation and 24h from acceptance',async()=>{const f=await fixture();try{
  assert.equal(await f.arena.tokenRound(1),1n);assert.equal(await f.arena.tokenRound(2),1n);
  await assert.rejects(f.arena.createChallenge.staticCall(1));await assert.rejects(f.arena.connect(f.signers[1]).createChallenge.staticCall(3));
  await(await f.arena.createChallenge(3)).wait();assert.equal(await f.arena.currentRoundId(),1n);assert.equal(await f.arena.tokenChallenge(3),2n);
  await assert.rejects(f.arena.acceptChallenge.staticCall(2,4));await assert.rejects(f.arena.connect(f.signers[1]).cancelChallenge.staticCall(2));
  await(await f.arena.cancelChallenge(2)).wait();assert.equal(await f.arena.tokenAvailable(3),true);await assert.rejects(f.arena.connect(f.signers[4]).acceptChallenge.staticCall(2,4));
  await(await f.arena.createChallenge(3)).wait();await f.goto((await f.arena.getRound(1)).endsAt);
  const receipt=await(await f.arena.connect(f.signers[4]).acceptChallenge(3,4)).wait(),block=await f.provider.getBlock(receipt.blockNumber),r=await f.arena.getRound(2);
  assert.equal(r.endsAt,BigInt(block.timestamp+24*60*60));assert.equal(await f.arena.tokenRound(3),2n);assert.equal(await f.arena.tokenRound(4),2n);
  await assert.rejects(f.arena.cancelChallenge.staticCall(3));await assert.rejects(f.arena.connect(f.signers[4]).createChallenge.staticCall(4));
  await f.goto((await f.arena.getRound(1)).unlockAt);await(await f.arena.settle(1)).wait();assert.equal(await f.arena.tokenAvailable(1),true);assert.equal(await f.arena.tokenAvailable(3),false);
  await(await f.arena.createChallenge(1)).wait();await f.goto(r.unlockAt);await(await f.arena.settle(2)).wait();assert.equal(await f.arena.tokenAvailable(3),true);assert.equal(await f.arena.losses(3),0n);
}finally{await f.close();}});

test('transferring a pending NFT prevents stale acceptance; active lock survives a transfer',async()=>{const f=await fixture();try{
  await(await f.arena.createChallenge(3)).wait();await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),3)).wait();
  await assert.rejects(f.arena.connect(f.signers[4]).acceptChallenge.staticCall(2,4));await(await f.arena.connect(f.signers[1]).cancelChallenge(2)).wait();await(await f.arena.connect(f.signers[1]).createChallenge(3)).wait();
  await(await f.arena.connect(f.signers[4]).acceptChallenge(3,4)).wait();await(await f.nft.connect(f.signers[1]).transferFrom(await f.signers[1].getAddress(),await f.signers[2].getAddress(),3)).wait();await assert.rejects(f.arena.connect(f.signers[2]).createChallenge.staticCall(3));
  await f.goto((await f.arena.getRound(2)).unlockAt);await(await f.arena.settle(2)).wait();await(await f.arena.connect(f.signers[2]).createChallenge(3)).wait();
}finally{await f.close();}});

test('draw counters ignore empty/canceled rounds, count 1–1 for both NFTs and cannot double count',async()=>{const f=await fixture();try{
  await f.finish();assert.equal(await f.arena.draws(1),0n);assert.equal(await f.arena.draws(2),0n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,2)).wait();
  await f.commit(1,0,lots(10));await f.commit(2,1,lots(30));await f.finish();
  assert.equal(await f.arena.draws(1),1n);assert.equal(await f.arena.draws(2),1n);assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.losses(2),0n);
  assert.equal(await f.arena.payout(2,await f.signers[1].getAddress()),lots(10));await assert.rejects(f.arena.settle.staticCall(2));assert.equal(await f.arena.draws(1),1n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(3,2)).wait();
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,1,lots(30));await f.commit(3,0,lots(5));const r=await f.arena.getRound(3);
  await f.goto(r.unlockAt);await f.reveal(a.b);await f.reveal(b.b);await f.goto(r.revealEndsAt);await(await f.arena.settle(3)).wait();
  assert.equal((await f.arena.getRound(3)).cancelled,true);assert.equal(await f.arena.draws(1),1n);assert.equal(await f.arena.draws(2),1n);
}finally{await f.close();}});

// These two tests document unresolved protocol attacks, rather than fixes.
test('SEC-01: an unstaked holder malformed ballot can veto a fully revealed honest majority',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,0,lots(30)),c=await f.commit(3,1,lots(60));
  const attacker=await f.signers[4].getAddress();
  await(await f.arena.connect(f.signers[4]).commitVote(1,'0x'+'ab'.repeat(32),0n,2,'0x01')).wait();
  const r=await f.arena.getRound(1);await f.goto(r.unlockAt);
  for(const entry of [a,b,c])await f.reveal(entry.b);
  assert.equal((await f.arena.getRound(1)).votesA,2n);
  await assert.rejects(f.arena.settle.staticCall(1));
  await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();
  assert.equal((await f.arena.getRound(1)).cancelled,true);
  assert.equal(await f.arena.points(1),0n);
  assert.equal(await f.arena.payout(1,attacker),0n);
  for(const [i,amount]of [[1,10],[2,30],[3,60]])assert.equal(await f.arena.payout(1,await f.signers[i].getAddress()),lots(amount));
}finally{await f.close();}});

test('SEC-02: two wallets staking the minimum each outvote a larger opposing stake',async()=>{const f=await fixture();try{
  const minimum=parseUnits('5000',18);
  await f.commit(1,0,lots(100));await f.commit(2,1,minimum);await f.commit(3,1,minimum);await f.finish();
  const r=await f.arena.getRound(1);assert.equal(r.winner,1n);assert.equal(r.votesB,2n);
  assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),0n);
  const a=await f.arena.payoutBreakdown(1,await f.signers[2].getAddress()),b=await f.arena.payoutBreakdown(1,await f.signers[3].getAddress());
  assert.equal(a.gross+b.gross,lots(100)+2n*minimum);
}finally{await f.close();}});

test('security: replayed commitments cannot open another wallet or round, and owner cannot redirect claims',async()=>{const f=await fixture();try{
  const {b}=await f.commit(1,0,lots(10));await f.commit(2,0,lots(20));await f.commit(3,1,lots(30));
  await(await f.arena.createChallenge(3)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,4)).wait();
  const secondBank=parseUnits('5000',18);
  await(await f.arena.connect(f.signers[1]).commitVote(2,makeCommitment(b),secondBank,0,'0x01')).wait();
  await f.goto((await f.arena.getRound(2)).unlockAt);
  await assert.rejects(f.arena.revealVote.staticCall(2,b.account,b.side,b.tokenId,b.salt));
  await assert.rejects(f.arena.revealVote.staticCall(1,await f.signers[4].getAddress(),b.side,b.tokenId,b.salt));
  for(const ballot of f.ballots)await f.reveal(ballot);
  await(await f.arena.settle(1)).wait();
  assert.equal(await f.arena.owner(),await f.signers[0].getAddress());
  await assert.rejects(f.arena.claim.staticCall(1));
  await assert.rejects(f.arena.connect(f.signers[5]).claim.staticCall(1));
  await assert.rejects(f.arena.withdrawFees.staticCall());
  for(const i of [1,2])await(await f.arena.connect(f.signers[i]).claim(1)).wait();
  const fees=await f.arena.treasuryCredit();
  assert.equal(await f.token.balanceOf(await f.arena.getAddress()),fees+secondBank);
  await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();
  assert.equal(await f.token.balanceOf(await f.arena.getAddress()),secondBank);
  await f.goto((await f.arena.getRound(2)).revealEndsAt);await(await f.arena.settle(2)).wait();
  await(await f.arena.connect(f.signers[1]).claim(2)).wait();
  assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});

test('minimum stake applies onchain to holders and non-holders, with zero reserved for holders',async()=>{const f=await fixture();try{
  const minimum=parseUnits('5000',18),commitment='0x'+'cd'.repeat(32);
  assert.equal(await f.arena.MIN_STAKE(),minimum);
  for(const i of [0,1])for(const amount of [1n,minimum-1n]){
    await assert.rejects(f.arena.connect(f.signers[i]).commitVote.staticCall(1,commitment,amount,i===0?1:0,'0x01'),/Minimum bet/);
  }
  assert.equal((await f.arena.getRound(1)).totalCommitted,0n);
  await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,commitment,0,0,'0x01'));
  await f.commit(0,0,0n,1);await f.commit(1,1,minimum);await f.commit(2,0,minimum+1n);
  assert.equal((await f.arena.getRound(1)).totalCommitted,2n*minimum+1n);
}finally{await f.close();}});
