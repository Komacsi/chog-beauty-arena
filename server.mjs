import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Contract,JsonRpcProvider,parseUnits} from 'ethers';
import {COLLECTION,CHOG_TOKEN,CHAIN_ID,RPC_URL,FEE_BPS} from './lib/config.mjs';
import * as demo from './lib/demo.mjs';
import {openBallot,drandClient} from './lib/timelock.mjs';
import {DEMO_ARENA} from './lib/commitments.mjs';
const root=import.meta.dirname;
const stateDir=process.env.ARENA_STATE_DIR || resolve(root,'data');
await mkdir(stateDir,{recursive:true});
const db=new DatabaseSync(resolve(stateDir,'arena.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
let state=JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get()?.value || JSON.stringify(demo.createState()));
const save=()=>db.prepare('INSERT OR REPLACE INTO state VALUES (1,?)').run(JSON.stringify(state));
let nfts=[];
try{nfts=JSON.parse(await readFile(resolve(root,'data/collection.json'),'utf8')).nfts;}catch{}
const artifact=JSON.parse(await readFile(resolve(root,'artifacts/BeautyArena.json'),'utf8'));
const arenaAddress=process.env.ARENA_CONTRACT_ADDRESS || '';
const live=Boolean(arenaAddress);
const demoFastRounds=!live && process.env.DEMO_FAST_ROUNDS==='1';
const provider=live?new JsonRpcProvider(RPC_URL,CHAIN_ID,{batchMaxCount:1}):null;
const arena=live?new Contract(arenaAddress,artifact.abi,provider):null;
const treasury='0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D';
const port=Number(process.env.PORT || 3000);
function publicRound(r){if(!r)return null;const {entries,...rest}=r;return rest;}
let liveCache={at:0,round:null,history:[],points:{}};
async function readLive(){
  if(Date.now()-liveCache.at<10000)return liveCache;
  const current=Number(await arena.currentRoundId());
  const history=[];const points={};let round=null;
  for(let id=1;id<=current;id++) {
    const r=await arena.getRound(id);
    const item={id,nftA:Number(r.nftA),nftB:Number(r.nftB),endsAt:Number(r.endsAt)*1000,unlockAt:Number(r.unlockAt)*1000,revealEndsAt:Number(r.revealEndsAt)*1000,beaconRound:Number(r.beaconRound),committedCount:Number(r.committedCount),revealedCount:Number(r.revealedCount),totalCommitted:r.totalCommitted.toString(),protocolVersion:3,votesA:Number(r.votesA),votesB:Number(r.votesB),poolA:r.poolA.toString(),poolB:r.poolB.toString(),settled:r.settled,winner:Number(r.winner),refund:r.refund,cancelled:r.cancelled};
    if(item.settled){history.push(item);if(item.winner!==2){const token=item.winner===0?item.nftA:item.nftB;points[token]=(points[token] || 0)+1;}}
    if(id===current)round=item;
  }
  liveCache={at:Date.now(),round,history,points}; return liveCache;
}
const demoDrand=drandClient();let tickInFlight;
function tick(){
  if(tickInFlight)return tickInFlight;
  tickInFlight=(async()=>{
    let r=state.rounds.at(-1);const now=Date.now();
    if(r && !r.settled && now>=(r.unlockAt || r.endsAt)){
      if(r.revealEndsAt && now<r.revealEndsAt){
        for(const [id,e]of Object.entries(r.entries))if(!e.revealed){
          try{const ballot=await openBallot(e.sealedChoice,{arena:DEMO_ARENA,chainId:CHAIN_ID,roundId:r.id,account:demo.user(state,id).address,amount:e.amount,commitment:e.commitment},r.unlockAt,demoDrand);demo.revealVote(state,id,ballot);}
          catch{r.keeperStatus='Waiting for verified automatic opening';}
        }
      }
      if(!r.revealEndsAt || r.revealedCount===r.committedCount || Date.now()>=r.revealEndsAt)demo.settle(state,r);
    }
    if((!r || r.settled) && nfts.length>=2)demo.startRound(state,nfts,Date.now(),demoFastRounds);
    save();
  })().finally(()=>{tickInFlight=null;});return tickInFlight;
}
const keeperTimer=live?null:setInterval(()=>tick().catch(()=>{}),5000);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) {
      if(req.method==='POST' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Invalid origin'});
      let id=req.headers.cookie?.match(/(?:^|; )arena_demo=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if(!id){id=randomUUID();res.setHeader('set-cookie',`arena_demo=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);}
      if(!live)await tick();
      if(req.method==='GET' && url.pathname==='/api/config')return json(res,200,{mode:live?'live':'demo',collection:COLLECTION,token:CHOG_TOKEN,chainId:CHAIN_ID,treasury,arenaAddress,feeBps:FEE_BPS,nfts,abi:artifact.abi,demoFastRounds,privacy:'timelock'});
      if(req.method==='GET' && url.pathname==='/api/deployment')return json(res,200,artifact);
      if(req.method==='GET' && url.pathname==='/api/state') {
        const data=live?await readLive():{round:publicRound(state.rounds.at(-1)),history:state.rounds.filter(r=>r.settled).slice(-30).map(publicRound),points:state.points};
        const account=live?null:demo.user(state,id);
        const claims=live?[]:state.rounds.filter(r=>demo.payout(r,id)>0n).map(r=>{const p=demo.payoutBreakdown(r,id);return {id:r.id,gross:p.gross.toString(),fee:p.fee.toString(),amount:p.amount.toString()};});
        return json(res,200,{...data,account,claims,entry:live?null:state.rounds.at(-1)?.entries[id] || null,serverNow:Date.now()});
      }
      if(req.method==='GET' && url.pathname==='/api/pair') {
        if(nfts.length<2)throw new Error('Import NFTs first');
        const s=demo.createState();const r=demo.startRound(s,nfts);return json(res,200,{a:r.nftA,b:r.nftB});
      }
      if(req.method==='POST'){
        if(live)return json(res,405,{error:'Live transactions must be signed in your wallet'});
        let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw new Error('Request too large');}
        const body=JSON.parse(text || '{}');
        if(url.pathname==='/api/commit'){
          if('side' in body || 'salt' in body)throw Error('Plaintext choices must never be sent to this endpoint');
          demo.commitVote(state,id,{commitment:body.commitment,sealedChoice:body.sealedChoice,amount:parseUnits(String(body.amount || '0'),18)});
        }
        else if(url.pathname==='/api/claim')demo.claim(state,state.rounds.find(r=>r.id===body.id) || {},id);
        else if(url.pathname==='/api/demo/role')demo.user(state,id).holder=Boolean(body.holder);
        else if(url.pathname==='/api/demo/cancel'){
          const r=state.rounds.at(-1);if(!r)throw new Error('No round');Object.assign(r,{settled:true,cancelled:true,refund:true,winner:2,feeOnClaim:true,feeBps:FEE_BPS});await tick();
        }else return json(res,404,{error:'Unknown endpoint'});
        save();return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Unknown endpoint'});
    }
    const publicRoot=resolve(root,'public');
    const pathname=['/','/leaderboard','/setup'].includes(url.pathname)?'/index.html':decodeURIComponent(url.pathname);
    const file=resolve(publicRoot,'.'+pathname);
    if(!file.startsWith(publicRoot+sep))return json(res,403,{error:'Forbidden'});
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':mime[extname(file)] || 'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://rpc.monad.xyz; frame-ancestors 'none'"});
    res.end(bytes);
  }catch(error){json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'File not found':error.shortMessage || error.message});}
});
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Chog: Beauty Arena — http://localhost:${port} (${live?'LIVE':'DEMO'})`));
function shutdown(){if(keeperTimer)clearInterval(keeperTimer);server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
