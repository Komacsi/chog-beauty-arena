// Publish only browser assets. Never point Netlify at the repository root/runtime.
import {mkdir,copyFile,cp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'dist/netlify');
const origin=new URL(process.env.ARENA_API_ORIGIN || 'https://chog-api.72-56-98-23.sslip.io');
if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)throw Error('ARENA_API_ORIGIN must be a public HTTPS origin');
await mkdir(target,{recursive:true});
for(const file of ['index.html','style.css','bundle.js','nft-placeholder.svg'])await copyFile(resolve(root,'public',file),resolve(target,file));
for(const dir of ['brand','nfts'])await cp(resolve(root,'public',dir),resolve(target,dir),{recursive:true});
await mkdir(resolve(target,'vendor'),{recursive:true});
await copyFile(resolve(root,'public/vendor/ethers.js'),resolve(target,'vendor/ethers.js'));
await writeFile(resolve(target,'_redirects'),`/api/* ${origin.origin}/api/:splat 200!\n/profile /index.html 200\n/leaderboard /index.html 200\n/setup /index.html 200\n`);
await writeFile(resolve(target,'_headers'),`/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://rpc.monad.xyz; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
  Cache-Control: no-cache
/nfts/*
  Cache-Control: public, max-age=86400
`);
console.log('Netlify browser-only package: '+target+'; API: '+origin.origin);
