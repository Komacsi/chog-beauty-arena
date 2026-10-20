import test from 'node:test';
import assert from 'node:assert/strict';
import {ContractFactory,parseUnits,toUtf8Bytes,id as signatureId} from 'ethers';
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {compile} from '../scripts/compile.mjs';
import {makeCommitment,makeSalt} from '../lib/commitments.mjs';
import {readFile} from 'node:fs/promises';
import {sealBallot,drandClient} from '../lib/timelock.mjs';
import {processRound} from '../lib/keeper.mjs';
import {deploySafe} from '../test-support/safe.mjs';
import {validateGovernance} from '../lib/governance.mjs';
import {holderTokensHash,normalizeHolderTokens} from '../lib/holder-ballots.mjs';
const compiled=compile({'Mocks.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
contract MockToken is ERC20 {
  address public callbackTarget; bytes public callbackData; bool public callbackSucceeded; bytes4 public callbackFailure;
  bool public taxed; address public blockedSender;
  constructor() ERC20('Chog','CHOG') {}
  function mint(address a,uint256 n) external {_mint(a,n);}
  function configure(bool tax,address blocked,address target,bytes calldata payload) external {taxed=tax;blockedSender=blocked;callbackTarget=target;callbackData=payload;}
  function _update(address from,address to,uint256 value) internal override {
    require(from==address(0) || from!=blockedSender,'Mock transfer blocked');
    if(taxed && from!=address(0) && to!=address(0)){uint256 fee=value/100;super._update(from,address(0),fee);value-=fee;}
    super._update(from,to,value);
  }
  function callback() internal {if(callbackTarget!=address(0)){(bool ok,bytes memory data)=callbackTarget.call(callbackData);callbackSucceeded=ok;if(data.length>=4)callbackFailure=bytes4(data);}}
  function transferFrom(address a,address b,uint256 n) public override returns(bool) {bool ok=super.transferFrom(a,b,n);callback();return ok;}
  function transfer(address a,uint256 n) public override returns(bool) {bool ok=super.transfer(a,n);callback();return ok;}
}
contract MockNFT is ERC721 { constructor() ERC721('Chog','CHOG') {} function mint(address a,uint256 n) external {_mint(a,n);} function burn(uint256 n) external {require(ownerOf(n)==msg.sender);_burn(n);} }`}});
// Monetary fixture values below are lots of 1,000 CHOG.
const lots=n=>parseUnits(String(Number(n)*1000),18);
test('NFT groups may back opposite sides while repeated CHOG bets only add the first paid vote',async()=>{const f=await fixture();try{
  const a=await f.commitHolder(0,0,[1]),b=await f.commitHolder(0,1,[3]);
  await f.commit(0,0,lots(5));await f.commit(0,1,lots(10));await f.commit(0,0,lots(5));
  await f.commit(1,1,lots(5));await f.commit(2,0,lots(5));
  const account=await f.signers[0].getAddress();assert.equal(await f.arena.betCount(1,account),3n);
  await f.goto((await f.arena.getRound(1)).unlockAt);await f.revealHolder(a.b);await f.revealHolder(b.b);
  for(const ballot of f.ballots)await f.reveal(ballot);
  const r=await f.arena.getRound(1);assert.equal(r.votesA,3n);assert.equal(r.votesB,2n);assert.equal(r.poolA,lots(15));assert.equal(r.poolB,lots(15));
  assert.equal(r.committedCount,7n);assert.equal(r.revealedCount,7n);await(await f.arena.settle(1)).wait();
  for(const nonce of [0,2]){const p=await f.arena.payoutBetBreakdown(1,account,nonce);assert.equal(p.gross,lots(10));assert.equal(p.fee,lots('0.1'));assert.equal(p.amount,lots('9.9'));await(await f.arena.claimBet(1,nonce)).wait();await assert.rejects(f.arena.claimBet.staticCall(1,nonce));}
  assert.equal((await f.arena.payoutBetBreakdown(1,account,1)).amount,0n);await assert.rejects(f.arena.connect(f.signers[1]).claimBet.staticCall(1,2));
  await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.arena.treasuryCredit(),lots('0.3'));
  await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(f.arena.target),0n);
  for(const tokenId of [1,3])assert.equal(await f.nft.ownerOf(tokenId),account);
}finally{await f.close();}});

test('an unopened first CHOG bet never transfers its vote to a later bet; every bet still needs opening',async()=>{const f=await fixture();try{
  const first=await f.commit(1,0,lots(5)),later=await f.commit(1,1,lots(5));
  const count=await f.arena.betCount(1,first.b.account);
  await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(later.b),lots(5),0,'0x01'),/nonce changed/);
  assert.equal(await f.arena.betCount(1,first.b.account),count);
  await f.goto((await f.arena.getRound(1)).unlockAt);
  await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,later.b.account,0,1,2,later.b.salt),/mismatch/);
  await f.reveal(later.b);assert.equal((await f.arena.getRound(1)).votesB,0n);await assert.rejects(f.arena.settle.staticCall(1),/incomplete/);
  await f.goto((await f.arena.getRound(1)).revealEndsAt);await(await f.arena.settle(1)).wait();
  for(const nonce of [0,1]){assert.equal((await f.arena.payoutBetBreakdown(1,first.b.account,nonce)).amount,lots(5));await(await f.arena.connect(f.signers[1]).claimBet(1,nonce)).wait();}
  assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.draws(1),0n);assert.equal(await f.token.balanceOf(f.arena.target),0n);
}finally{await f.close();}});

test('NFT and repeated CHOG entries all refund after emergency cancellation',async()=>{const f=await fixture();try{
  await f.commitHolder(0,0,[1,3]);await f.commit(0,0,lots(5));await f.commit(0,1,lots(5));
  await f.govern('revokeRevealer');await(await f.arena.settle(1)).wait();
  for(const nonce of [0,1])await(await f.arena.claimBet(1,nonce)).wait();
  assert.equal(await f.token.balanceOf(f.arena.target),0n);assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.points(1),0n);
}finally{await f.close();}});
async function fixture(historical=false){
  // Local blocks are mined faster than the provider's default 250 ms read cache.
  // Disable that cache so each assertion/keeper scan sees the blocks just mined.
  const evm=await startLocalEvm(historical?{timestamp:1692803367-86400-300}:{}),provider=evm.provider;
  try{
  const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  async function deploy(file,name,args=[]){const a=compiled[file][name],c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
  const governance=await deploySafe(signers.slice(0,3));
  const token=await deploy('Mocks.sol','MockToken'),nft=await deploy('Mocks.sol','MockNFT'),arena=await deploy('BeautyArena.sol','BeautyArena',[await token.getAddress(),await nft.getAddress(),await signers[5].getAddress(),await signers[4].getAddress(),await governance.safe.getAddress()]);
  const govern=(method,args=[],approvers)=>governance.execute(arena.target,arena.interface.encodeFunctionData(method,args),approvers);
  for(let i=0;i<5;i++){await(await token.mint(await signers[i].getAddress(),lots(1000))).wait();await(await token.connect(signers[i]).approve(await arena.getAddress(),lots(1000))).wait();}
  for(const [id,owner]of [[1,0],[2,4],[3,0],[4,4]])await(await nft.mint(await signers[owner].getAddress(),id)).wait();
  await(await arena.createChallenge(1)).wait();await(await arena.connect(signers[4]).acceptChallenge(1,2)).wait();
  const ballots=[];
  async function commit(i,side,amount,holderId=0){if(amount===0n){const result=await commitHolder(i,side,[holderId]);ballots.push(result.b);return result;}const id=Number(await arena.currentRoundId()),account=await signers[i].getAddress(),betNonce=Number(await arena.betCount(id,account)),b={arena:await arena.getAddress(),chainId:1337,roundId:id,account,betNonce,side,tokenId:side?2:1,amount:amount.toString(),salt:makeSalt()};const receipt=await(await arena.connect(signers[i]).commitVote(id,makeCommitment(b),amount,betNonce,toUtf8Bytes('opaque encrypted choice'))).wait();ballots.push(b);return {b,receipt};}
  async function goto(time){const block=await provider.send('eth_getBlockByNumber',['latest',false]);if(Number(time)>Number(BigInt(block.timestamp)))await provider.send('evm_setNextBlockTimestamp',[Number(time)]);await provider.send('evm_mine',[]);}
  async function reveal(b){if(b.holderKey!==undefined)return revealHolder(b);await(await arena.connect(signers[4]).revealVote(b.roundId,b.account,b.betNonce,b.side,b.tokenId,b.salt)).wait();}
  async function commitHolder(i,side,tokenIds){
    tokenIds=normalizeHolderTokens(tokenIds);const roundId=Number(await arena.currentRoundId()),r=await arena.getRound(roundId);
    const b={arena:arena.target,chainId:1337,roundId,account:await signers[i].getAddress(),side,tokenId:Number(side===0?r.nftA:r.nftB),amount:'0',holderKey:tokenIds[0],holderTokenIdsHash:holderTokensHash(tokenIds),salt:makeSalt()};
    const receipt=await(await arena.connect(signers[i]).commitHolderVotes(roundId,tokenIds,makeCommitment(b),toUtf8Bytes('opaque NFT ballot'))).wait();return {b,receipt};
  }
  async function revealHolder(b){await(await arena.connect(signers[4]).revealHolderVotes(b.roundId,b.holderKey,b.side,b.tokenId,b.salt)).wait();}
  async function finish(){const id=Number(await arena.currentRoundId());await goto((await arena.getRound(id)).unlockAt);for(const b of ballots.filter(b=>b.roundId===id))await reveal(b);await(await arena.settle(id)).wait();}
  async function close(){await evm.close();}
  return {provider,signers,token,nft,arena,commit,goto,reveal,commitHolder,revealHolder,finish,close,ballots,govern,governance,deploy};
  }catch(error){await evm.close();throw error;}
}
test('five owned NFTs submit five sealed votes without transferring NFTs or CHOG',async()=>{const f=await fixture();try{
  const account=await f.signers[0].getAddress(),before=await f.token.balanceOf(account),ids=[1,3,5,6,7];
  for(const tokenId of [5,6,7])await(await f.nft.mint(account,tokenId)).wait();
  const {b,receipt}=await f.commitHolder(0,0,ids),r=await f.arena.getRound(1),entry=await f.arena.holderEntries(1,1);
  assert.equal(r.committedCount,5n);assert.equal(r.votesA,0n);assert.equal(r.totalCommitted,0n);assert.equal(entry.weight,5n);assert.equal(entry.revealed,false);
  assert.equal(await f.token.balanceOf(account),before);for(const tokenId of ids){assert.equal(await f.nft.ownerOf(tokenId),account);assert.equal(await f.arena.unstakedVoteUsed(1,tokenId),true);}
  const event=receipt.logs.map(l=>{try{return f.arena.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='HolderVotesCommitted');assert.ok(event);assert.equal(event.fragment.inputs.some(i=>i.name==='side'),false);
  await assert.rejects(f.arena.revealHolderVotes.staticCall(1,1,0,1,b.salt));
  await f.goto(r.unlockAt);await assert.rejects(f.arena.connect(f.signers[1]).revealHolderVotes.staticCall(1,1,0,1,b.salt));
  await f.revealHolder(b);assert.equal((await f.arena.getRound(1)).votesA,5n);assert.equal((await f.arena.getRound(1)).revealedCount,5n);
  await assert.rejects(f.arena.connect(f.signers[4]).revealHolderVotes.staticCall(1,1,0,1,b.salt));
  await(await f.arena.settle(1)).wait();assert.equal(await f.arena.payout(1,account),0n);assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('NFT votes can be submitted in several groups; transfer cannot reuse a used NFT and a new round can',async()=>{const f=await fixture();try{
  const a=await f.commitHolder(0,0,[3]);const b=await f.commitHolder(0,0,[1]);
  await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),3)).wait();
  await assert.rejects(f.commitHolder(1,0,[3]),/NFT already used/);
  await f.goto((await f.arena.getRound(1)).unlockAt);await f.revealHolder(a.b);await f.revealHolder(b.b);await(await f.arena.settle(1)).wait();
  assert.equal((await f.arena.getRound(1)).votesA,2n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,2)).wait();
  const next=await f.commitHolder(1,0,[3]);await f.goto((await f.arena.getRound(2)).unlockAt);await f.revealHolder(next.b);assert.equal((await f.arena.getRound(2)).votesA,1n);
}finally{await f.close();}});
test('invalid NFT batches roll back all usage markers; zero token ID is supported',async()=>{const f=await fixture();try{
  const commitment='0x'+'ab'.repeat(32);
  for(const ids of [[],[1,1],[3,1],[1,2],Array.from({length:51},(_,i)=>i)])await assert.rejects(f.arena.commitHolderVotes.staticCall(1,ids,commitment,'0x01'));
  await assert.rejects((async()=>{await(await f.arena.commitHolderVotes(1,[1,2],commitment,'0x01',{gasLimit:1000000})).wait();})());
  assert.equal(await f.arena.unstakedVoteUsed(1,1),false);assert.equal((await f.arena.getRound(1)).committedCount,0n);
  await(await f.nft.mint(await f.signers[0].getAddress(),0)).wait();const {b}=await f.commitHolder(0,1,[0]);
  await f.goto((await f.arena.getRound(1)).unlockAt);await f.revealHolder(b);assert.equal((await f.arena.getRound(1)).votesB,1n);
}finally{await f.close();}});
test('keeper opens five NFT votes automatically, skips a broken NFT ballot and preserves paid payouts',async()=>{const f=await fixture(true);try{
  const beacon=JSON.parse(await readFile(new URL('./fixtures/drand-round-1.json',import.meta.url),'utf8')),client=drandClient(async()=>({ok:true,json:async()=>beacon})),account=await f.signers[0].getAddress();
  for(const tokenId of [5,6,7,8])await(await f.nft.mint(account,tokenId)).wait();
  await f.commitHolder(0,0,[8]); // Deliberately broken ciphertext is excluded at the deadline.
  const ballot={arena:f.arena.target,chainId:1337,roundId:1,account,side:0,tokenId:1,amount:'0',holderKey:1,holderTokenIdsHash:holderTokensHash([1,3,5,6,7])};
  const sealed=await sealBallot(ballot,1,client);
  await(await f.arena.commitHolderVotes(1,[1,3,5,6,7],sealed.commitment,toUtf8Bytes(sealed.sealedChoice))).wait();
  for(const [i,side,betNonce]of [[1,0,0],[2,1,0],[1,0,1]]){
    const b={arena:f.arena.target,chainId:1337,roundId:1,betNonce,account:await f.signers[i].getAddress(),side,tokenId:side?2:1,amount:lots(5).toString()},s=await sealBallot(b,1,client);
    await(await f.arena.connect(f.signers[i]).commitVote(1,s.commitment,lots(5),betNonce,toUtf8Bytes(s.sealedChoice))).wait();
  }
  const r=await f.arena.getRound(1);await f.goto(r.unlockAt);
  const options={arena:f.arena.connect(f.signers[4]),provider:f.provider,fromBlock:0,client,id:1};
  const result=await processRound(options);assert.equal(result.revealed,8);assert.equal(result.failed,1);assert.equal(result.phase,'opening');
  const opened=await f.arena.getRound(1);assert.equal(opened.votesA,6n);assert.equal(opened.votesB,1n);
  await f.goto(r.revealEndsAt);assert.equal((await processRound(options)).phase,'settled');
  assert.equal(await f.arena.payout(1,account),0n);assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),lots('7.425'));
  assert.equal((await f.arena.payoutBetBreakdown(1,await f.signers[1].getAddress(),1)).amount,lots('7.425'));
  assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),0n);
}finally{await f.close();}});
test('contract commitments contain no side or per-NFT totals during betting',async()=>{const f=await fixture();try{
  const {b,receipt}=await f.commit(1,1,lots(10)),r=await f.arena.getRound(1),e=await f.arena.entries(1,b.account);assert.equal(r.poolA,0n);assert.equal(r.poolB,0n);assert.equal(r.votesA,0n);assert.equal(r.votesB,0n);assert.equal(r.totalCommitted,lots(10));assert.equal(e.revealed,false);
  const log=receipt.logs.map(l=>{try{return f.arena.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='VoteCommitted');assert.ok(log);assert.equal(log.fragment.inputs.some(x=>x.name==='side'),false);
  assert.equal(f.arena.interface.getFunction('commitVote').inputs.some(x=>x.name==='side'),false);
  await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));
}finally{await f.close();}});
test('contract disallows early opening, late commitments and changing the bound NFT',async()=>{const f=await fixture();try{
  const {b}=await f.commit(1,0,lots(10));await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.account,0,b.side,b.tokenId,b.salt));
  const r=await f.arena.getRound(1);await f.goto(r.endsAt);await assert.rejects(f.arena.connect(f.signers[2]).commitVote.staticCall(1,makeCommitment(b),1,0,'0x01'));await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.account,0,b.side,b.tokenId,b.salt));
  await f.goto(r.unlockAt);await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.account,0,1,2,b.salt));await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.account,0,0,2,b.salt));await f.reveal(b);await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.account,0,0,1,b.salt));
}finally{await f.close();}});
test('relayer opens choices; only original winners claim gross minus their individual fee',async()=>{const f=await fixture();try{
  await f.commit(1,0,lots(10));await f.commit(2,0,lots(30));await f.commit(3,1,lots(60));await f.finish();
  const p=await f.arena.payoutBreakdown(1,await f.signers[1].getAddress());assert.equal(p.gross,lots(25));assert.equal(p.fee,lots('0.25'));assert.equal(p.amount,lots('24.75'));assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.points(1),1n);
  await assert.rejects(f.arena.connect(f.signers[4]).claim.staticCall(1));await(await f.arena.connect(f.signers[1]).claim(1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).claim.staticCall(1));await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.arena.treasuryCredit(),lots(1));
  await assert.rejects(f.arena.withdrawFees.staticCall());await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.signers[5].getAddress()),lots(1));assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
}finally{await f.close();}});
test('holder no-stake eligibility is checked at commit and cannot be reused after transfer',async()=>{const f=await fixture();try{
  const b={arena:await f.arena.getAddress(),chainId:1337,roundId:1,betNonce:0,account:await f.signers[1].getAddress(),side:0,tokenId:1,amount:0n,salt:makeSalt()};await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(0,0,0n,1);await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).commitVote.staticCall(1,makeCommitment(b),0,1,'0x01'));
  await f.commit(2,1,lots(20));await f.finish();assert.equal((await f.arena.getRound(1)).refund,true);assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),lots(20));assert.equal(await f.arena.treasuryCredit(),0n);
}finally{await f.close();}});
test('incomplete opening excludes unopened votes and refunds them without canceling valid results',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10));await f.commit(2,1,lots(30));let r=await f.arena.getRound(1);await f.goto(r.unlockAt);await f.reveal(a.b);await assert.rejects(f.arena.settle.staticCall(1));await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();r=await f.arena.getRound(1);
  assert.equal(r.cancelled,false);assert.equal(r.refund,true);assert.equal(await f.arena.points(1),1n);assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),lots(10));assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),lots(30));assert.equal(await f.arena.treasuryCredit(),0n);
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

test('draw counters use only revealed votes, ignore empty rounds and cannot double count',async()=>{const f=await fixture();try{
  await f.finish();assert.equal(await f.arena.draws(1),0n);assert.equal(await f.arena.draws(2),0n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,2)).wait();
  await f.commit(1,0,lots(10));await f.commit(2,1,lots(30));await f.finish();
  assert.equal(await f.arena.draws(1),1n);assert.equal(await f.arena.draws(2),1n);assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.losses(2),0n);
  assert.equal(await f.arena.payout(2,await f.signers[1].getAddress()),lots(10));await assert.rejects(f.arena.settle.staticCall(2));assert.equal(await f.arena.draws(1),1n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(3,2)).wait();
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,1,lots(30));await f.commit(3,0,lots(5));const r=await f.arena.getRound(3);
  await f.goto(r.unlockAt);await f.reveal(a.b);await f.reveal(b.b);await f.goto(r.revealEndsAt);await(await f.arena.settle(3)).wait();
  assert.equal((await f.arena.getRound(3)).cancelled,false);assert.equal(await f.arena.draws(1),2n);assert.equal(await f.arena.draws(2),2n);
}finally{await f.close();}});

// Malformed entries can delay finalization until the deadline, but cannot cancel the valid result.
test('SEC-01 regression: an unstaked malformed ballot cannot veto a revealed honest majority',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,0,lots(30)),c=await f.commit(3,1,lots(60));
  const attacker=await f.signers[0].getAddress();
  await(await f.arena.connect(f.signers[0]).commitHolderVotes(1,[1],'0x'+'ab'.repeat(32),'0x01')).wait();
  const r=await f.arena.getRound(1);await f.goto(r.unlockAt);
  for(const entry of [a,b,c])await f.reveal(entry.b);
  assert.equal((await f.arena.getRound(1)).votesA,2n);
  await assert.rejects(f.arena.settle.staticCall(1));
  await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();
  assert.equal((await f.arena.getRound(1)).cancelled,false);
  assert.equal(await f.arena.points(1),1n);
  assert.equal(await f.arena.payout(1,attacker),0n);
  assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),lots('24.75'));
  assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),lots('74.25'));
  assert.equal(await f.arena.payout(1,await f.signers[3].getAddress()),0n);
}finally{await f.close();}});

test('accepted SEC-02 game rule: two minimum bets outvote a larger opposing bet',async()=>{const f=await fixture();try{
  const minimum=parseUnits('5000',18);
  await f.commit(1,0,lots(100));await f.commit(2,1,minimum);await f.commit(3,1,minimum);await f.finish();
  const r=await f.arena.getRound(1);assert.equal(r.winner,1n);assert.equal(r.votesB,2n);
  assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),0n);
  const a=await f.arena.payoutBreakdown(1,await f.signers[2].getAddress()),b=await f.arena.payoutBreakdown(1,await f.signers[3].getAddress());
  assert.equal(a.gross+b.gross,lots(100)+2n*minimum);
}finally{await f.close();}});

test('only the authorized service can reveal; participants cannot selectively rescue an invalid ciphertext',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,0,lots(30)),c=await f.commit(3,1,lots(60));
  const attacker=await f.commit(0,1,lots(20));const r=await f.arena.getRound(1);await f.goto(r.unlockAt);
  for(const ballot of [a.b,b.b,c.b])await f.reveal(ballot);
  assert.equal(await f.arena.revealer(),await f.signers[4].getAddress());
  for(const i of [0,1,2,3,5])await assert.rejects(f.arena.connect(f.signers[i]).revealVote.staticCall(1,attacker.b.account,0,1,2,attacker.b.salt),/Automatic revealer only/);
  await f.goto(r.revealEndsAt);await(await f.arena.connect(f.signers[2]).settle(1)).wait();
  assert.equal((await f.arena.getRound(1)).winner,0n);assert.equal((await f.arena.getRound(1)).cancelled,false);
  assert.deepEqual([...await f.arena.payoutBreakdown(1,attacker.b.account)],[lots(20),0n,lots(20)]);
  // Refunding the excluded entry first must not reduce winners' bank or fees.
  await(await f.arena.claim(1)).wait();
  assert.equal(await f.token.balanceOf(await f.arena.getAddress()),lots(100));
  for(const i of [1,2])await(await f.arena.connect(f.signers[i]).claim(1)).wait();
  assert.equal(await f.arena.treasuryCredit(),lots(1));await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();
  assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
  await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,attacker.b.account,0,1,2,attacker.b.salt));
  await assert.rejects(f.arena.claim.staticCall(1));
}finally{await f.close();}});

test('complete service outage refunds all funded entries with no result statistics or fees',async()=>{const f=await fixture();try{
  await f.commit(1,0,lots(10));await f.commit(2,1,lots(20));await f.commit(0,0,0n,1);
  const r=await f.arena.getRound(1);await f.goto(r.revealEndsAt);await(await f.arena.settle(1)).wait();
  const settled=await f.arena.getRound(1);assert.equal(settled.winner,2n);assert.equal(settled.votesA+settled.votesB,0n);
  assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.draws(1),0n);
  for(const i of [1,2])await(await f.arena.connect(f.signers[i]).claim(1)).wait();
  assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);assert.equal(await f.arena.tokenAvailable(1),true);
}finally{await f.close();}});

test('automatic service decrypts published ballots and excludes garbage without a second participant transaction',async()=>{const f=await fixture(true);try{
  const beacon=JSON.parse(await readFile(new URL('./fixtures/drand-round-1.json',import.meta.url),'utf8'));
  const client=drandClient(async()=>({ok:true,json:async()=>beacon})),r=await f.arena.getRound(1);assert.equal(r.beaconRound,1n);
  await f.commit(0,1,lots(20)); // Deliberately invalid ciphertext before the valid records.
  for(const [i,side,amount]of [[1,0,lots(10)],[2,0,lots(30)],[3,1,lots(60)]]){
    const ballot={arena:await f.arena.getAddress(),chainId:1337,roundId:1,betNonce:0,account:await f.signers[i].getAddress(),side,tokenId:side?2:1,amount:amount.toString()};
    const sealed=await sealBallot(ballot,1,client);
    await(await f.arena.connect(f.signers[i]).commitVote(1,sealed.commitment,amount,0,toUtf8Bytes(sealed.sealedChoice))).wait();
  }
  await f.goto(r.unlockAt);
  const options={arena:f.arena.connect(f.signers[4]),provider:f.provider,fromBlock:0,client,id:1};
  const opened=await processRound(options);assert.equal(opened.phase,'opening');assert.equal(opened.revealed,3);assert.equal(opened.failed,1);
  assert.equal((await f.arena.getRound(1)).votesA,2n);assert.equal((await f.arena.getRound(1)).votesB,1n);
  await f.goto(r.revealEndsAt);
  assert.equal((await processRound(options)).phase,'settled');
  assert.equal((await f.arena.getRound(1)).winner,0n);assert.equal((await f.arena.getRound(1)).cancelled,false);
  assert.equal(await f.arena.payout(1,await f.signers[0].getAddress()),lots(20));
  assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),lots('24.75'));
}finally{await f.close();}});

test('security: tax on incoming tokens rolls back both bank accounting and the entry',async()=>{const f=await fixture();try{
  const zero='0x'+'00'.repeat(20),account=await f.signers[1].getAddress(),arena=await f.arena.getAddress(),balance=await f.token.balanceOf(account);
  await(await f.token.configure(true,zero,zero,'0x')).wait();
  await assert.rejects((async()=>{await(await f.arena.connect(f.signers[1]).commitVote(1,'0x'+'ab'.repeat(32),lots(10),0,'0x01',{gasLimit:500000})).wait();})());
  assert.equal(await f.token.balanceOf(account),balance);assert.equal(await f.token.balanceOf(arena),0n);
  assert.equal((await f.arena.entries(1,account)).committed,false);assert.equal((await f.arena.getRound(1)).committedCount,0n);
  await(await f.token.configure(false,zero,zero,'0x')).wait();await f.commit(1,0,lots(10));
}finally{await f.close();}});

test('security: token callbacks cannot reenter deposits or payouts; failed payouts remain claimable',async()=>{const f=await fixture();try{
  const zero='0x'+'00'.repeat(20),arena=await f.arena.getAddress(),account=await f.signers[1].getAddress();
  await(await f.token.configure(false,zero,arena,f.arena.interface.encodeFunctionData('commitVote',[1,'0x'+'ab'.repeat(32),lots(5),0,'0x01']))).wait();
  await f.commit(1,0,lots(10));assert.equal(await f.token.callbackSucceeded(),false);assert.equal(await f.token.callbackFailure(),signatureId('ReentrancyGuardReentrantCall()').slice(0,10));
  await f.commit(2,0,lots(20));await f.commit(3,1,lots(30));await f.finish();
  const p=await f.arena.payoutBreakdown(1,account),bank=await f.token.balanceOf(arena);
  await(await f.token.configure(false,arena,zero,'0x')).wait();
  await assert.rejects((async()=>{await(await f.arena.connect(f.signers[1]).claim(1,{gasLimit:500000})).wait();})());
  assert.equal((await f.arena.entries(1,account)).claimed,false);assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.token.balanceOf(arena),bank);
  await(await f.token.configure(false,zero,arena,f.arena.interface.encodeFunctionData('claim',[1]))).wait();
  await(await f.arena.connect(f.signers[1]).claim(1,{gasLimit:500000})).wait();
  assert.equal(await f.token.callbackFailure(),signatureId('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await f.token.balanceOf(arena),bank-p.amount);assert.equal(await f.arena.treasuryCredit(),p.fee);
}finally{await f.close();}});

test('security: burning participating NFTs cannot prevent settlement or lock the other NFT',async()=>{const f=await fixture();try{
  await f.commit(1,0,lots(10));await f.commit(2,0,lots(20));await f.commit(3,1,lots(30));
  await(await f.nft.burn(1)).wait();await(await f.nft.connect(f.signers[4]).burn(2)).wait();
  await f.finish();assert.equal((await f.arena.getRound(1)).settled,true);assert.equal(await f.arena.tokenRound(1),0n);assert.equal(await f.arena.tokenRound(2),0n);
  assert.equal(await f.arena.points(1),1n);assert.ok(await f.arena.payout(1,await f.signers[1].getAddress())>0n);
}finally{await f.close();}});

test('security: deterministic payout matrix never spends another round bank or creates fees on refunds',async()=>{const f=await fixture();try{
  let seed=713,expectedDust=0n;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return BigInt(seed);};
  for(let roundId=1;roundId<=8;roundId++){
    if(roundId>1){await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(await f.arena.challengeCount(),2)).wait();}
    const sides=roundId===1?[0,0,0]:roundId===2?[0,1,1]:roundId===3?[0,1]:[Number(random()%2n),Number(random()%2n),Number(random()%2n)];
    const amounts=sides.map(()=>parseUnits('5000',18)+random());
    for(let j=0;j<sides.length;j++)await f.commit(j+1,sides[j],amounts[j]);
    await f.finish();const r=await f.arena.getRound(roundId);let grossTotal=0n,fees=0n;
    for(let j=sides.length-1;j>=0;j--){
      const account=await f.signers[j+1].getAddress(),p=await f.arena.payoutBreakdown(roundId,account);grossTotal+=p.gross;fees+=p.fee;
      if(r.refund){assert.equal(p.gross,amounts[j]);assert.equal(p.fee,0n);}else if(sides[j]!==Number(r.winner))assert.equal(p.amount,0n);
      if(p.amount>0n){await(await f.arena.connect(f.signers[j+1]).claim(roundId)).wait();await assert.rejects(f.arena.connect(f.signers[j+1]).claim.staticCall(roundId));}
    }
    const total=amounts.reduce((a,b)=>a+b,0n),dust=total-grossTotal;
    assert.ok(dust>=0n && dust<BigInt(sides.length));expectedDust+=dust;
    assert.equal(await f.arena.treasuryCredit(),fees);
    if(fees)await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();
    assert.equal(await f.token.balanceOf(await f.arena.getAddress()),expectedDust);
  }
}finally{await f.close();}});

test('security: replayed commitments cannot open another wallet or round, and owner cannot redirect claims',async()=>{const f=await fixture();try{
  const {b}=await f.commit(1,0,lots(10));await f.commit(2,0,lots(20));await f.commit(3,1,lots(30));
  await(await f.arena.createChallenge(3)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,4)).wait();
  const secondBank=parseUnits('5000',18);
  await(await f.arena.connect(f.signers[1]).commitVote(2,makeCommitment(b),secondBank,0,'0x01')).wait();
  await f.goto((await f.arena.getRound(2)).unlockAt);
  await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(2,b.account,0,b.side,b.tokenId,b.salt));
  await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,await f.signers[4].getAddress(),0,b.side,b.tokenId,b.salt));
  for(const ballot of f.ballots)await f.reveal(ballot);
  await(await f.arena.settle(1)).wait();
  assert.equal(await f.arena.owner(),await f.governance.safe.getAddress());
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

test('governance requires a verified Safe and two approvals; a keeper or single owner cannot change roles',async()=>{const f=await fixture();try{
  assert.equal((await validateGovernance(f.provider,f.governance.safe.target)).threshold,2);
  const next=await f.signers[3].getAddress(),old=await f.arena.revealer();
  for(const signer of f.signers){await assert.rejects(f.arena.connect(signer).setRevealer.staticCall(next));await assert.rejects(f.arena.connect(signer).revokeRevealer.staticCall());await assert.rejects(f.arena.connect(signer).emergencyCancelRound.staticCall(1));}
  await assert.rejects(f.govern('setRevealer',[next],[f.signers[0]]));assert.equal(await f.arena.revealer(),old);
  await f.govern('setRevealer',[next]);assert.equal(await f.arena.revealer(),next);
  await assert.rejects(f.govern('withdrawFees'));
  const one=await deploySafe(f.signers.slice(0,3),{threshold:1}),args=[f.token.target,f.nft.target,await f.signers[5].getAddress(),old];
  await assert.rejects(validateGovernance(f.provider,one.safe.target),/two confirmations/);
  await assert.rejects(validateGovernance(f.provider,f.nft.target),/verified Safe/);
  await assert.rejects(f.deploy('BeautyArena.sol','BeautyArena',[...args,await one.safe.getAddress()]));
  await assert.rejects(f.deploy('BeautyArena.sol','BeautyArena',[...args,await f.signers[0].getAddress()]));
  await assert.rejects(f.deploy('BeautyArena.sol','BeautyArena',[...args,f.nft.target]));
  // Modules can execute without owner quorum, so the arena refuses them.
  const safe=f.governance.safe,module=await f.signers[0].getAddress();
  await f.governance.execute(safe.target,safe.interface.encodeFunctionData('enableModule',[module]));
  await assert.rejects(validateGovernance(f.provider,safe.target),/modules/);
  await assert.rejects(f.govern('revokeRevealer'));assert.equal(await f.arena.revealer(),next);
  await f.governance.execute(safe.target,safe.interface.encodeFunctionData('disableModule',['0x0000000000000000000000000000000000000001',module]));
  await f.govern('revokeRevealer');assert.equal(await f.arena.revealer(),'0x0000000000000000000000000000000000000000');
}finally{await f.close();}});

test('normal keeper rotation preserves a valid round while immediately excluding the old signer',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,0,lots(30)),c=await f.commit(3,1,lots(60));
  await f.goto((await f.arena.getRound(1)).unlockAt);await f.reveal(a.b);
  await f.govern('setRevealer',[await f.signers[3].getAddress()]);
  await assert.rejects(f.arena.connect(f.signers[4]).revealVote.staticCall(1,b.b.account,0,b.b.side,b.b.tokenId,b.b.salt));
  for(const {b:ballot}of [b,c])await(await f.arena.connect(f.signers[3]).revealVote(1,ballot.account,ballot.betNonce,ballot.side,ballot.tokenId,ballot.salt)).wait();
  await(await f.arena.settle(1)).wait();assert.equal(await f.arena.points(1),1n);assert.equal(await f.arena.payout(1,a.b.account),lots('24.75'));
  await assert.rejects(f.govern('setRevealer',['0x0000000000000000000000000000000000000000']));
  await assert.rejects(f.govern('setRevealer',[await f.signers[5].getAddress()]));
}finally{await f.close();}});

test('emergency revocation forces unfinished rounds to refund and preserves completed results and claims',async()=>{const f=await fixture();try{
  await f.commit(1,0,lots(10));await f.commit(2,0,lots(30));await f.commit(3,1,lots(60));await f.finish();
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(2,2)).wait();await f.commit(1,0,lots(20));
  await(await f.arena.createChallenge(3)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(3,4)).wait();await f.commit(2,1,lots(30));
  await f.govern('revokeRevealer');assert.equal(await f.arena.interruptedThroughRound(),3n);assert.equal(await f.arena.roundInterrupted(2),true);
  await assert.rejects(f.arena.connect(f.signers[3]).commitVote.staticCall(2,'0x'+'ab'.repeat(32),lots(5),0,'0x01'));
  await assert.rejects(f.arena.connect(f.signers[4]).acceptChallenge.staticCall(99,999),/suspended/);
  await assert.rejects(f.govern('emergencyCancelRound',[1]));
  // Public settlement gives refunds before the normal deadline, even without a keeper.
  await(await f.arena.connect(f.signers[2]).settle(2)).wait();assert.equal((await f.arena.getRound(2)).cancelled,true);
  await f.govern('setRevealer',[await f.signers[3].getAddress()]);
  await assert.rejects(f.arena.connect(f.signers[3]).revealVote.staticCall(3,await f.signers[2].getAddress(),0,1,4,'0x'+'ab'.repeat(32)),/interrupted/);
  await(await f.arena.settle(3)).wait();assert.equal((await f.arena.getRound(3)).cancelled,true);
  for(const [id,i,amount]of [[2,1,20],[3,2,30]]){assert.equal(await f.arena.payout(id,await f.signers[i].getAddress()),lots(amount));await(await f.arena.connect(f.signers[i]).claim(id)).wait();await assert.rejects(f.arena.connect(f.signers[i]).claim.staticCall(id));}
  assert.equal(await f.arena.treasuryCredit(),0n);assert.equal(await f.arena.points(1),1n);assert.equal(await f.arena.losses(2),1n);assert.equal(await f.arena.draws(3),0n);
  for(const i of [1,2])await(await f.arena.connect(f.signers[i]).claim(1)).wait();await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(f.arena.target),0n);
  await(await f.arena.createChallenge(1)).wait();await(await f.arena.connect(f.signers[4]).acceptChallenge(4,2)).wait();await f.commit(1,0,lots(5));
  assert.equal(await f.arena.roundInterrupted(4),false);await f.govern('emergencyCancelRound',[4]);assert.equal(await f.arena.payout(4,await f.signers[1].getAddress()),lots(5));
}finally{await f.close();}});

test('governance can cancel a revealed but unfinished round without recording a result or fee',async()=>{const f=await fixture();try{
  const a=await f.commit(1,0,lots(10)),b=await f.commit(2,0,lots(30)),c=await f.commit(3,1,lots(60));await f.goto((await f.arena.getRound(1)).unlockAt);
  for(const {b:ballot}of [a,b,c])await f.reveal(ballot);await f.govern('emergencyCancelRound',[1]);
  assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.losses(2),0n);assert.equal(await f.arena.draws(1),0n);
  for(const [i,amount]of [[1,10],[2,30],[3,60]])assert.deepEqual([...await f.arena.payoutBreakdown(1,await f.signers[i].getAddress())],[lots(amount),0n,lots(amount)]);
  await assert.rejects(f.arena.settle.staticCall(1));assert.equal(await f.arena.tokenAvailable(1),true);
}finally{await f.close();}});

test('governance transfer requires acceptance by another verified multisig and cannot be renounced',async()=>{const f=await fixture();try{
  const replacement=await deploySafe([f.signers[0],f.signers[2],f.signers[3]]),original=await f.arena.owner();
  await assert.rejects(f.govern('transferOwnership',[await f.signers[0].getAddress()]));await assert.rejects(f.govern('renounceOwnership'));
  await f.govern('transferOwnership',[replacement.safe.target]);assert.equal(await f.arena.owner(),original);assert.equal(await f.arena.pendingOwner(),replacement.safe.target);
  await assert.rejects(f.arena.acceptOwnership.staticCall());
  await replacement.execute(f.arena.target,f.arena.interface.encodeFunctionData('acceptOwnership'));
  assert.equal(await f.arena.owner(),replacement.safe.target);await assert.rejects(f.govern('revokeRevealer'));
  await replacement.execute(f.arena.target,f.arena.interface.encodeFunctionData('revokeRevealer'));assert.equal(await f.arena.roundInterrupted(1),true);
}finally{await f.close();}});
