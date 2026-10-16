import {build} from 'esbuild-wasm';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
execFileSync(process.execPath,['scripts/compile.mjs'],{cwd:root,stdio:'inherit'});
await mkdir(resolve(root,'public/vendor'),{recursive:true});
await copyFile(resolve(root,'node_modules/ethers/dist/ethers.min.js'),resolve(root,'public/vendor/ethers.js'));
const output=await build({stdin:{contents:await readFile(resolve(root,'public/app.js'),'utf8'),resolveDir:resolve(root,'public'),sourcefile:'app.js',loader:'js'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,minify:true,tsconfigRaw:{},define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'workspace-resolver',setup(builder){
    builder.onResolve({filter:/.*/},args=>{
      if(args.path==='ethers')return {path:'/vendor/ethers.js',external:true};
      if(['crypto','node:crypto'].includes(args.path))return {path:'crypto',namespace:'shim'};
      const request=args.path==='buffer'?'buffer/index.js':args.path;
      return {path:require.resolve(request,{paths:[args.resolveDir || root]}),namespace:'workspace'};
    });
    builder.onLoad({filter:/.*/,namespace:'shim'},()=>({contents:'export const webcrypto=globalThis.crypto; export default {webcrypto};',loader:'js'}));
    builder.onLoad({filter:/.*/,namespace:'workspace'},async args=>({contents:await readFile(args.path,'utf8'),resolveDir:dirname(args.path),loader:args.path.endsWith('.json')?'json':'js'}));
  }
}]});
await writeFile(resolve(root,'public/bundle.js'),output.outputFiles[0].contents);
console.log('Frontend built with local timelock encryption');
