import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createNftCatalog,ipfsPath,catalogGateways} from '../lib/nft-catalog.mjs';
test('host preference reorders only the two fixed HTTPS IPFS gateways',()=>{
  assert.deepEqual(catalogGateways('pinata'),catalogGateways().slice().reverse());
  for(const value of ['https://internal/','__proto__','constructor',''])assert.throws(()=>catalogGateways(value),/must be filebase or pinata/);
});
const cid='bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu',uri=`ipfs://${cid}/1462.json`,image=`ipfs://${cid}/1462.webp`,png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
async function fixture(t,options={}){
  const cacheDir=await mkdtemp(join(tmpdir(),'chog-nft-cache-'));assert.ok(resolve(cacheDir).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(cacheDir,{recursive:true,force:true}));
  const calls=[],base={cacheDir,readTokenUri:async id=>{calls.push(['uri',id]);return uri;},fetcher:async(url,init)=>{calls.push(['fetch',url,init]);return url.endsWith('.json')?Response.json({name:'CHOG #1462',image,attributes:[{trait_type:'Tier',value:'Rare'}]}):new Response(png);},...options};
  return {calls,base,catalog:createNftCatalog(base)};
}
test('outside-sample NFT metadata loads independently from its image and concurrent reads deduplicate',async t=>{
  const f=await fixture(t),records=await Promise.all(Array.from({length:12},()=>f.catalog.getMetadata(1)));
  assert.ok(records.every(n=>n.tokenId===1 && n.name==='CHOG #1462' && n.image==='/api/nfts/1/image'));assert.equal(f.calls.filter(c=>c[0]==='uri').length,1);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
  const images=await Promise.all(Array.from({length:12},()=>f.catalog.getImage(1)));assert.ok(images.every(n=>n.type==='image/png'));assert.equal(f.calls.filter(c=>c[0]==='fetch').length,2);
  const cached=createNftCatalog({...f.base,readTokenUri:async()=>{throw Error('Unexpected chain read');},fetcher:async()=>{throw Error('Unexpected image download');}});
  assert.equal((await cached.getMetadata(1)).name,'CHOG #1462');assert.deepEqual((await cached.getImage(1)).bytes,png);
});
test('sample metadata uses its existing local image without network access',async t=>{
  const f=await fixture(t,{seedNfts:[{tokenId:299,name:'CHOG #1760',image:'/nfts/299.webp',attributes:[]}]});assert.equal((await f.catalog.getMetadata(299)).image,'/nfts/299.webp');assert.deepEqual(await f.catalog.getImage(299),{redirect:'/nfts/299.webp'});assert.equal(f.calls.length,0);
});
test('NFT routes cannot choose a collection, URL, local host or traversal path',async t=>{
  for(const bad of ['http://127.0.0.1/secret','https://example.com/a',`ipfs://${cid}/../secret`,`ipfs://${cid}/%2e%2e/secret`])assert.throws(()=>ipfsPath(bad),/Unsupported/);
  const f=await fixture(t,{readTokenUri:async()=> 'http://169.254.169.254/credentials'});await assert.rejects(f.catalog.getMetadata(1),/Unsupported/);
  for(const id of [0,1970,-1,1.5,NaN])await assert.rejects(f.catalog.getMetadata(id),/Invalid Chog/);
  assert.equal(f.calls.length,0);
});
test('untrusted image formats and oversized metadata fail without blocking other NFTs',async t=>{
  const f=await fixture(t,{fetcher:async url=>url.endsWith('.json')?Response.json({name:'CHOG',image}):new Response('<svg onload="alert(1)"></svg>')});await assert.rejects(f.catalog.getImage(1),/Unsupported NFT image/);
  const big=await fixture(t,{fetcher:async()=>new Response('x'.repeat(256*1024+1))});await assert.rejects(big.catalog.getMetadata(1),/too large/);
});
test('gateway failures retry a fixed alternate gateway and can recover on a later request',async t=>{
  let failed=true;const f=await fixture(t,{fetcher:async(url,init)=>{assert.equal(init.redirect,'error');if(failed)throw Error('Gateway offline');return Response.json({name:'CHOG #1462',image});}});
  await assert.rejects(f.catalog.getMetadata(1),/offline/);failed=false;assert.equal((await f.catalog.getMetadata(1)).name,'CHOG #1462');
});
test('an incomplete image response is never cached as a complete NFT',async t=>{
  const f=await fixture(t,{fetcher:async url=>url.endsWith('.json')?Response.json({name:'CHOG',image}):new Response(png,{status:206,headers:{'content-range':'bytes 0-11/1000'}})});
  await assert.rejects(f.catalog.getImage(1),/Incomplete NFT resource/);
});
