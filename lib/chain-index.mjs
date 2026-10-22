// Persistent public event index. One database per process/service, never shared with demo state.
import {DatabaseSync} from 'node:sqlite';
import {getAddress,Interface} from 'ethers';
const nftEvents=new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export function publicChainRound(id,r,cutoff=0){
  return {id,nftA:Number(r.nftA),nftB:Number(r.nftB),endsAt:Number(r.endsAt)*1000,unlockAt:Number(r.unlockAt)*1000,revealEndsAt:Number(r.revealEndsAt)*1000,beaconRound:Number(r.beaconRound),committedCount:Number(r.committedCount),revealedCount:Number(r.revealedCount),totalCommitted:String(r.totalCommitted),protocolVersion:r.participantA?8:7,...(r.participantA?{participantA:r.participantA,participantB:r.participantB}:{}),interrupted:!r.settled && id<=cutoff,votesA:Number(r.votesA),votesB:Number(r.votesB),poolA:String(r.poolA),poolB:String(r.poolB),settled:r.settled,winner:Number(r.winner),refund:r.refund,cancelled:r.cancelled};
}
export class ChainIndex{
  constructor(path,{chainId,arena,fromBlock,collection}){
    if(!Number.isSafeInteger(fromBlock)||fromBlock<0)throw Error('Nonnegative deployment block required');
    this.address=getAddress(arena);this.collection=collection?getAddress(collection):null;this.fromBlock=fromBlock;this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY,unlock_at INTEGER NOT NULL,settled INTEGER NOT NULL DEFAULT 0,dirty_block INTEGER NOT NULL,snapshot_block INTEGER NOT NULL DEFAULT -1,snapshot TEXT,last_work INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS challenges(id INTEGER PRIMARY KEY,creator TEXT NOT NULL,token_id INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0,valid INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS ballots(key TEXT PRIMARY KEY,round_id INTEGER NOT NULL,account TEXT NOT NULL,kind TEXT NOT NULL,number TEXT NOT NULL,ciphertext TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ballot_queue ON ballots(round_id,done,next_attempt,last_attempt);
      CREATE INDEX IF NOT EXISTS ballot_wallet ON ballots(account,kind,round_id);
      CREATE INDEX IF NOT EXISTS round_queue ON rounds(settled,unlock_at,last_work);`);
    const scope=json({chainId,arena:this.address,fromBlock,collection:this.collection}),saved=this.get('scope');
    if(saved && saved!==scope){this.close();throw Error('Index belongs to another chain, arena or deployment block');}
    this.set('scope',scope);
  }
  get(key){return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,String(value));}
  get cursor(){return Number(this.get('cursor') ?? this.fromBlock-1);}
  close(){this.db.close();}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  reset(){this.transaction(()=>{for(const table of ['rounds','challenges','ballots'])this.db.exec('DELETE FROM '+table);this.db.prepare("DELETE FROM meta WHERE key IN ('cursor','hash')").run();});}
  // Every range commits its events and cursor together. A failed fetch never advances it.
  async sync({provider,arena,maxRanges=20,confirmations=3}){
    if(this.inFlight)return this.inFlight;
    if(!Number.isSafeInteger(maxRanges)||maxRanges<1||maxRanges>100)throw Error('Index range budget must be 1..100');
    if(!Number.isSafeInteger(confirmations)||confirmations<0||confirmations>100)throw Error('Invalid confirmations');
    this.inFlight=(async()=>{
      const head=await provider.getBlock('latest');if(!head)throw Error('Missing chain head');
      const target=Math.max(this.fromBlock-1,head.number-confirmations);let reset=false,ranges=0,span=Number(this.get('span')||100);
      if(this.cursor>=this.fromBlock){const checkpoint=await provider.getBlock(this.cursor);if(!checkpoint)throw Error('Missing index checkpoint');if(checkpoint.hash!==this.get('hash') || this.cursor>target){this.reset();reset=true;}}
      while(this.cursor<target && ranges<maxRanges){
        const from=this.cursor+1,to=Math.min(target,from+span-1),before=await provider.getBlock(to);
        if(!before)throw Error('Missing range block');
        let logs;ranges++;
        try{
          logs=await provider.getLogs({address:this.address,fromBlock:from,toBlock:to});
          if(this.collection)logs.push(...await provider.getLogs({address:this.collection,topics:[nftEvents.getEvent('Transfer').topicHash],fromBlock:from,toBlock:to}));
          if(logs.length>5000)throw Error('Index range exceeds event capacity');
        }catch(error){if(span===1)throw error;span=Math.max(1,Math.floor(span/2));continue;}
        const after=await provider.getBlock(to);if(!after || before.hash!==after.hash)throw Error('Chain changed during index fetch');
        const parsed=logs.map(log=>({log,event:(this.collection && log.address.toLowerCase()===this.collection.toLowerCase()?nftEvents:arena.interface).parseLog(log)})).filter(x=>x.event).sort((a,b)=>a.log.blockNumber-b.log.blockNumber || a.log.index-b.log.index);
        this.transaction(()=>{
          // Another local index writer must not commit a stale overlapping range.
          if(this.cursor!==from-1)throw Error('Concurrent index writer');
          for(const {log,event}of parsed)this.apply(event,log.blockNumber);
          this.set('cursor',to);this.set('hash',after.hash);this.set('span',span);
        });if(logs.length<500)span=Math.min(100,span*2);
      }
      return {indexedBlock:this.cursor,headBlock:head.number,targetBlock:target,backlogBlocks:Math.max(0,target-this.cursor),ranges,reorgReset:reset};
    })().finally(()=>{this.inFlight=null;});return this.inFlight;
  }
  apply({name,args:a},block){
    if(name==='Transfer'){this.db.prepare('UPDATE challenges SET valid=(lower(creator)=lower(?)) WHERE token_id=? AND closed=0').run(a.to,Number(a.tokenId));return;}
    const id=Number(a.id);
    if(name==='RoundStarted')this.db.prepare('INSERT INTO rounds(id,unlock_at,dirty_block) VALUES(?,?,?)').run(id,Number(a.unlockAt),block);
    if(name==='RoundSettled'){
      this.db.prepare('UPDATE rounds SET settled=1,dirty_block=? WHERE id=?').run(block,id);
      // Keep wallet/round lookup, discard no-longer-needed ciphertext payloads.
      this.db.prepare("UPDATE ballots SET done=1,ciphertext='0x' WHERE round_id=?").run(id);
    }
    if(['VoteCommitted','HolderVotesCommitted','VoteRevealed','HolderVotesRevealed'].includes(name))this.db.prepare('UPDATE rounds SET dirty_block=? WHERE id=?').run(block,id);
    if(name==='ChallengeCreated')this.db.prepare('INSERT INTO challenges(id,creator,token_id) VALUES(?,?,?)').run(id,getAddress(a.creator),Number(a.tokenId));
    if(name==='ChallengeAccepted'||name==='ChallengeCancelled')this.db.prepare('UPDATE challenges SET closed=1 WHERE id=?').run(id);
    if(name==='VoteCommitted'||name==='HolderVotesCommitted'){
      const holder=name==='HolderVotesCommitted',number=String(holder?a.holderKey:a.betNonce),account=getAddress(a.account),kind=holder?'holder':'bet';
      const key=[id,kind,holder?number:account.toLowerCase()+':'+number].join(':');
      this.db.prepare('INSERT INTO ballots(key,round_id,account,kind,number,ciphertext) VALUES(?,?,?,?,?,?)').run(key,id,account,kind,number,a.sealedChoice);
    }
    if(name==='VoteRevealed')this.db.prepare("UPDATE ballots SET done=1 WHERE round_id=? AND kind='bet' AND account=? AND number=?").run(id,getAddress(a.account),String(a.betNonce));
    if(name==='HolderVotesRevealed')this.db.prepare("UPDATE ballots SET done=1 WHERE round_id=? AND kind='holder' AND number=?").run(id,String(a.holderKey));
  }
  ready(now,cutoff,limit=5){return this.db.prepare('SELECT id FROM rounds WHERE settled=0 AND (unlock_at<=? OR id<=?) ORDER BY last_work,id LIMIT ?').all(now,cutoff,limit).map(r=>r.id);}
  touch(id,now){this.db.prepare('UPDATE rounds SET last_work=? WHERE id=?').run(now,id);}
  ballots(id,now,limit=10){return this.db.prepare('SELECT * FROM ballots WHERE round_id=? AND done=0 AND next_attempt<=? ORDER BY last_attempt,key LIMIT ?').all(id,now,limit);}
  attempted(key,now,done=false){this.db.prepare('UPDATE ballots SET done=?,last_attempt=?,next_attempt=? WHERE key=?').run(done?1:0,now,now+30,key);}
  async snapshots(arena,limit=20){
    const block=this.cursor;if(block<this.fromBlock)return;
    const rows=this.db.prepare('SELECT id FROM rounds WHERE snapshot_block<dirty_block ORDER BY snapshot_block,id LIMIT ?').all(limit);
    for(const {id}of rows){const r=publicChainRound(id,await arena.getRound(id,{blockTag:block}));this.db.prepare('UPDATE rounds SET snapshot=?,snapshot_block=? WHERE id=?').run(json(r),block,id);}
  }
  view(cutoff=0){
    const incomplete=this.db.prepare('SELECT count(*) AS n FROM rounds WHERE snapshot_block<dirty_block').get().n;
    const rounds=[],history=[],points={},losses={},draws={};
    for(const row of this.db.prepare('SELECT snapshot FROM rounds WHERE snapshot IS NOT NULL ORDER BY id').iterate()){
      const r=JSON.parse(row.snapshot);r.interrupted=!r.settled&&r.id<=cutoff;
      if(!r.settled){rounds.push(r);continue;}history.push(r);if(r.cancelled)continue;
      if(r.winner===2){if(r.votesA+r.votesB>1)for(const id of [r.nftA,r.nftB])draws[id]=(draws[id]||0)+1;}
      else{const win=r.winner===0?r.nftA:r.nftB,lose=r.winner===0?r.nftB:r.nftA;points[win]=(points[win]||0)+1;losses[lose]=(losses[lose]||0)+1;}
    }
    const challenges=this.db.prepare('SELECT id,creator,token_id,valid FROM challenges WHERE closed=0 ORDER BY id').all().map(c=>({id:c.id,creator:c.creator,tokenId:c.token_id,closed:false,valid:Boolean(c.valid)}));
    return {rounds,history,challenges,points,losses,draws,incompleteSnapshots:incomplete};
  }
  walletRounds(account,before=Number.MAX_SAFE_INTEGER,limit=50){return this.db.prepare("SELECT DISTINCT b.round_id AS id FROM ballots b JOIN rounds r ON r.id=b.round_id WHERE b.account=? AND b.kind='bet' AND r.settled=1 AND b.round_id<? ORDER BY b.round_id DESC LIMIT ?").all(getAddress(account),before,limit).map(r=>r.id);}
}
