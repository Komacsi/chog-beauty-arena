// Build an isolated runnable directory. Never copy .env, wallets or state databases.
import {mkdir,copyFile,cp,access,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=resolve(import.meta.dirname,'..'),target=resolve(root,process.argv[2] || 'dist/runtime');
if(!process.env.npm_execpath)throw Error('Use npm run build:runtime');
await access(resolve(root,'package-lock.json'));
await mkdir(dirname(target),{recursive:true});
// EEXIST is intentional: do not overwrite a previous artifact or deployment.
await mkdir(target);
const built=await exec(process.execPath,['scripts/build.mjs'],{cwd:root,windowsHide:true});process.stdout.write(built.stdout);
for(const file of ['package.json','package-lock.json','server.mjs'])await copyFile(resolve(root,file),resolve(target,file));
for(const dir of ['lib','public','artifacts'])await cp(resolve(root,dir),resolve(target,dir),{recursive:true});
await mkdir(resolve(target,'data'));
await copyFile(resolve(root,'data/collection.json'),resolve(target,'data/collection.json'));
await mkdir(resolve(target,'scripts'));
for(const file of ['demo.mjs','keeper.mjs','monitor.mjs','governance.mjs','audit.mjs'])await copyFile(resolve(root,'scripts',file),resolve(target,'scripts',file));
const installed=await exec(process.execPath,[process.env.npm_execpath,'ci','--omit=dev','--ignore-scripts','--no-audit','--prefer-offline','--maxsockets=1'],{cwd:target,windowsHide:true,maxBuffer:2*1024*1024});process.stdout.write(installed.stdout);
for(const pkg of Object.keys(JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).devDependencies)){
  try{await access(resolve(target,'node_modules',pkg));}catch{continue;}throw Error('Development package leaked into runtime: '+pkg);
}
console.log('Runtime directory: '+target+' (production dependencies only; no secrets or demo database)');
