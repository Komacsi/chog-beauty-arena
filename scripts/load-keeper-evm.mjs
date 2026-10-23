// Real contract execution on disposable loopback Anvil. No external RPC or real key.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ContractFactory,Wallet,parseEther,parseUnits,toUtf8Bytes} from 'ethers';
import {compile} from './compile.mjs';
import {startLocalEvm} from '../test-support/local-evm.mjs';
import {deploySafe} from '../test-support/safe.mjs';
import {sealBallot,drandClient} from '../lib/timelock.mjs';
import {holderTokensHash} from '../lib/holder-ballots.mjs';
import {ChainIndex} from '../lib/chain-index.mjs';
import {KeeperTransactions} from '../lib/keeper-transactions.mjs';
import {keeperCycle} from '../lib/keeper-cycle.mjs';
const [output,countArg='128']=process.argv.slice(2),count=Number(countArg);
if(!output||!Number.isSafeInteger(count)||count<16||count>1000||count%4)throw Error('Usage: load-keeper-evm NEW_REPORT [16..1000 paid entries, divisible by four]');
const originalLog=console.log.bind(console);console.log=(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('beacon received:'))return;originalLog(...args);};
const compiled=compile({'LoadMocks.sol':{content:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
contract LoadToken is ERC20 {constructor() ERC20('Load CHOG','CHOG'){} function mint(address to,uint256 amount) external {_mint(to,amount);}}
contract LoadNFT is ERC721 {constructor() ERC721('Load NFT','NFT'){} function mint(address to,uint256 first,uint256 count) external {for(uint256 i;i<count;i++)_mint(to,first+i);}}`}});
const start=performance.now(),evm=await startLocalEvm({timestamp:1692803367-86400-300}),provider=evm.provider,dir=await mkdtemp(join(tmpdir(),'chog-evm-load-'));
let index,transactions;
try{
  const signers=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const deploy=async(file,name,args=[])=>{const a=compiled[file][name],c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;};
  const safe=await deploySafe(signers.slice(0,3)),token=await deploy('LoadMocks.sol','LoadToken'),nft=await deploy('LoadMocks.sol','LoadNFT'),keeper=Wallet.createRandom().connect(provider);
  await(await signers[0].sendTransaction({to:keeper.address,value:parseEther('10')})).wait();
  const arena=await deploy('BeautyArena.sol','BeautyArena',[token.target,nft.target,addresses[5],keeper.address,safe.safe.target]),connected=arena.connect(keeper),minimum=parseUnits('5000',18);
  for(const i of [1,2,3,4]){await(await token.mint(addresses[i],minimum*BigInt(count+4))).wait();await(await token.connect(signers[i]).approve(arena.target,minimum*BigInt(count+4))).wait();}
  await(await nft.mint(addresses[0],1,4)).wait();await(await nft.mint(addresses[4],5,4)).wait();await(await nft.mint(addresses[0],100,200)).wait();
  for(let id=1;id<=4;id++){await(await arena.createChallenge(id)).wait();await(await arena.connect(signers[4]).acceptChallenge(id,id+4)).wait();}
  const beacon=JSON.parse(await readFile(new URL('../test/fixtures/drand-round-1.json',import.meta.url),'utf8')),client=drandClient(async()=>({ok:true,json:async()=>beacon})),expected=[];
  for(let i=0;i<count;i++){
    const id=i%4+1,who=Math.floor(i/4)%4+1,nonce=Number(await arena.betCount(id,addresses[who])),side=who<3?0:1;
    const b={arena:arena.target,chainId:1337,roundId:id,account:addresses[who],betNonce:nonce,side,tokenId:side?id+4:id,amount:minimum.toString()},sealed=await sealBallot(b,1,client);
    await(await arena.connect(signers[who]).commitVote(id,sealed.commitment,minimum,nonce,toUtf8Bytes(sealed.sealedChoice))).wait();
    if((i+1)%32===0)console.error(JSON.stringify({stage:'evm-commits',entries:i+1,total:count}));
  }
  for(let id=1;id<=4;id++){
    const ids=Array.from({length:50},(_,i)=>100+(id-1)*50+i),b={arena:arena.target,chainId:1337,roundId:id,account:addresses[0],side:0,tokenId:id,amount:'0',holderKey:ids[0],holderTokenIdsHash:holderTokensHash(ids)},sealed=await sealBallot(b,1,client);
    await(await arena.commitHolderVotes(id,ids,sealed.commitment,toUtf8Bytes(sealed.sealedChoice))).wait();
    const nonce=Number(await arena.betCount(id,addresses[3]));await(await arena.connect(signers[3]).commitVote(id,'0x'+'ab'.repeat(32),minimum,nonce,toUtf8Bytes('invalid'))).wait();
    expected.push({id,validPaid:count/4,holderWeight:50});
  }
  const fromBlock=0,open=()=>{index=new ChainIndex(join(dir,'events.sqlite'),{chainId:1337,arena:arena.target,collection:nft.target,fromBlock});transactions=new KeeperTransactions(join(dir,'tx.sqlite'),{provider,signer:keeper,arena:arena.target,chainId:1337});};open();
  const round=await arena.getRound(1);assert.equal(round.beaconRound,1n);await provider.send('evm_setNextBlockTimestamp',[Number(round.unlockAt)]);await provider.send('evm_mine',[]);
  const revealStart=performance.now();let cycles=0,restarts=0;
  const cycle=async()=>{for(let i=0;i<3;i++)await provider.send('evm_mine',[]);const head=await provider.getBlock('latest');const result=await keeperCycle({arena:connected,provider,index,transactions,client,expectedRevealer:keeper.address,chainId:1337,now:()=>Number(head.timestamp)*1000});cycles++;if(cycles%25===0){index.close();transactions.close();open();restarts++;}return result;};
  for(let n=0;n<count+40;n++){
    await cycle();let complete=true;for(const e of expected)if((await arena.getRound(e.id)).revealedCount!==BigInt(e.validPaid+e.holderWeight))complete=false;if(complete&&!transactions.pending())break;
  }
  const revealWallMs=Math.round(performance.now()-revealStart);
  for(const e of expected){const r=await arena.getRound(e.id);assert.equal(r.revealedCount,BigInt(e.validPaid+50));assert.equal(r.committedCount,r.revealedCount+1n);assert.equal(r.votesA,52n);assert.equal(r.votesB,2n);}
  await provider.send('evm_setNextBlockTimestamp',[Number(round.revealEndsAt)]);await provider.send('evm_mine',[]);
  for(let n=0;n<20;n++){await cycle();if(index.db.prepare('SELECT count(*) AS n FROM rounds WHERE settled=0').get().n===0&&!transactions.pending())break;}
  const gasByMethod={};
  for(const row of transactions.db.prepare('SELECT operation,id FROM transactions').all()){
    const hash=transactions.db.prepare('SELECT hash FROM variants WHERE transaction_id=?').get(row.id).hash,receipt=await provider.getTransactionReceipt(hash);assert.equal(receipt.status,1);
    const type=row.operation.startsWith('settle:')?'settle':row.operation.includes(':holder:')?'revealHolderVotes50':'revealVote';(gasByMethod[type]??=[]).push(Number(receipt.gasUsed));
  }
  let gross=0n,fee=0n,net=0n;const payouts=[];
  for(const e of expected){assert.equal((await arena.getRound(e.id)).settled,true);for(const who of [1,2,3,4]){const p=await arena.payoutBreakdown(e.id,addresses[who]);gross+=p.gross;fee+=p.fee;net+=p.amount;if(p.amount>0n)await(await arena.connect(signers[who]).claim(e.id)).wait();payouts.push({round:e.id,wallet:who,gross:String(p.gross),fee:String(p.fee),net:String(p.amount)});}}
  await(await arena.connect(signers[5]).withdrawFees()).wait();assert.equal(await token.balanceOf(arena.target),0n);assert.equal(gross,minimum*BigInt(count+4));assert.equal(net+fee,gross);
  for(let id=100;id<300;id++)assert.equal(await nft.ownerOf(id),addresses[0]);
  assert.equal(index.db.prepare('SELECT count(*) AS n FROM ballots WHERE done=0').get().n,0);
  const gas=Object.fromEntries(Object.entries(gasByMethod).map(([key,a])=>[key,{transactions:a.length,min:Math.min(...a),max:Math.max(...a),total:a.reduce((x,y)=>x+y,0)}]));
  const result={checkedAt:new Date().toISOString(),platform:process.platform,node:process.version,chain:'disposable local Anvil 1337',rounds:4,validPaidEntries:count,holderGroups:4,holderVotes:200,malformedPaidEntries:4,cycles,restarts,revealWallMs,totalWallMs:Math.round(performance.now()-start),allValidVotesOpened:true,allRoundsSettled:true,queueRemaining:0,allNFTsRetained:true,grossWei:String(gross),feesWei:String(fee),netWei:String(net),arenaFinalBalanceWei:'0',gas,payouts,realTransactionsSent:0,limitations:'Actual contract bytecode, Safe, timelock crypto, index/journal/signing and local transactions. Three blocks are mined manually per cycle, timestamps are accelerated, no 1-second production pause; wall times are not mainnet capacity. Token/NFT are mocks, gas excludes commits and claims.'};
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}finally{index?.close();transactions?.close();await evm.close();await rm(dir,{recursive:true,force:true});}
