import solc from 'solc';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export function compile(extra={}) {
  const input={language:'Solidity',sources:{'BeautyArena.sol':{content:readFileSync(resolve(root,'contracts/BeautyArena.sol'),'utf8')},...extra},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode']}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{
    try{return {contents:readFileSync(resolve(root,'node_modules',path),'utf8')}}catch{return {error:'Import not found: '+path}}
  }}));
  const errors=output.errors?.filter(e=>e.severity==='error') || [];
  if(errors.length)throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  return output.contracts;
}
export function compileV2(extra={}){
  return compile({'BeautyArenaV2.sol':{content:readFileSync(resolve(root,'contracts/BeautyArenaV2.sol'),'utf8')},...extra});
}
if(process.argv[1]===resolve(import.meta.filename)) {
  const contracts=compileV2();
  mkdirSync(resolve(root,'artifacts'),{recursive:true});
  for(const name of ['BeautyArena','BeautyArenaV2']){
    const compiled=contracts[name+'.sol'][name];
    writeFileSync(resolve(root,'artifacts',name+'.json'),JSON.stringify({abi:compiled.abi,bytecode:'0x'+compiled.evm.bytecode.object},null,2));
  }
  console.log('BeautyArena (current live) and BeautyArenaV2 (pending deployment) compiled');
}
