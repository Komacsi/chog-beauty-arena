// Persist the signed bytes BEFORE broadcast. Never expose this database through HTTP.
import {DatabaseSync} from 'node:sqlite';
import {Transaction,getAddress,keccak256} from 'ethers';
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export class KeeperTransactions{
  constructor(path,{provider,signer,arena,chainId,confirmations=3,maxGas=2000000n,maxFeePerGas=1000000000000n,replacementMs=120000,now=Date.now}){
    Object.assign(this,{provider,signer,arena:getAddress(arena),chainId,confirmations,maxGas,maxFeePerGas,replacementMs,now});
    this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS scope(value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,operation TEXT NOT NULL,nonce INTEGER NOT NULL,status TEXT NOT NULL,request TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON transactions(status) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS variants(hash TEXT PRIMARY KEY,transaction_id INTEGER NOT NULL,raw TEXT NOT NULL);`);
    const scope=encode({arena:this.arena,chainId,signer:getAddress(signer.address)}),saved=this.db.prepare('SELECT value FROM scope').get()?.value;
    if(saved&&saved!==scope){this.close();throw Error('Transaction journal belongs to another signer, arena or chain');}
    if(!saved)this.db.prepare('INSERT INTO scope VALUES(?)').run(scope);
  }
  close(){this.db.close();}
  pending(){return this.db.prepare("SELECT * FROM transactions WHERE status='pending'").get();}
  async send(operation,request){
    if(this.pending())return {phase:'pending'};
    if(getAddress(request.to)!==this.arena || BigInt(request.value||0)!==0n)throw Error('Keeper only sends zero-value arena calls');
    const [latest,pending]=await Promise.all([this.provider.getTransactionCount(this.signer.address,'latest'),this.provider.getTransactionCount(this.signer.address,'pending')]);
    if(latest!==pending)throw Error('External pending keeper nonce; reconcile before sending');
    const tx=await this.signer.populateTransaction({...request,value:0,nonce:latest,chainId:this.chainId});
    if(BigInt(tx.gasLimit)>this.maxGas || BigInt(tx.maxFeePerGas??tx.gasPrice)>this.maxFeePerGas)throw Error('Keeper gas or fee cap exceeded');
    const raw=await this.signer.signTransaction(tx),hash=keccak256(raw),now=this.now();
    this.db.exec('BEGIN IMMEDIATE');try{
      const r=this.db.prepare("INSERT INTO transactions(operation,nonce,status,request,created,updated) VALUES(?,?,'pending',?,?,?)").run(operation,latest,encode(tx),now,now);
      this.db.prepare('INSERT INTO variants VALUES(?,?,?)').run(hash,r.lastInsertRowid,raw);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    // Even a network exception leaves durable signed bytes available for recovery.
    await this.provider.broadcastTransaction(raw);return {phase:'pending',hash};
  }
  async recover(){
    const p=this.pending();if(!p)return {phase:'idle'};
    const variants=this.db.prepare('SELECT hash,raw FROM variants WHERE transaction_id=? ORDER BY rowid').all(p.id);
    for(const {hash}of variants){
      const receipt=await this.provider.getTransactionReceipt(hash);if(!receipt)continue;
      const [head,block]=await Promise.all([this.provider.getBlockNumber(),this.provider.getBlock(receipt.blockNumber)]);
      if(!block || block.hash!==receipt.blockHash)continue;
      if(head-receipt.blockNumber+1<this.confirmations)return {phase:'confirming',hash};
      const status=Number(receipt.status)===1?'confirmed':'reverted';this.db.prepare('UPDATE transactions SET status=?,updated=? WHERE id=?').run(status,this.now(),p.id);return {phase:status,hash,operation:p.operation};
    }
    if(await this.provider.getTransactionCount(this.signer.address,'latest')>p.nonce)throw Error('Keeper nonce consumed by an unknown transaction; operator reconciliation required');
    let raw=variants.at(-1).raw;
    if(this.now()-p.updated>=this.replacementMs){
      const old=Transaction.from(raw),fees=await this.provider.getFeeData();
      const bump=v=>(BigInt(v)*125n+99n)/100n;
      const request=JSON.parse(p.request);delete request.from;
      if(old.type===2){request.maxPriorityFeePerGas=bump(old.maxPriorityFeePerGas||1n);request.maxFeePerGas=[bump(old.maxFeePerGas),fees.maxFeePerGas||0n,request.maxPriorityFeePerGas].reduce((a,b)=>a>b?a:b);}
      else request.gasPrice=[bump(old.gasPrice),fees.gasPrice||0n].reduce((a,b)=>a>b?a:b);
      if(BigInt(request.maxFeePerGas??request.gasPrice)>this.maxFeePerGas)return {phase:'fee-cap',nonce:p.nonce};
      raw=await this.signer.signTransaction(request);const hash=keccak256(raw);
      this.db.exec('BEGIN IMMEDIATE');try{
        const changed=this.db.prepare("UPDATE transactions SET updated=? WHERE id=? AND status='pending' AND updated=?").run(this.now(),p.id,p.updated).changes;
        if(!changed)throw Error('Concurrent transaction recovery');
        this.db.prepare('INSERT INTO variants VALUES(?,?,?)').run(hash,p.id,raw);this.db.exec('COMMIT');
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    }
    try{await this.provider.broadcastTransaction(raw);}catch(error){
      const message=String(error.info?.error?.message || error.shortMessage || error.message);
      if(!['ALREADY_KNOWN','NONCE_EXPIRED','REPLACEMENT_UNDERPRICED'].includes(error.code) && !/already known|known transaction|nonce too low|replacement transaction underpriced/i.test(message))throw error;
    }
    return {phase:'pending',hash:keccak256(raw),ageMs:this.now()-p.created};
  }
}
