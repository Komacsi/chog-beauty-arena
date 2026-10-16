import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseUnits} from 'ethers';
import {compile} from '../scripts/compile.mjs';
const compiled=compile({'Mocks.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
contract MockToken is ERC20 { constructor() ERC20('Chog','CHOG') {} function mint(address a,uint256 n) external {_mint(a,n);} }
contract MockNFT is ERC721 { constructor() ERC721('Chog','CHOG') {} function mint(address a,uint256 n) external {_mint(a,n);} }`}});
const units=n=>parseUnits(String(n),18);
async function fixture(){
  const transport=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{totalAccounts:6}});
  const provider=new BrowserProvider(transport);provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
  async function deploy(file,name,args=[]){const artifact=compiled[file][name];const contract=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy(...args);await contract.waitForDeployment();return contract;}
  const token=await deploy('Mocks.sol','MockToken');const nft=await deploy('Mocks.sol','MockNFT');
  const arena=await deploy('BeautyArena.sol','BeautyArena',[await token.getAddress(),await nft.getAddress(),await signers[5].getAddress()]);
  for(let i=0;i<5;i++){await(await token.mint(await signers[i].getAddress(),units(1000))).wait();await(await token.connect(signers[i]).approve(await arena.getAddress(),units(1000))).wait();}
  await(await nft.mint(await signers[0].getAddress(),1)).wait();await(await nft.mint(await signers[0].getAddress(),2)).wait();
  await(await arena.startRound(1,2)).wait();
  const advance=async(id=1)=>{await provider.send('evm_increaseTime',[86401]);await provider.send('evm_mine',[]);await(await arena.settle(id)).wait();};
  const close=async()=>{provider.destroy();await transport.disconnect();};
  return {provider,signers,token,nft,arena,advance,close};
}
test('contract: stake-weight independent votes, proportional payout, fees and duplicate claims',async()=>{
  const f=await fixture();try{
    await(await f.arena.connect(f.signers[1]).vote(1,0,units(10),0)).wait();
    await(await f.arena.connect(f.signers[2]).vote(1,0,units(30),0)).wait();
    await(await f.arena.connect(f.signers[3]).vote(1,1,units(60),0)).wait();
    await assert.rejects(f.arena.connect(f.signers[1]).vote.staticCall(1,1,units(5),0));
    await assert.rejects(f.arena.settle.staticCall(1));
    await assert.rejects(f.arena.startRound.staticCall(1,2));
    await f.advance();assert.equal(await f.arena.FEE_BPS(),100n);assert.equal(await f.arena.payout(1,await f.signers[1].getAddress()),units('24.75'));
    assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),units('74.25'));assert.equal(await f.arena.points(1),1n);
    await assert.rejects(f.arena.settle.staticCall(1));
    await(await f.arena.connect(f.signers[1]).claim(1)).wait();await assert.rejects(f.arena.connect(f.signers[1]).claim.staticCall(1));
    await assert.rejects(f.arena.withdrawFees.staticCall());
    await(await f.arena.connect(f.signers[5]).withdrawFees()).wait();assert.equal(await f.token.balanceOf(await f.signers[5].getAddress()),units('1'));
    await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.token.balanceOf(await f.arena.getAddress()),0n);
    await assert.rejects(f.arena.connect(f.signers[4]).vote.staticCall(1,0,units(1),0));
  }finally{await f.close();}
});
test('contract: holders vote free, NFT cannot be reused after transfer, non-holders need stakes',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.arena.connect(f.signers[1]).vote.staticCall(1,0,0,1));
    await(await f.arena.vote(1,0,0,1)).wait();
    await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),1)).wait();
    await assert.rejects(f.arena.connect(f.signers[1]).vote.staticCall(1,0,0,1));
    await(await f.arena.connect(f.signers[2]).vote(1,1,units(20),0)).wait();
    await f.advance();assert.equal((await f.arena.getRound(1)).refund,true);assert.equal(await f.arena.points(1),0n);assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),units('20'));assert.equal(await f.arena.treasuryCredit(),0n);
  }finally{await f.close();}
});
test('contract: no winning stake refunds losing stakes and still awards the winning NFT',async()=>{
  const f=await fixture();try{
    await(await f.arena.vote(1,0,0,1)).wait();await(await f.nft.transferFrom(await f.signers[0].getAddress(),await f.signers[1].getAddress(),2)).wait();
    await(await f.arena.connect(f.signers[1]).vote(1,0,0,2)).wait();await(await f.arena.connect(f.signers[2]).vote(1,1,units(100),0)).wait();
    await f.advance();assert.equal(await f.arena.points(1),1n);assert.equal(await f.arena.payout(1,await f.signers[2].getAddress()),units('100'));assert.equal(await f.arena.treasuryCredit(),0n);
    await(await f.arena.connect(f.signers[2]).claim(1)).wait();assert.equal(await f.token.balanceOf(await f.signers[2].getAddress()),units('1000'));
  }finally{await f.close();}
});
test('contract: winning side with the only bank pays no fee in either direction',async()=>{
  const f=await fixture();try{
    for(const side of [0,1]){
      const id=side+1;if(id>1)await(await f.arena.startRound(1,2)).wait();
      await(await f.arena.connect(f.signers[1]).vote(id,side,units(100),0)).wait();
      await f.advance(id);const round=await f.arena.getRound(id);
      assert.equal(round.winner,BigInt(side));assert.equal(round.refund,true);assert.equal(round.distributable,units(100));
      assert.equal(await f.arena.payout(id,await f.signers[1].getAddress()),units(100));assert.equal(await f.arena.treasuryCredit(),0n);
      await(await f.arena.connect(f.signers[1]).claim(id)).wait();assert.equal(await f.token.balanceOf(await f.signers[1].getAddress()),units(1000));
    }
    assert.equal(await f.arena.points(1),1n);assert.equal(await f.arena.points(2),1n);await assert.rejects(f.arena.connect(f.signers[5]).withdrawFees.staticCall());
  }finally{await f.close();}
});
