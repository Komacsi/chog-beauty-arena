// Finite, resumable public-artwork preparation. No signer or wallet credentials.
import {Contract,FetchRequest,JsonRpcProvider} from 'ethers';
import {access,readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createNftCatalog,catalogGateways,imageType} from '../lib/nft-catalog.mjs';
import {COLLECTION,CHAIN_ID,RPC_URL,EXPECTED_SUPPLY} from '../lib/config.mjs';
const exec=promisify(execFile),cacheDir=resolve(process.env.ARENA_STATE_DIR || 'data','nft-cache');
const workers=Number(process.env.NFT_CACHE_WORKERS || 8);
if(!Number.isSafeInteger(workers)||workers<1||workers>8)throw Error('Use 1..8 artwork workers');
await mkdir(cacheDir,{recursive:true});
const connection=new FetchRequest(RPC_URL);connection.timeout=15000;
const provider=new JsonRpcProvider(connection,CHAIN_ID,{batchMaxCount:1});
if(Number((await provider.getNetwork()).chainId)!==CHAIN_ID)throw Error('Wrong NFT network');
const collection=new Contract(COLLECTION,['function tokenURI(uint256) view returns(string)'],provider);
const archiveDir=process.env.NFT_ARTWORK_ARCHIVE_DIR?resolve(process.env.NFT_ARTWORK_ARCHIVE_DIR):null;
const archiveCids=new Set(['bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e','bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu']);
let rpcTurn=Promise.resolve(),lastRpc=0;
async function tokenUri(id){
  rpcTurn=rpcTurn.then(async()=>{await new Promise(done=>setTimeout(done,Math.max(0,lastRpc+100-Date.now())));lastRpc=Date.now();});
  await rpcTurn;return collection.tokenURI(id);
}
async function resource(url,init){
  const match=new URL(url).pathname.match(/^\/ipfs\/([A-Za-z0-9]+)\/([0-9]{1,5}\.(?:json|webp))$/);
  if(archiveDir && match && archiveCids.has(match[1])){
    try{return new Response(await readFile(resolve(archiveDir,match[1],match[2])));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return fetch(url,init);
}
const catalog=createNftCatalog({cacheDir,readTokenUri:tokenUri,fetcher:resource,gateways:catalogGateways(process.env.NFT_IPFS_PRIMARY || 'pinata'),concurrency:workers});
const selected=process.argv[2]?process.argv[2].split(',').map(Number):Array.from({length:EXPECTED_SUPPLY},(_,i)=>i+1);
if(selected.some(id=>!Number.isSafeInteger(id)||id<1||id>EXPECTED_SUPPLY)||new Set(selected).size!==selected.length)throw Error('Invalid token list');
const summary={startedAt:new Date().toISOString(),total:selected.length,completed:0,failed:[],errors:{},originalBytes:0,previewBytes:0};
const statusPath=resolve(cacheDir,'artwork-status.json');let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
let progressWrite=Promise.resolve();
function save(){const text=JSON.stringify({...summary,checkedAt:new Date().toISOString()})+'\n';progressWrite=progressWrite.then(async()=>{await writeFile(statusPath+'.tmp',text,{mode:0o600});await rename(statusPath+'.tmp',statusPath);});return progressWrite;}
async function prepare(id){
  await catalog.getMetadata(id);
  const metadata=JSON.parse(await readFile(resolve(cacheDir,id+'.json'),'utf8'));
  const hash=createHash('sha256').update(metadata.imageUri).digest('hex').slice(0,16),source=resolve(cacheDir,id+'-'+hash+'.image'),preview=source+'.thumb.webp';
  try{const bytes=await readFile(preview);if(bytes.length<=512*1024 && imageType(bytes)==='image/webp'){summary.previewBytes+=bytes.length;return;}}catch{}
  await catalog.getImage(id);await access(source);
  const result=await exec('/usr/bin/python3',[resolve(import.meta.dirname,'nft-thumbnail.py'),source],{timeout:30000,maxBuffer:2048});
  const sizes=JSON.parse(result.stdout);summary.originalBytes+=sizes.originalBytes;summary.previewBytes+=sizes.previewBytes;
}
try{
  await save();
  let pending=selected;
  for(let attempt=0;attempt<4 && pending.length && !stopping;attempt++){
    const retry=[];let cursor=0;
    await Promise.all(Array.from({length:workers},async()=>{
      while(cursor<pending.length && !stopping){const id=pending[cursor++];
        try{await prepare(id);summary.completed++;}catch(error){retry.push(id);const reason=String(error.shortMessage || error.message || error.code).slice(0,180);summary.errors[reason]=(summary.errors[reason] || 0)+1;if(summary.errors[reason]===1)console.error(JSON.stringify({reason,tokenId:id}));await new Promise(done=>setTimeout(done,1000));}
        if((summary.completed+retry.length)%25===0){await save();console.log(JSON.stringify({completed:summary.completed,total:summary.total,retry:retry.length,attempt:attempt+1}));}
      }
    }));
    pending=retry;summary.failed=retry;await save();
    if(pending.length && !stopping)await new Promise(done=>setTimeout(done,5000));
  }
  await save();console.log(JSON.stringify(summary));
  if(stopping || summary.completed!==summary.total)process.exitCode=1;
}finally{provider.destroy();await progressWrite;}
