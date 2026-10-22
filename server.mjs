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
import {validateGovernance} from './lib/governance.mjs';
import {createLiveCache} from './lib/live-cache.mjs';
import {createNftCatalog,validTokenId,catalogGateways} from './lib/nft-catalog.mjs';
import {ChainIndex} from './lib/chain-index.mjs';
import {webOrigins,allowedWebOrigin} from './lib/web-origin.mjs';
import {serviceHealth} from './lib/service-health.mjs';
import {validateLiveStartup} from './lib/live-startup.mjs';
const allowedOrigins=webOrigins(process.env.ARENA_WEB_ORIGINS);
const arenaAddress=process.env.ARENA_CONTRACT_ADDRESS || '';
assertLiveReleaseAllowed(arenaAddress);
const root=import.meta.dirname;
const live=Boolean(arenaAddress);
const rpcConnection=new FetchRequest(RPC_URL);rpcConnection.timeout=15000;
const provider=live?new JsonRpcProvider(rpcConnection,CHAIN_ID,{batchMaxCount:1}):null;
if(live)await validateLiveStartup(provider,arenaAddress,process.env.ARENA_FROM_BLOCK);
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
if(demo.migrateAggregatePayouts(state))save();
const artifact=JSON.parse(await readFile(resolve(root,'artifacts/BeautyArena.json'),'utf8'));
const demoFastRounds=!live && process.env.DEMO_FAST_ROUNDS!=='0';
const arena=live?new Contract(arenaAddress,artifact.abi,provider):null;
let catalogProvider;
const nftCatalog=createNftCatalog({seedNfts:nfts,cacheDir:resolve(stateDir,'nft-cache'),gateways:catalogGateways(process.env.NFT_IPFS_PRIMARY || 'filebase'),readTokenUri:async tokenId=>{
  if(!catalogProvider){const connection=new FetchRequest(RPC_URL);connection.timeout=15000;catalogProvider=new JsonRpcProvider(connection,CHAIN_ID,{batchMaxCount:1});}
  if(Number((await catalogProvider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Wrong NFT network');
  return new Contract(COLLECTION,['function tokenURI(uint256) view returns(string)'],catalogProvider).tokenURI(tokenId);
}});
const treasury='0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D';
const revealerAddress=live?await arena.revealer():process.env.ARENA_REVEALER_ADDRESS || '';
const governanceAddress=live?await arena.owner():process.env.ARENA_GOVERNANCE_ADDRESS || '';
let liveIndex;
if(live){
  const [token,collection,feeRecipient]=await Promise.all([arena.chog(),arena.collection(),arena.treasury()]);
  if(token.toLowerCase()!==CHOG_TOKEN.toLowerCase() || collection.toLowerCase()!==COLLECTION.toLowerCase() || feeRecipient.toLowerCase()!==treasury.toLowerCase())throw Error('Arena assets or treasury do not match this application');
  await validateGovernance(provider,governanceAddress);
  const fromBlock=Number(process.env.ARENA_FROM_BLOCK);
  if(!/^\d+$/.test(process.env.ARENA_FROM_BLOCK || '') || fromBlock<1 || await provider.getCode(arenaAddress,fromBlock-1)!=='0x' || await provider.getCode(arenaAddress,fromBlock)==='0x')throw Error('Set ARENA_FROM_BLOCK to the actual arena deployment block');
  liveIndex=new ChainIndex(resolve(stateDir,'chain-index.sqlite'),{chainId:CHAIN_ID,arena:arenaAddress,fromBlock,collection:COLLECTION});
}
const port=Number(process.env.PORT || 3000);
function publicRound(r){if(!r)return null;const {entries,holderEntries,betCounts,usedNfts,walletBanks,...rest}=r;return rest;}
const readLive=createLiveCache(async()=>{
  const [activeRevealer,governanceAddress,cutoff]=await Promise.all([arena.revealer(),arena.owner(),arena.interruptedThroughRound()]);
  const sync=await liveIndex.sync({provider,arena});
  await liveIndex.snapshots(arena,20);
  const data=liveIndex.view(Number(cutoff));
  if(sync.backlogBlocks || data.incompleteSnapshots)throw Object.assign(Error('Synchronizing confirmed match data. Please retry shortly.'),{code:'INDEX_CATCHUP'});
  return {...data,index:sync,activeRevealer,governanceAddress,serviceSuspended:/^0x0+$/.test(activeRevealer)};
});
const indexTimer=live?setInterval(()=>readLive(true).catch(()=>{}),1000):null;
const demoDrand=drandClient();let tickInFlight;
function tick(){
  if(tickInFlight)return tickInFlight;
  tickInFlight=(async()=>{
    for(const r of state.rounds){const now=Date.now();
    if(!r.settled && now>=(r.unlockAt || r.endsAt)){
      if(r.revealEndsAt && now<r.revealEndsAt){
        for(const [key,e]of Object.entries(r.entries))if(!e.revealed){
          const id=e.userId ?? key;
          try{const ballot=await openBallot(e.sealedChoice,{arena:DEMO_ARENA,chainId:CHAIN_ID,roundId:r.id,account:demo.user(state,id).address,amount:e.amount,commitment:e.commitment,beaconRound:r.beaconRound,nftA:r.nftA,nftB:r.nftB,...(r.protocolVersion>=6?{betNonce:e.betNonce}:{})},r.unlockAt,demoDrand);demo.revealVote(state,id,ballot);}
          catch{r.keeperStatus='Waiting for verified automatic opening';}
        }
        for(const e of Object.values(r.holderEntries || {}))if(!e.revealed){
          try{const ballot=await openBallot(e.sealedChoice,{arena:DEMO_ARENA,chainId:CHAIN_ID,roundId:r.id,account:e.account,amount:'0',holderKey:e.holderKey,holderTokenIdsHash:e.tokenIdsHash,commitment:e.commitment,beaconRound:r.beaconRound,nftA:r.nftA,nftB:r.nftB},r.unlockAt,demoDrand);demo.revealHolderVotes(state,e.userId,ballot);}
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
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer({headersTimeout:10000,requestTimeout:15000,connectionsCheckingInterval:1000,maxHeaderSize:16384},async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/api/health'){
      const health=await serviceHealth({live,healthPath:process.env.KEEPER_HEALTH_PATH || '/run/chog-keeper-health/status.json'});
      return json(res,health.status,health.body);
    }
    const nftRoute=url.pathname.match(/^\/api\/nfts\/(\d+)(\/image)?$/);
    if(nftRoute && req.method==='GET'){
      const tokenId=Number(nftRoute[1]);if(!validTokenId(tokenId))return json(res,400,{error:'Invalid Chog NFT'});
      try{
        if(!nftRoute[2])return json(res,200,await nftCatalog.getMetadata(tokenId));
        const asset=await nftCatalog.getImage(tokenId);
        if(asset.redirect){res.writeHead(302,{location:asset.redirect});res.end();return;}
        res.writeHead(200,{'content-type':asset.type,'content-length':asset.bytes.length,'cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});res.end(asset.bytes);return;
      }catch{return json(res,503,{error:'NFT details temporarily unavailable. Please retry.'});}
    }
    if(url.pathname.startsWith('/api/')) {
      if(req.method==='POST' && !allowedWebOrigin(req.headers.origin,req.headers.host,allowedOrigins))return json(res,403,{error:'Invalid origin'});
      let id=req.headers.cookie?.match(/(?:^|; )arena_demo=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if(!id){id=randomUUID();res.setHeader('set-cookie',`arena_demo=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);}
      const persona=req.headers.cookie?.match(/(?:^|; )arena_persona=(alice|bob|visitor)(?:;|$)/)?.[1] || 'alice';
      if(!live){
        if(!state.demoAccounts){state.demoAccounts={alice:id,bob:id+':bob',visitor:id+':visitor'};nfts.forEach((n,i)=>state.ownership[n.tokenId]=demo.user(state,state.demoAccounts[i%2?'bob':'alice']).address);save();}
        id=state.demoAccounts[persona];demo.user(state,id).holder=demo.ownedTokens(state,id).length>0;
      }
      if(!live)await tick();
      if(req.method==='GET' && url.pathname==='/api/config')return json(res,200,{mode:live?'live':'demo',release:{...RELEASE_STATUS,realFundsEnabled:live&&RELEASE_STATUS.realFundsEnabled},collection:COLLECTION,token:CHOG_TOKEN,chainId:CHAIN_ID,treasury,revealerAddress,governanceAddress,arenaAddress,feeBps:FEE_BPS,minStake:MIN_STAKE.toString(),nfts,abi:artifact.abi,demoFastRounds,privacy:'timelock'});
      if(req.method==='GET' && url.pathname==='/api/deployment')return json(res,403,{error:'Use the existing reviewed arena. Public contract deployment is disabled.'});
      if(live && req.method==='GET' && url.pathname==='/api/wallet-rounds'){
        await readLive();const before=Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        if(!Number.isSafeInteger(before)||before<1)return json(res,400,{error:'Invalid history cursor'});
        const ids=liveIndex.walletRounds(url.searchParams.get('account'),before,51);
        return json(res,200,{ids:ids.slice(0,50),hasMore:ids.length>50});
      }
      if(req.method==='GET' && url.pathname==='/api/state') {
        const data=live?await readLive(url.searchParams.get('fresh')==='1'):{rounds:state.rounds.filter(r=>!r.settled).map(publicRound),challenges:state.challenges.filter(c=>!c.closed).map(c=>({...c,valid:state.ownership[c.tokenId]===c.creator})),history:state.rounds.filter(r=>r.settled).map(publicRound),points:state.points,losses:state.losses,draws:state.draws};
        const selected=Number(url.searchParams.get('round'));
        const round=url.searchParams.get('round')?[...data.rounds,...data.history].find(r=>r.id===selected) || null:data.rounds.at(-1) || null;
        const account=live?null:demo.user(state,id);
        const claims=live?[]:demo.claimsFor(state,id),privateRound=live?null:state.rounds.find(r=>r.id===round?.id);
        return json(res,200,{...data,history:live?data.history.slice(-8):data.history,round,account,claims,persona,ownedTokens:live?[]:demo.ownedTokens(state,id),betCount:live?0:demo.nextBetNonce(privateRound,id),usedNfts:live?[]:Object.keys(privateRound?.usedNfts || {}).map(Number),entry:privateRound?.entries[id] || null,serverNow:Date.now()});
      }
      if(req.method==='POST'){
        if(live)return json(res,405,{error:'Live transactions must be signed in your wallet'});
        let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw new Error('Request too large');text+=chunk;}
        const body=JSON.parse(text || '{}');
        if(!body || typeof body!=='object' || Array.isArray(body))throw Error('Expected a JSON object');
        if(url.pathname==='/api/commit'){
          if('side' in body || 'salt' in body)throw Error('Plaintext choices must never be sent to this endpoint');
          if(!Number.isSafeInteger(body.roundId))throw Error('Select a round');
          demo.commitVote(state,id,{roundId:body.roundId,betNonce:body.betNonce,commitment:body.commitment,sealedChoice:body.sealedChoice,amount:parseUnits(String(body.amount || '0'),18)});
        }
        else if(url.pathname==='/api/holder-votes'){
          if('side' in body || 'salt' in body)throw Error('Plaintext choices must never be sent to this endpoint');
          demo.commitHolderVotes(state,id,body);
        }
        else if(url.pathname==='/api/challenges/create')demo.createChallenge(state,id,body.tokenId);
        else if(url.pathname==='/api/challenges/cancel')demo.cancelChallenge(state,id,body.id);
        else if(url.pathname==='/api/challenges/accept')demo.acceptChallenge(state,id,body.id,body.tokenId,Date.now(),demoFastRounds);
        else if(url.pathname==='/api/claim'){
          if(body.betNonce!==undefined && (!Number.isSafeInteger(body.betNonce) || body.betNonce<0))throw Error('Invalid bet');
          demo.claim(state,state.rounds.find(r=>r.id===body.id) || {},id,body.betNonce);
        }
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
  }catch(error){json(res,error.code==='INDEX_CATCHUP'?503:error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'File not found':error.shortMessage || error.message});}
});
server.maxHeadersCount=100;server.maxRequestsPerSocket=100;
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Chog: Beauty Arena — http://localhost:${server.address().port} (${live?'LIVE':'DEMO'})`));
function shutdown(){if(keeperTimer)clearInterval(keeperTimer);if(indexTimer)clearInterval(indexTimer);catalogProvider?.destroy();provider?.destroy();server.close(()=>{liveIndex?.close();db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
