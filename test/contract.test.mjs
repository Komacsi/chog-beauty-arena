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
const units=n=>parseUnits(String(n),18);
async function fixture(){
  const transport=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{totalAccounts:6}}),provider=new BrowserProvider(transport);provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  async function deploy(file,name,args=[]){const a=compiled[file][name],c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
  const token=await deploy('Mocks.sol','MockToken'),nft=await deploy('Mocks.sol','MockNFT'),arena=await deploy('BeautyArena.sol','BeautyArena',[await token.getAddress(),await nft.getAddress(),await signers[5].getAddress()]);
  for(let i=0;i<5;i++){await(await token.mint(await signers[i].getAddress(),units(1000))).wait();await(await token.connect(signers[i]).approve(await arena.getAddress(),units(1000))).wait();}
  await(await nft.mint(await signers[0].getAddress(),1)).wait();await(await nft.mint(await signers[0].getAddress(),2)).wait();await(await arena.startRound(1,2)).wait();
  const ballots=[];
  async function commit(i,side,amount,holderId=0){const id=Number(await arena.currentRoundId()),b={arena:await arena.getAddress(),chainId:Number((await provider.getNetwork()).chainId),roundId:id,account:await signers[i].getAddress(),side,tokenId:side?2:1,amount:amount.toString(),salt:makeSalt()};const tx=await arena.connect(signers[i]).commitVote(id,makeCommitment(b),amount,holderId,toUtf8Bytes('opaque encrypted choice'));const receipt=await tx.wait();ballots.push(b);return {b,receipt};}
  async function goto(time){const block=await provider.send('eth_getBlockByNumber',['latest',false]);await provider.send('evm_increaseTime',[Math.max(0,Number(time)-Number(BigInt(block.timestamp)))]);await provider.send('evm_mine',[]);}
  async function reveal(b){await(await arena.connect(signers[4]).revealVote(b.roundId,b.account,b.side,b.tokenId,b.salt)).wait();}
  async function finish(){const id=Number(await arena.currentRoundId());await goto((await arena.getRound(id)).unlockAt);for(const b of ballots.filter(b=>b.roundId===id))await reveal(b);await(await arena.settle(id)).wait();}
  async function close(){provider.destroy();await transport.disconnect();}
  return {provider,signers,token,nft,arena,commit,goto,reveal,finish,close,ballots};
}
test('contract commitments contain no side or per-NFT totals during betting',async()=>{const f=await fixture();try{
  const {b,receipt}=await f.commit(1,1,units(10)),r=await f.arena.getRound(1),e=await f.arena.entries(1,b.account);assert.equal(r.poolA,0n);assert.equal(r.poolB,0n);assert.equal(r.votesA,0n);assert.equal(r.votesB,0n);assert.equal(r.totalCommitted,units(10));assert.equal(e.revealed,false);
  const log=receipt.logs.map(l=>{try{return f.arena.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='VoteCommitted');assert.ok(log);assert.equal(log.fragment.inputs.some(x=>x.name==='side'),false);
  assert.equal(f.arena.interface.getFunction('commitVote').inputs.some(x=>x.name==='side'),false);
  await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));
}finally{await f.close();}});
test('contract disallows early opening, late commitments and changing the bound NFT',async()=>{const f=await fixture();try{
  const {b}=await f.commit(1,0,units(10));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,b.side,b.tokenId,b.salt));
  const r=await f.arena.getRound(1);await f.goto(r.endsAt);await assert.rejects(f.arena.connect(f.signers[2]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,b.side,b.tokenId,b.salt));
  await f.goto(r.unlockAt);await assert.rejects(f.arena.revealVote.staticCall(1,b.account,1,2,b.salt));await assert.rejects(f.arena.revealVote.staticCall(1,b.account,0,2,b.salt));await f.reveal(b);await assert.rejects(f.arena.revealVote.staticCall(1,b.account,0,1,b.salt));
}finally{await f.close();}});
test('relayer opens choices; only original winners claim gross minus their individual fee',async()=>{const f=await fixture();try{
  await f.commit(1,0,units(10));await f.commit(2,0,units(30));await f.commit(3,1,units(60));await f.finish();
  const p=await f.arena.payoutBreakdown(1,await f.signers[1].getAddress());assert.equal(p.gross,units(25));assert.equal(p.fee,units('0.25'));assert.equal(p.amount,units('24.75'));assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.points(1),1n);
  await assert.rejects(f.arena.connect(f.signers[4]).claim.staticCall(1));await(await f.arena.connect(f.signers[1]).claim(1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).claim.staticCall(1));await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.arena.treasuryCredit(),units(1));
  await assert.rejects(f.arena.withdrawFees.staticCall());await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.signers[5].getAddress()),units(1));assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});
test('holder no-stake eligibility is checked at commit and cannot be reused after transfer',async()=>{const f=await fixture();try{
  const b={arena:await f.arena.getAddress(),chainId:1337,roundId:1,account:await f.signers[1].getAddress(),side:0,tokenId:1,amount:0n,salt:makeSalt()};await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(0,0,0n,1);await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(2,1,units(20));await f.finish();assert.equal((await f.arena.getRound(1)).refund,true);assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),units(20));assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('incomplete automatic opening cancels rather than trusting a selective tally',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,units(10));await f.commit(2,1,units(30));let r=await f.arena.getRound(1);await f.goto(r.unlockAt);await f.reveal(a.b);await assert.rejects(f.arena.settle.staticCall(1));await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();r=await f.arena.getRound(1);
  assert.equal(r.cancelled,true);assert.equal(r.refund,true);assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),units(10));assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),units(30));assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('one-sided banks return all stakes in either winning direction',async()=>{const f=await fixture();try{
  for(const side of [0,1]){if(side)await(await f.arena.startRound(1,2)).wait();await f.commit(1,side,units(10));await f.commit(2,side,units(30));await f.commit(0,1-side,0n,1);await f.finish();const id=side+1;assert.equal(await f.arena.payout(id,await f.signers[1].getAddress()),units(10));assert.equal(await f.arena.payout(id,await f.signers[2].getAddress()),units(30));assert.equal(await f.arena.treasuryCredit(),0n);}
}finally{await f.close();}});
test('gross-first rounding conserves the complete encrypted round bank',async()=>{const f=await fixture();try{
  await f.commit(1,0,1n);await f.commit(2,0,2n);await f.commit(3,1,198n);await f.finish();const a=await f.arena.payoutBreakdown(1,await f.signers[1].getAddress()),b=await f.arena.payoutBreakdown(1,await f.signers[2].getAddress());assert.equal(a.gross,67n);assert.equal(a.amount,67n);assert.equal(b.gross,134n);assert.equal(b.fee,1n);assert.equal(b.amount,133n);await(await f.arena.connect(f.signers[1]).claim(1)).wait();await(await f.arena.connect(f.signers[2]).claim(1)).wait();await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});
