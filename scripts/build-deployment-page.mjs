import {build} from 'esbuild-wasm';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]),require=createRequire(import.meta.url);
const result=await build({stdin:{contents:await readFile(resolve(root,'operator/deployment.js'),'utf8'),resolveDir:resolve(root,'operator'),sourcefile:'deployment.js',loader:'js'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,tsconfigRaw:{},plugins:[{name:'deployment-files',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path==='ethers'?{path:'/ethers.js',external:true}:{path:require.resolve(args.path,{paths:[args.resolveDir||root]}),namespace:'workspace'});
  builder.onLoad({filter:/.*/,namespace:'workspace'},async args=>({contents:await readFile(args.path,'utf8'),resolveDir:dirname(args.path),loader:args.path.endsWith('.json')?'json':'js'}));
}}]});
await writeFile(resolve(out,'client.js'),result.outputFiles[0].contents,{flag:'wx'});
for(const [source,name]of [['operator/deployment.html','index.html'],['operator/deployment.css','style.css'],['node_modules/ethers/dist/ethers.min.js','ethers.js']])await copyFile(resolve(root,source),resolve(out,name));
console.log('Local deployment review page built; no credentials or demo state included.');
