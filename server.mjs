import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Contract,JsonRpcProvider,FetchRequest,parseUnits} from 'ethers';
import {COLLECTION,CHOG_TOKEN,CHAIN_ID,RPC_URL,FEE_BPS,MIN_STAKE} from './lib/config.mjs';
import * as demo from './lib/demo.mjs';
import {openBallot,drandClient} from './lib/timelock.mjs';
import {DEMO_ARENA} from './lib/commitments.mjs';
import {drawTotals} from './lib/leaderboard.mjs';
import {RELEASE_STATUS,assertLiveReleaseAllowed} from './lib/release.mjs';
import {createLiveCache} from './lib/live-cache.mjs';
const arenaAddress=process.env.ARENA_CONTRACT_ADDRESS || '';
assertLiveReleaseAllowed(arenaAddress);
const root=import.meta.dirname;
const stateDir=process.env.ARENA_STATE_DIR || resolve(root,'data');
await mkdir(stateDir,{recursive:true});
const db=new DatabaseSync(resolve(stateDir,'arena.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
let state=JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get()?.value || JSON.stringify(demo.createState()));
const save=()=>db.prepare('INSERT OR REPLACE INTO state VALUES (1,?)').run(JSON.stringify(state));
let nfts=[];
try{nfts=JSON.parse(await readFile(resolve(root,'data/collection.json'),'utf8')).nfts;}catch{}
// Retain old demo history/claims, but retire automatically generated unfinished pairs.
if(!state.matchmakingVersion){for(const r of state.rounds)if(!r.settled)Object.assign(r,{settled:true,cancelled:true,refund:true,winner:2,feeOnClaim:true,feeBps:FEE_BPS});state.challenges=[];state.ownership={};state.matchmakingVersion=1;save();}
if(!state.losses){state.losses={};for(const r of state.rounds)if(r.settled && !r.cancelled && [0,1].includes(r.winner)){const loser=r.winner===0?r.nftB:r.nftA;state.losses[loser]=(state.losses[loser] || 0)+1;}save();}
if(!state.draws){state.draws=drawTotals(state.rounds);save();}
if(demo.migrateMinimumStake(state))save();
const artifact=JSON.parse(await readFile(resolve(root,'artifacts/BeautyArena.json'),'utf8'));
const live=Boolean(arenaAddress);
const demoFastRounds=!live && process.env.DEMO_FAST_ROUNDS!=='0';
const rpcConnection=new FetchRequest(RPC_URL);rpcConnection.timeout=15000;
const provider=live?new JsonRpcProvider(rpcConnection,CHAIN_ID,{batchMaxCount:1}):null;
const arena=live?new Contract(arenaAddress,artifact.abi,provider):null;
const treasury='0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D';
const port=Number(process.env.PORT || 3000);
function publicRound(r){if(!r)return null;const {entries,...rest}=r;return rest;}
const readLive=createLiveCache(async()=>{
  const current=Number(await arena.currentRoundId());
  const history=[],rounds=[],challenges=[];const points={},losses={};
  for(let id=1;id<=current;id++) {
    const r=await arena.getRound(id);
    const item={id,nftA:Number(r.nftA),nftB:Number(r.nftB),endsAt:Number(r.endsAt)*1000,unlockAt:Number(r.unlockAt)*1000,revealEndsAt:Number(r.revealEndsAt)*1000,beaconRound:Number(r.beaconRound),committedCount:Number(r.committedCount),revealedCount:Number(r.revealedCount),totalCommitted:r.totalCommitted.toString(),protocolVersion:3,votesA:Number(r.votesA),votesB:Number(r.votesB),poolA:r.poolA.toString(),poolB:r.poolB.toString(),settled:r.settled,winner:Number(r.winner),refund:r.refund,cancelled:r.cancelled};
    if(item.settled){history.push(item);if(!item.cancelled && item.winner!==2){const token=item.winner===0?item.nftA:item.nftB,loser=item.winner===0?item.nftB:item.nftA;points[token]=(points[token] || 0)+1;losses[loser]=(losses[loser] || 0)+1;}}
    if(!item.settled)rounds.push(item);
  }
  const count=Number(await arena.challengeCount());
  const collection=new Contract(COLLECTION,['function ownerOf(uint256) view returns(address)'],provider);
  for(let id=1;id<=count;id++){const c=await arena.challenges(id);if(c.closed)continue;let valid=false;try{valid=(await collection.ownerOf(c.tokenId)).toLowerCase()===c.creator.toLowerCase();}catch{}
    challenges.push({id,creator:c.creator,tokenId:Number(c.tokenId),createdAt:Number(c.createdAt)*1000,roundId:Number(c.roundId),closed:false,valid});}
  return {rounds,challenges,history,points,losses,draws:drawTotals(history)};
});
const demoDrand=drandClient();let tickInFlight;
function tick(){
  if(tickInFlight)return tickInFlight;
  tickInFlight=(async()=>{
    for(const r of state.rounds){const now=Date.now();
    if(!r.settled && now>=(r.unlockAt || r.endsAt)){
      if(r.revealEndsAt && now<r.revealEndsAt){
        for(const [id,e]of Object.entries(r.entries))if(!e.revealed){
          try{const ballot=await openBallot(e.sealedChoice,{arena:DEMO_ARENA,chainId:CHAIN_ID,roundId:r.id,account:demo.user(state,id).address,amount:e.amount,commitment:e.commitment,beaconRound:r.beaconRound,nftA:r.nftA,nftB:r.nftB},r.unlockAt,demoDrand);demo.revealVote(state,id,ballot);}
          catch{r.keeperStatus='Waiting for verified automatic opening';}
        }
      }
      if(!r.revealEndsAt || r.revealedCount===r.committedCount || Date.now()>=r.revealEndsAt)demo.settle(state,r);
    }
    }
    save();
  })().finally(()=>{tickInFlight=null;});return tickInFlight;
}
const keeperTimer=live?null:setInterval(()=>tick().catch(()=>{}),5000);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer({headersTimeout:10000,requestTimeout:15000,connectionsCheckingInterval:1000,maxHeaderSize:16384},async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) {
      if(req.method==='POST' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Invalid origin'});
      let id=req.headers.cookie?.match(/(?:^|; )arena_demo=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if(!id){id=randomUUID();res.setHeader('set-cookie',`arena_demo=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);}
      const persona=req.headers.cookie?.match(/(?:^|; )arena_persona=(alice|bob|visitor)(?:;|$)/)?.[1] || 'alice';
      if(!live){
        if(!state.demoAccounts){state.demoAccounts={alice:id,bob:id+':bob',visitor:id+':visitor'};nfts.forEach((n,i)=>state.ownership[n.tokenId]=demo.user(state,state.demoAccounts[i%2?'bob':'alice']).address);save();}
        id=state.demoAccounts[persona];demo.user(state,id).holder=demo.ownedTokens(state,id).length>0;
      }
      if(!live)await tick();
      if(req.method==='GET' && url.pathname==='/api/config')return json(res,200,{mode:live?'live':'demo',release:RELEASE_STATUS,collection:COLLECTION,token:CHOG_TOKEN,chainId:CHAIN_ID,treasury,arenaAddress,feeBps:FEE_BPS,minStake:MIN_STAKE.toString(),nfts,abi:artifact.abi,demoFastRounds,privacy:'timelock'});
      if(req.method==='GET' && url.pathname==='/api/deployment')return RELEASE_STATUS.realFundsEnabled?json(res,200,artifact):json(res,403,{error:RELEASE_STATUS.message});
      if(req.method==='GET' && url.pathname==='/api/state') {
        const data=live?await readLive(url.searchParams.get('fresh')==='1'):{rounds:state.rounds.filter(r=>!r.settled).map(publicRound),challenges:state.challenges.filter(c=>!c.closed).map(c=>({...c,valid:state.ownership[c.tokenId]===c.creator})),history:state.rounds.filter(r=>r.settled).map(publicRound),points:state.points,losses:state.losses,draws:state.draws};
        const selected=Number(url.searchParams.get('round'));
        const round=url.searchParams.get('round')?[...data.rounds,...data.history].find(r=>r.id===selected) || null:data.rounds.at(-1) || null;
        const account=live?null:demo.user(state,id);
        const claims=live?[]:state.rounds.filter(r=>demo.payout(r,id)>0n).map(r=>{const p=demo.payoutBreakdown(r,id);return {id:r.id,gross:p.gross.toString(),fee:p.fee.toString(),amount:p.amount.toString()};});
        return json(res,200,{...data,round,account,claims,persona,ownedTokens:live?[]:demo.ownedTokens(state,id),entry:live?null:state.rounds.find(r=>r.id===round?.id)?.entries[id] || null,serverNow:Date.now()});
      }
      if(req.method==='POST'){
        if(live)return json(res,405,{error:'Live transactions must be signed in your wallet'});
        let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw new Error('Request too large');text+=chunk;}
        const body=JSON.parse(text || '{}');
        if(!body || typeof body!=='object' || Array.isArray(body))throw Error('Expected a JSON object');
        if(url.pathname==='/api/commit'){
          if('side' in body || 'salt' in body)throw Error('Plaintext choices must never be sent to this endpoint');
          if(!Number.isSafeInteger(body.roundId))throw Error('Select a round');
          demo.commitVote(state,id,{roundId:body.roundId,commitment:body.commitment,sealedChoice:body.sealedChoice,amount:parseUnits(String(body.amount || '0'),18)});
        }
        else if(url.pathname==='/api/challenges/create')demo.createChallenge(state,id,body.tokenId);
        else if(url.pathname==='/api/challenges/cancel')demo.cancelChallenge(state,id,body.id);
        else if(url.pathname==='/api/challenges/accept')demo.acceptChallenge(state,id,body.id,body.tokenId,Date.now(),demoFastRounds);
        else if(url.pathname==='/api/claim')demo.claim(state,state.rounds.find(r=>r.id===body.id) || {},id);
        else if(url.pathname==='/api/demo/wallet'){
          if(!['alice','bob','visitor'].includes(body.persona))throw Error('Unknown demo wallet');
          res.setHeader('set-cookie',`arena_persona=${body.persona}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
        }
        else return json(res,404,{error:'Unknown endpoint'});
        save();return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Unknown endpoint'});
    }
    const publicRoot=resolve(root,'public');
    const pathname=['/','/profile','/leaderboard','/setup'].includes(url.pathname)?'/index.html':decodeURIComponent(url.pathname);
    const file=resolve(publicRoot,'.'+pathname);
    if(!file.startsWith(publicRoot+sep))return json(res,403,{error:'Forbidden'});
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':mime[extname(file)] || 'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://rpc.monad.xyz; frame-ancestors 'none'"});
    res.end(bytes);
  }catch(error){json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'File not found':error.shortMessage || error.message});}
});
server.maxHeadersCount=100;server.maxRequestsPerSocket=100;
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Chog: Beauty Arena — http://localhost:${server.address().port} (${live?'LIVE':'DEMO'})`));
function shutdown(){if(keeperTimer)clearInterval(keeperTimer);server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
