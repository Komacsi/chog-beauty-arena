import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CHOG_COLLECTION,COLLECTION_SIZE} from './wallet-nfts.mjs';

const METADATA_LIMIT=256*1024,IMAGE_LIMIT=8*1024*1024,TTL=24*60*60*1000;
export function validTokenId(value){return Number.isSafeInteger(value) && value>=1 && value<=COLLECTION_SIZE;}
export function ipfsPath(uri){
  if(typeof uri!=='string' || uri.length>600)throw Error('Unsupported NFT resource');
  const match=uri.match(/^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]{32,128})((?:\/[A-Za-z0-9._~-]+)*)$/);
  if(!match || match[2].split('/').some(s=>s==='.' || s==='..'))throw Error('Unsupported NFT resource');
  return match[1]+match[2];
}
async function limitedBytes(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel().catch(()=>{});throw Error('NFT resource is too large');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('NFT resource is too large');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,size);
}
export function imageType(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return 'image/gif';
  throw Error('Unsupported NFT image');
}
function attributes(input){return Array.isArray(input)?input.slice(0,40).filter(a=>a && typeof a.trait_type==='string' && ['string','number'].includes(typeof a.value)).map(a=>({trait_type:a.trait_type.slice(0,80),value:String(a.value).slice(0,160)})):[];}
export function createNftCatalog({seedNfts=[],cacheDir,readTokenUri,fetcher=fetch,gateways=['https://ipfs.filebase.io/ipfs/','https://gateway.pinata.cloud/ipfs/']}){
  const seed=new Map(seedNfts.map(n=>[n.tokenId,n])),memory=new Map(),metadataInFlight=new Map(),imagesInFlight=new Map(),waiting=[];
  let active=0;const ready=mkdir(cacheDir,{recursive:true});
  for(const gateway of gateways){const u=new URL(gateway);if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash || !u.pathname.endsWith('/'))throw Error('Invalid IPFS gateway');}
  async function bounded(fn){
    if(active>=4){if(waiting.length>=12)throw Error('NFT loading is busy. Please retry.');await new Promise(done=>waiting.push(done));}else active++;
    try{return await fn();}finally{const next=waiting.shift();if(next)next();else active--;}
  }
  async function resource(uri,limit){
    const path=ipfsPath(uri);let last;
    for(const gateway of gateways){
      try{
        const response=await fetcher(gateway+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('NFT gateway temporarily unavailable');}
        const bytes=await limitedBytes(response,limit);
        if(response.status===206){const range=response.headers.get('content-range')?.match(/^bytes 0-\d+\/(\d+)$/);if(!range || Number(range[1])!==bytes.length)throw Error('Incomplete NFT resource');}
        return bytes;
      }catch(error){last=error;}
    }
    throw last;
  }
  async function writeCache(path,value){await ready;const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,value);await rename(tmp,path);}
  function publicRecord(n){return {tokenId:n.tokenId,name:n.name,image:seed.has(n.tokenId)?seed.get(n.tokenId).image:`/api/nfts/${n.tokenId}/image`,attributes:attributes(n.attributes)};}
  async function metadata(tokenId){
    if(!validTokenId(tokenId))throw Error('Invalid Chog NFT');
    if(seed.has(tokenId))return seed.get(tokenId);
    const known=memory.get(tokenId);if(known && Date.now()-known.cachedAt<TTL)return known;
    if(metadataInFlight.has(tokenId))return metadataInFlight.get(tokenId);
    const pending=bounded(async()=>{
      await ready;const file=resolve(cacheDir,tokenId+'.json');
      try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.collection===CHOG_COLLECTION && saved.tokenId===tokenId && typeof saved.name==='string' && Date.now()-saved.cachedAt<TTL){ipfsPath(saved.imageUri);memory.set(tokenId,saved);return saved;}}catch{}
      const tokenUri=await readTokenUri(tokenId),raw=JSON.parse((await resource(tokenUri,METADATA_LIMIT)).toString('utf8'));
      if(!raw || typeof raw!=='object' || Array.isArray(raw))throw Error('Invalid NFT metadata');
      ipfsPath(raw.image);
      const record={collection:CHOG_COLLECTION,tokenId,tokenUri,imageUri:raw.image,name:typeof raw.name==='string' && raw.name.trim()?raw.name.trim().slice(0,120):'CHOG',attributes:attributes(raw.attributes),cachedAt:Date.now()};
      await writeCache(file,JSON.stringify(record));memory.set(tokenId,record);return record;
    }).finally(()=>metadataInFlight.delete(tokenId));metadataInFlight.set(tokenId,pending);return pending;
  }
  return {
    async getMetadata(tokenId){return publicRecord(await metadata(tokenId));},
    async getImage(tokenId){
      const n=await metadata(tokenId);if(seed.has(tokenId))return {redirect:seed.get(tokenId).image};
      if(imagesInFlight.has(tokenId))return imagesInFlight.get(tokenId);
      const pending=bounded(async()=>{
        const hash=createHash('sha256').update(n.imageUri).digest('hex').slice(0,16),file=resolve(cacheDir,tokenId+'-'+hash+'.image');
        try{const bytes=await readFile(file);if(bytes.length<=IMAGE_LIMIT)return {bytes,type:imageType(bytes)};}catch{}
        const bytes=await resource(n.imageUri,IMAGE_LIMIT),type=imageType(bytes);await writeCache(file,bytes);return {bytes,type};
      }).finally(()=>imagesInFlight.delete(tokenId));imagesInFlight.set(tokenId,pending);return pending;
    }
  };
}
