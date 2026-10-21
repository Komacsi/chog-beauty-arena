import {readdir,readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../dist/netlify');
const exact=new Set(['index.html','style.css','bundle.js','nft-placeholder.svg','_headers','_redirects','vendor/ethers.js','brand/chog-beauty-arena.png']);
const files=await readdir(root,{recursive:true});let count=0;
for(const entry of files){
  const name=entry.replaceAll('\\','/'),stat=await lstat(resolve(root,entry));
  if(stat.isSymbolicLink())throw Error('Symlink in Netlify artifact');
  if(stat.isDirectory())continue;
  if(!exact.has(name) && !/^nfts\/\d+\.webp$/.test(name))throw Error('Unexpected publish file: '+name);
  if(!stat.isFile() || !stat.size)throw Error('Empty or invalid publish file: '+name);
  exact.delete(name);count++;
}
if(exact.size)throw Error('Missing publish files: '+[...exact].join(', '));
const redirects=await readFile(resolve(root,'_redirects'),'utf8');
if(!/^\/api\/\* https:\/\/[^\s/]+\/api\/:splat 200!\n\/profile \/index\.html 200\n\/leaderboard \/index\.html 200\n\/setup \/index\.html 200\n$/.test(redirects))throw Error('Unexpected Netlify routing');
console.log('Netlify publish allowlist checked: '+count+' browser files; no state, contracts, environment files or keeper credentials.');
