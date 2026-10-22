import test from 'node:test';
import assert from 'node:assert/strict';
import {ContractFactory,parseUnits,toUtf8Bytes} from 'ethers';
import {compileV2} from '../scripts/compile.mjs';
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {deploySafe} from '../test-support/safe.mjs';
import {makeCommitment,makeSalt,DEMO_ARENA} from '../lib/commitments.mjs';
import {holderTokensHash} from '../lib/holder-ballots.mjs';
import * as demo from '../lib/demo.mjs';
import {publicChainRound} from '../lib/chain-index.mjs';
const amount=parseUnits('5000',18);
const compiled=compileV2({'ParticipantMocks.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
contract ParticipantToken is ERC20 {constructor() ERC20('Chog','CHOG'){} function mint(address a,uint256 n) external{_mint(a,n);}}
contract ParticipantNFT is ERC721 {constructor() ERC721('Chog','CHOG'){} function mint(address a,uint256 n) external{_mint(a,n);}}`}});
async function fixture(){
  const evm=await startLocalEvm(),provider=evm.provider;
  try{
    const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i))),accounts=await Promise.all(signers.map(s=>s.getAddress()));
    async function deploy(file,name,args=[]){const a=compiled[file][name],c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
    const governance=await deploySafe(signers.slice(0,3)),token=await deploy('ParticipantMocks.sol','ParticipantToken'),nft=await deploy('ParticipantMocks.sol','ParticipantNFT');
    const arena=await deploy('BeautyArenaV2.sol','BeautyArenaV2',[token.target,nft.target,accounts[5],accounts[4],governance.safe.target]);
    for(let i=0;i<4;i++){await(await token.mint(accounts[i],20n*amount)).wait();await(await token.connect(signers[i]).approve(arena.target,20n*amount)).wait();}
    for(const [id,owner]of [[1,0],[2,1],[3,0],[4,1],[5,2],[6,2]])await(await nft.mint(accounts[owner],id)).wait();
    await(await arena.createChallenge(1)).wait();await(await arena.connect(signers[1]).acceptChallenge(1,2)).wait();
    async function paid(i,side){const betNonce=Number(await arena.betCount(1,accounts[i])),b={arena:arena.target,chainId:1337,roundId:1,account:accounts[i],betNonce,side,tokenId:side?2:1,amount:amount.toString(),salt:makeSalt()};await(await arena.connect(signers[i]).commitVote(1,makeCommitment(b),amount,betNonce,toUtf8Bytes('opaque'))).wait();return b;}
    async function holder(i,side,ids){const b={arena:arena.target,chainId:1337,roundId:1,account:accounts[i],side,tokenId:side?2:1,amount:'0',holderKey:ids[0],holderTokenIdsHash:holderTokensHash(ids),salt:makeSalt()};await(await arena.connect(signers[i]).commitHolderVotes(1,ids,makeCommitment(b),toUtf8Bytes('opaque'))).wait();return b;}
    async function open(ballots){const r=await arena.getRound(1);await provider.send('evm_setNextBlockTimestamp',[Number(r.unlockAt)]);await provider.send('evm_mine',[]);for(const b of ballots){const a=arena.connect(signers[4]);await(await(b.holderKey===undefined?a.revealVote(1,b.account,b.betNonce,b.side,b.tokenId,b.salt):a.revealHolderVotes(1,b.holderKey,b.side,b.tokenId,b.salt))).wait();}await(await arena.settle(1)).wait();}
    return{evm,arena,nft,token,signers,accounts,paid,holder,open};
  }catch(e){await evm.close();throw e;}
}
test('V2 fixes participant wallets at acceptance, rejects their NFT votes, counts no paid votes and pays their winning bets',async()=>{
  const f=await fixture();try{
    const {arena,accounts,signers,nft}=f,r=await arena.getRound(1);
    assert.equal(await arena.RULES_VERSION(),8n);assert.equal(r.participantA,accounts[0]);assert.equal(r.participantB,accounts[1]);
    const publicRound=publicChainRound(1,r);assert.equal(publicRound.protocolVersion,8);assert.equal(publicRound.participantA,accounts[0]);
    for(const [i,ids]of [[0,[1,3]],[1,[2,4]]])await assert.rejects(arena.connect(signers[i]).commitHolderVotes.staticCall(1,ids,'0x'+'ab'.repeat(32),'0x01'),/participants cannot vote/);
    assert.equal(await arena.unstakedVoteUsed(1,3),false);assert.equal((await arena.getRound(1)).committedCount,0n);
    await(await nft.transferFrom(accounts[0],accounts[2],1)).wait();
    assert.equal(await arena.isRoundParticipant(1,accounts[0]),true);
    await assert.rejects(arena.commitHolderVotes.staticCall(1,[3],'0x'+'ab'.repeat(32),'0x01'),/participants cannot vote/);
    const ballots=[await f.paid(0,0),await f.paid(0,0),await f.paid(1,1),await f.holder(2,0,[5,6]),await f.paid(2,1),await f.paid(3,0),await f.paid(3,1)];
    await f.open(ballots);
    const end=await arena.getRound(1);assert.equal(end.votesA,3n);assert.equal(end.votesB,1n);assert.equal(end.poolA,3n*amount);assert.equal(end.poolB,3n*amount);
    assert.equal(end.winner,0n);assert.equal(await arena.payout(1,accounts[0]),4n*amount*99n/100n);
    await(await arena.claim(1)).wait();assert.equal(await arena.treasuryCredit(),4n*amount/100n);assert.equal(await arena.payout(1,accounts[0]),0n);
    // Roles are per battle, rather than a global ban on a wallet.
    await(await nft.connect(signers[1]).transferFrom(accounts[1],accounts[3],2)).wait();
    await(await arena.connect(signers[2]).createChallenge(1)).wait();await(await arena.connect(signers[3]).acceptChallenge(2,2)).wait();
    assert.equal(await arena.isRoundParticipant(2,accounts[0]),false);await(await arena.commitHolderVotes(2,[3],'0x'+'cd'.repeat(32),'0x01')).wait();
  }finally{await f.evm.close();}
});
test('V2 participant-only bets create no result votes and refund every deposited unit without a fee',async()=>{
  const f=await fixture();try{
    await f.open([await f.paid(0,0),await f.paid(0,1),await f.paid(1,1)]);
    const r=await f.arena.getRound(1);assert.equal(r.votesA,0n);assert.equal(r.votesB,0n);assert.equal(r.winner,2n);
    assert.equal(await f.arena.draws(1),0n);assert.equal(await f.arena.treasuryCredit(),0n);
    assert.deepEqual([...await f.arena.payoutBreakdown(1,f.accounts[0])],[2n*amount,0n,2n*amount]);
    await(await f.arena.claim(1)).wait();await(await f.arena.connect(f.signers[1]).claim(1)).wait();assert.equal(await f.token.balanceOf(f.arena.target),0n);
  }finally{await f.evm.close();}
});
test('v8 demo blocks both participants after transfers, permits paid bets without votes, and preserves legacy round rules',()=>{
  const s=demo.createState(),now=Date.now();for(const [id,owner]of [[1,'host'],[2,'opponent'],[3,'host'],[4,'viewer']])s.ownership[id]=demo.user(s,owner).address;
  demo.createChallenge(s,'host',1,now);const r=demo.acceptChallenge(s,'opponent',1,2,now,true);
  assert.equal(r.protocolVersion,8);s.ownership[1]=demo.user(s,'viewer').address;
  for(const [account,ids]of [['host',[3]],['opponent',[2]]])assert.throws(()=>demo.commitHolderVotes(s,account,{roundId:1,tokenIds:ids,commitment:'0x'+'ab'.repeat(32),sealedChoice:'opaque'},now),/participants cannot vote/);
  const ballots=[];
  for(const [id,side]of [['host',0],['host',1],['opponent',1],['viewer',0]]){
    const b={arena:DEMO_ARENA,chainId:143,roundId:1,account:demo.user(s,id).address,betNonce:demo.nextBetNonce(r,id),side,tokenId:side?2:1,amount:amount.toString(),salt:makeSalt()};demo.commitVote(s,id,{roundId:1,betNonce:b.betNonce,amount,commitment:makeCommitment(b),sealedChoice:'opaque'},now);ballots.push([id,b]);
  }
  for(const [id,b]of ballots)demo.revealVote(s,id,b,r.unlockAt);assert.equal(r.votesA,1);assert.equal(r.votesB,0);demo.settle(s,r,r.unlockAt);
  assert.deepEqual(demo.payoutBreakdown(r,'host'),{gross:2n*amount,fee:2n*amount/100n,amount:2n*amount*99n/100n});
  const saved=structuredClone(r);assert.equal(demo.migrateAggregatePayouts(s),false);assert.deepEqual(r,saved);
  assert.equal(demo.isRoundParticipant({...r,protocolVersion:7},demo.user(s,'host').address),false);
});
