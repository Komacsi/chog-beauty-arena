import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { COLLECTION, EXPECTED_SUPPLY, CHAIN_ID, call, rpc, decodeString, resolveUri } from '../lib/config.mjs';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'data'), {recursive:true});
await mkdir(resolve(root, 'public/nfts'), {recursive:true});
const chain = Number(BigInt(await rpc('eth_chainId', [])));
if (chain !== CHAIN_ID) throw new Error(`Wrong network: ${chain}`);
const supply = Number(BigInt(await call('0x18160ddd')));
if (supply !== EXPECTED_SUPPLY) throw new Error(`Unexpected supply: ${supply}`);
const manifestPath = resolve(root,'data/collection.json');
let previous = [];
try { previous = JSON.parse(await readFile(manifestPath,'utf8')).nfts; } catch {}
const records = new Map(previous.map(nft => [nft.tokenId,nft]));
const errors = [];
async function retry(fn) {
  for (let attempt=0; attempt<4; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt===3) throw error;
      await new Promise(done=>setTimeout(done,1000*(attempt+1)));
    }
  }
}
async function getResource(uri, json) {
  const response = await fetch(resolveUri(uri), {headers:json?{}:{Range:'bytes=0-8191'},signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
  if (json) return response.json();
  const type = (response.headers.get('content-type') || '').split(';')[0];
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)) throw new Error(`Unsupported image: ${type}`);
  const first=Buffer.from(await response.arrayBuffer());
  const range=response.headers.get('content-range');
  if(response.status!==206 || !range)return {bytes:first,type};
  const total=Number(range.split('/')[1]);
  const chunks=[first];
  for(let offset=first.length;offset<total;offset+=8192){
    const end=Math.min(offset+8191,total-1);
    const chunk=await retry(async()=>{
      const r=await fetch(resolveUri(uri),{headers:{Range:`bytes=${offset}-${end}`},signal:AbortSignal.timeout(20000)});
      if(r.status!==206)throw new Error('Gateway did not honour byte range');
      const bytes=Buffer.from(await r.arrayBuffer());
      if(bytes.length!==end-offset+1)throw new Error('Incomplete image chunk');
      return bytes;
    });chunks.push(chunk);
  }
  return {bytes:Buffer.concat(chunks),type};
}
function save() {
  return writeFile(manifestPath, JSON.stringify({collection:COLLECTION,chainId:CHAIN_ID,expectedSupply:supply,importedAt:new Date().toISOString(),nfts:[...records.values()].sort((a,b)=>a.tokenId-b.tokenId)},null,2));
}
// This collection is not ERC721Enumerable. Verify every tokenURI in its 1..supply range.
// The final supply check ensures no guessed ID or missing image is accepted.
const full=process.argv.includes('--full');
const samples=JSON.parse(await readFile(resolve(root,'data/sample-sources.json'),'utf8'));
const ids=full ? Array.from({length:supply},(_,i)=>i+1) : samples.map(n=>n.tokenId);
let cursor=0, completed=0;
await Promise.all(Array.from({length:6}, async ()=> {
  while (cursor<ids.length) {
    const index=ids[cursor++];
    try {
      const tokenId=index;
      const existing=records.get(tokenId);
      if (existing) {
        try { await access(resolve(root,'public',existing.image.slice(1))); completed++; continue; } catch {}
      }
      const tokenUri=decodeString(await retry(()=>call('0xc87b56dd'+BigInt(tokenId).toString(16).padStart(64,'0'))));
      const metadata=await retry(()=>getResource(tokenUri,true));
      const cachedPath=`/nfts/${tokenId}.webp`;
      try {
        await access(resolve(root,'public',cachedPath.slice(1)));
        records.set(tokenId,{tokenId,name:metadata.name || `CHOG #${tokenId}`,image:cachedPath,sourceImage:metadata.image,tokenUri,attributes:metadata.attributes || []});
        completed++;continue;
      } catch {}
      // Small thumbnails keep the ten-item prototype quick to import.
      const image=await retry(()=>getResource(full ? metadata.image : samples.find(n=>n.tokenId===tokenId).image.replace('w=500','w=128'),false));
      const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[image.type];
      const imagePath=`/nfts/${tokenId}.${extension}`;
      await writeFile(resolve(root,'public',imagePath.slice(1)),image.bytes);
      records.set(tokenId,{tokenId,name:metadata.name || `CHOG #${tokenId}`,image:imagePath,sourceImage:metadata.image,tokenUri,attributes:metadata.attributes || []});
      completed++;
      if (completed%50===0) { await save(); console.log(`Imported ${completed}/${supply}`); }
    } catch(error) { errors.push({index,error:error.message}); console.error(`Index ${index}: ${error.message}`); }
  }
}));
await save();
await writeFile(resolve(root,'data/import-errors.json'),JSON.stringify(errors,null,2));
console.log(`Collection ready: ${records.size}/${supply}; errors: ${errors.length}`);
if (errors.length || ids.some(id=>!records.has(id))) process.exitCode=1;
