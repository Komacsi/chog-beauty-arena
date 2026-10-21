import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {Wallet,Transaction,Interface,toUtf8Bytes,hexlify} from 'ethers';
import {ChainIndex} from '../lib/chain-index.mjs';
import {KeeperTransactions} from '../lib/keeper-transactions.mjs';
import {keeperCycle} from '../lib/keeper-cycle.mjs';
import {writeKeeperHealth,keeperHealthAlerts} from '../lib/keeper-health.mjs';
const arena='0x2222222222222222222222222222222222222222',account='0x1111111111111111111111111111111111111111';
async function temp(fn){const dir=await mkdtemp(join(tmpdir(),'chog-durable-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const events=new Interface(['event RoundStarted(uint256 indexed id,uint256 nftA,uint256 nftB,uint256 endsAt,uint256 unlockAt)','event VoteCommitted(uint256 indexed id,address indexed account,uint256 indexed betNonce,bytes32 commitment,uint256 amount,bytes sealedChoice)','event RoundSettled(uint256 indexed id,uint8 winner,bool refund,bool cancelled)']);
function log(name,args,blockNumber,index=0){return {...events.encodeEventLog(events.getEvent(name),args),address:arena,blockNumber,index};}
const hash='0x'+'11'.repeat(32);
test('public heartbeat reports stale service and stuck transactions without exposing signed bytes',()=>temp(async dir=>{
  const path=join(dir,'health.json');assert.equal((await keeperHealthAlerts(path,1000))[0].code,'KEEPER_HEARTBEAT_UNAVAILABLE');
  const previousMask=process.umask(0o077);
  try{await writeKeeperHealth(path,{phase:'pending',transaction:{ageMs:400000,raw:'secret signed bytes'}},1000);}finally{process.umask(previousMask);}
  if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o644);
  assert.ok(!(await readFile(path,'utf8')).includes('secret signed bytes'));
  assert.deepEqual((await keeperHealthAlerts(path,1000)).map(a=>a.code),['KEEPER_TRANSACTION_STUCK']);
  assert.deepEqual((await keeperHealthAlerts(path,100000)).map(a=>a.code),['KEEPER_HEARTBEAT_STALE','KEEPER_TRANSACTION_STUCK']);
  await writeKeeperHealth(path,{phase:'fee-cap'},100000);assert.equal((await keeperHealthAlerts(path,100000))[0].code,'KEEPER_FEE_CAP');
}));
test('large RPC responses split into smaller ranges without losing events or looping unboundedly',()=>temp(async dir=>{
  const index=new ChainIndex(join(dir,'index.sqlite'),{chainId:143,arena,fromBlock:1});let calls=0;
  const provider={getBlock:async n=>({number:n==='latest'?103:n,hash:'b'+n}),getLogs:async q=>{calls++;if(q.toBlock-q.fromBlock>=10)throw Error('HTTP 413');return [];}};
  const result=await index.sync({provider,arena:{interface:events},maxRanges:100});assert.equal(result.backlogBlocks,0);assert.ok(calls<=100);assert.equal(index.cursor,100);index.close();
}));
test('index tracks stale request ownership and refreshes only dirty snapshots in bounded pages',()=>temp(async dir=>{
  const index=new ChainIndex(join(dir,'index.sqlite'),{chainId:143,arena,fromBlock:1});index.set('cursor',100);
  index.apply({name:'ChallengeCreated',args:{id:1,creator:account,tokenId:6}},1);assert.equal(index.view().challenges[0].valid,true);
  index.apply({name:'Transfer',args:{to:arena,tokenId:6}},2);assert.equal(index.view().challenges[0].valid,false);
  index.apply({name:'Transfer',args:{to:account,tokenId:6}},3);assert.equal(index.view().challenges[0].valid,true);
  for(let id=1;id<=100;id++)index.apply({name:'RoundStarted',args:{id,unlockAt:20}},1);
  let calls=0;const contract={getRound:async()=>{calls++;return {nftA:1,nftB:2,endsAt:10,unlockAt:20,revealEndsAt:30,beaconRound:1,committedCount:0,revealedCount:0,totalCommitted:0,votesA:0,votesB:0,poolA:0,poolB:0,settled:false,winner:2,refund:false,cancelled:false};}};
  await index.snapshots(contract,20);assert.equal(calls,20);assert.equal(index.view().incompleteSnapshots,80);
  for(let n=0;n<4;n++)await index.snapshots(contract,20);await index.snapshots(contract,20);assert.equal(calls,100);assert.equal(index.view().incompleteSnapshots,0);index.close();
}));
test('index persists a bounded cursor, indexes all ballots once and never rescans old ranges',()=>temp(async dir=>{
  const calls=[],provider={getBlock:async n=>({number:n==='latest'?302:n,hash:'block'+n,timestamp:1000}),getLogs:async q=>{calls.push([q.fromBlock,q.toBlock]);return q.fromBlock===1?[log('RoundStarted',[1,1,2,10,20],1),log('VoteCommitted',[1,account,0,hash,5000,'0x01'],2)]:[];}};
  let index=new ChainIndex(join(dir,'events.sqlite'),{chainId:143,arena,fromBlock:1});
  const first=await index.sync({provider,arena:{interface:events},maxRanges:1,confirmations:2});assert.equal(first.backlogBlocks,200);assert.equal(index.ballots(1,1).length,1);index.close();
  index=new ChainIndex(join(dir,'events.sqlite'),{chainId:143,arena,fromBlock:1});
  await index.sync({provider,arena:{interface:events},maxRanges:3,confirmations:2});
  assert.deepEqual(calls,[[1,100],[101,200],[201,300]]);await index.sync({provider,arena:{interface:events},confirmations:2});assert.equal(calls.length,3);
  assert.equal(index.ready(50,0).length,1);assert.deepEqual(index.walletRounds(account),[]);
  index.apply({name:'RoundSettled',args:{id:1}},300);assert.deepEqual(index.walletRounds(account),[1]);index.close();
  assert.throws(()=>new ChainIndex(join(dir,'events.sqlite'),{chainId:144,arena,fromBlock:1}),/another chain/);
}));
test('failed RPC ranges keep the cursor; a changed checkpoint rebuilds the public index',()=>temp(async dir=>{
  const index=new ChainIndex(join(dir,'index.sqlite'),{chainId:143,arena,fromBlock:1});let broken=true,fork='a';
  const provider={getBlock:async n=>({number:n==='latest'?103:n,hash:fork+n,timestamp:100}),getLogs:async()=>{if(broken)throw Error('RPC offline');return [];}};
  await assert.rejects(index.sync({provider,arena:{interface:events}}),/offline/);assert.equal(index.cursor,0);broken=false;
  await index.sync({provider,arena:{interface:events}});assert.equal(index.cursor,100);fork='b';
  const result=await index.sync({provider,arena:{interface:events}});assert.equal(result.reorgReset,true);assert.equal(index.get('hash'),'b100');index.close();
}));
function signingFixture(){
  const wallet=Wallet.createRandom(),broadcasts=[],receipts=new Map();let nonce=0,head=10,clock=1000,failBroadcast=true;
  const provider={getTransactionCount:async()=>nonce,getBlockNumber:async()=>head,getBlock:async()=>({hash:'canonical'}),getTransactionReceipt:async h=>receipts.get(h)||null,getFeeData:async()=>({maxFeePerGas:150n,gasPrice:150n}),broadcastTransaction:async raw=>{broadcasts.push(raw);if(failBroadcast)throw Error('Connection reset after send');return {};}};
  const signer={address:wallet.address,populateTransaction:async r=>({...r,type:2,gasLimit:100000n,maxFeePerGas:100n,maxPriorityFeePerGas:1n}),signTransaction:r=>wallet.signTransaction(r)};
  return {provider,signer,broadcasts,receipts,options:{provider,signer,arena,chainId:143,now:()=>clock,replacementMs:100},set(v){if(v.nonce!==undefined)nonce=v.nonce;if(v.head!==undefined)head=v.head;if(v.clock!==undefined)clock=v.clock;if(v.failBroadcast!==undefined)failBroadcast=v.failBroadcast;}};
}
test('crash/ambiguous broadcast recovers identical signed bytes and nonce before another operation',()=>temp(async dir=>{
  const f=signingFixture(),path=join(dir,'tx.sqlite');let tx=new KeeperTransactions(path,f.options);
  await assert.rejects(tx.send('reveal:1',{to:arena,data:'0x1234'}),/reset/);assert.ok(tx.pending());
  const restored=join(dir,'restored.sqlite');await backup(tx.db,restored);tx.close();
  tx=new KeeperTransactions(restored,f.options);f.set({failBroadcast:false});assert.equal((await tx.send('reveal:2',{to:arena,data:'0xabcd'})).phase,'pending');
  const pending=await tx.recover();assert.equal(pending.phase,'pending');assert.equal(f.broadcasts[0],f.broadcasts[1]);
  const parsed=Transaction.from(f.broadcasts[0]);assert.equal(parsed.nonce,0);assert.equal(parsed.data,'0x1234');
  f.receipts.set(parsed.hash,{status:1,blockNumber:9,blockHash:'canonical'});assert.equal((await tx.recover()).phase,'confirming');
  f.set({head:11,nonce:1});assert.equal((await tx.recover()).phase,'confirmed');assert.equal(tx.pending(),undefined);
  await tx.send('reveal:2',{to:arena,data:'0xabcd'});assert.equal(Transaction.from(f.broadcasts.at(-1)).nonce,1);tx.close();
}));
test('an orphaned receipt does not mark an operation confirmed or create another nonce',()=>temp(async dir=>{
  const f=signingFixture();f.set({failBroadcast:false});const tx=new KeeperTransactions(join(dir,'tx.sqlite'),f.options);
  const sent=await tx.send('settle:1',{to:arena,data:'0x1234'});f.receipts.set(sent.hash,{status:1,blockNumber:8,blockHash:'orphan'});
  assert.equal((await tx.recover()).phase,'pending');assert.equal(f.broadcasts[0],f.broadcasts[1]);assert.ok(tx.pending());tx.close();
}));
test('concurrent journal users cannot broadcast two distinct operations at one nonce',()=>temp(async dir=>{
  const f=signingFixture();f.set({failBroadcast:false});const path=join(dir,'tx.sqlite'),a=new KeeperTransactions(path,f.options),b=new KeeperTransactions(path,f.options);
  const result=await Promise.allSettled([a.send('one',{to:arena,data:'0x1234'}),b.send('two',{to:arena,data:'0xabcd'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.broadcasts.length,1);assert.ok(a.pending());a.close();b.close();
}));
test('stuck transactions replace fees at the same nonce and payload; any variant can confirm',()=>temp(async dir=>{
  const f=signingFixture();f.set({failBroadcast:false});const tx=new KeeperTransactions(join(dir,'tx.sqlite'),f.options);
  await tx.send('settle:1',{to:arena,data:'0x1234'});const original=Transaction.from(f.broadcasts[0]);f.set({clock:1200});
  await tx.recover();const replacement=Transaction.from(f.broadcasts.at(-1));assert.equal(replacement.nonce,original.nonce);assert.equal(replacement.data,original.data);assert.ok(replacement.maxFeePerGas>original.maxFeePerGas);
  f.receipts.set(original.hash,{status:1,blockNumber:8,blockHash:'canonical'});assert.equal((await tx.recover()).phase,'confirmed');tx.close();
}));
test('fee cap, external nonce and destination restrictions stop further signing',()=>temp(async dir=>{
  const f=signingFixture();f.set({failBroadcast:false});const tx=new KeeperTransactions(join(dir,'tx.sqlite'),{...f.options,maxFeePerGas:110n});
  await assert.rejects(tx.send('bad',{to:account,data:'0x'}),/zero-value arena/);await assert.rejects(tx.send('bad',{to:arena,value:1,data:'0x'}),/zero-value arena/);
  await tx.send('settle:1',{to:arena,data:'0x1234'});f.set({clock:1200});assert.equal((await tx.recover()).phase,'fee-cap');assert.equal(f.broadcasts.length,1);
  f.set({nonce:1});await assert.rejects(tx.recover(),/unknown transaction/);assert.ok(tx.pending());tx.close();
}));
test('one thousand malformed entries are processed in bounded fair batches; another match still settles',()=>temp(async dir=>{
  const index=new ChainIndex(join(dir,'index.sqlite'),{chainId:143,arena,fromBlock:1}),clock=1000000;
  for(let id=1;id<=2;id++)index.apply({name:'RoundStarted',args:{id,unlockAt:1}},1);
  for(let n=0;n<1000;n++)index.apply({name:'VoteCommitted',args:{id:1,account,betNonce:n,sealedChoice:hexlify(toUtf8Bytes('invalid'))}},1);
  index.sync=async()=>({backlogBlocks:0});let sends=0;
  const settle=()=>{};settle.staticCall=async()=>{};settle.populateTransaction=async()=>({to:arena,data:'0x1234'});
  const a={revealer:async()=>account,interruptedThroughRound:async()=>0n,getAddress:async()=>arena,getRound:async id=>({settled:false,unlockAt:0,revealEndsAt:id===1?2000:999,committedCount:1000n,revealedCount:0n,beaconRound:1,nftA:1,nftB:2}),bets:async()=>({revealed:false,amount:1,commitment:hash}),settle};
  const options={arena:a,provider:{getBlock:async()=>({timestamp:1000})},index,transactions:{recover:async()=>({phase:'idle'}),pending:()=>false,send:async()=>{sends++;return {phase:'pending'};}},expectedRevealer:account,chainId:143,now:()=>clock};
  const first=await keeperCycle({...options,maxRounds:1,maxEntries:10});assert.equal(first.processed,10);assert.equal(sends,0);
  const second=await keeperCycle(options);assert.equal(second.phase,'pending');assert.equal(sends,1);
  assert.equal(index.db.prepare('SELECT count(*) AS n FROM ballots WHERE last_attempt>0').get().n,10);index.close();
}));
