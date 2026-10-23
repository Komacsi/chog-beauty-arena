import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {toBeHex} from 'ethers';
import {REVIEWED_CHOG,validateChogAsset} from '../lib/chog-asset.mjs';
const code=(await readFile(new URL('../security/chog-implementation-runtime.hex',import.meta.url),'utf8')).trim();
const block=115693565,hash='0x'+'ab'.repeat(32);
function fixture(change={}){
  const reads=[],p={
    async getNetwork(){return {chainId:143n};},async getBlockNumber(){return block;},
    async send(method,args){assert.equal(method,'eth_getBlockByNumber');assert.deepEqual(args,['0x'+block.toString(16),false]);return {number:'0x'+block.toString(16),hash};},
    async getCode(a,n){reads.push(n);return a===REVIEWED_CHOG.token?'0x363d3d373d3d3d363d73'+REVIEWED_CHOG.implementation.slice(2)+'5af43d82803e903d91602b57fd5bf3':code;},
    async getStorage(a,s,n){assert.equal(a,REVIEWED_CHOG.token);reads.push(n);return toBeHex(s===5?BigInt(REVIEWED_CHOG.controller):BigInt(REVIEWED_CHOG.pool)|(1n<<160n)|(1n<<168n),32);},
    async call(tx){assert.equal(tx.to,REVIEWED_CHOG.token);assert.equal(tx.data,'0x313ce567');reads.push(tx.blockTag);return toBeHex(18,32);},
    ...change
  };return {p,reads};
}
test('CHOG preflight pins the exact reviewed proxy, runtime and state to one block without a signer',async()=>{
  const {p,reads}=fixture(),result=await validateChogAsset(p);
  assert.equal(result.blockHash,hash);assert.equal(result.implementationCodeHash,REVIEWED_CHOG.implementationCodeHash);
  assert.equal(result.sourceVerified,false);assert.deepEqual(reads,Array(5).fill(block));
});
test('CHOG preflight rejects altered code, deployment state, decimals, network and incomplete RPC evidence',async()=>{
  const base=fixture().p;
  const changes=[
    [{async getNetwork(){return {chainId:1337n};}},/wrong chain/],
    [{async getCode(a,n){return a===REVIEWED_CHOG.token?'0x00':base.getCode(a,n);}},/proxy bytecode/],
    [{async getCode(a,n){return a===REVIEWED_CHOG.implementation?'0x00':base.getCode(a,n);}},/implementation bytecode/],
    [{async getStorage(a,s,n){return s===5?toBeHex(0,32):base.getStorage(a,s,n);}},/controller state/],
    [{async getStorage(a,s,n){return s===6?toBeHex(BigInt(REVIEWED_CHOG.pool)|(1n<<160n),32):base.getStorage(a,s,n);}},/initialized\/graduated/],
    [{async getStorage(a,s,n){return s===6?toBeHex(BigInt(REVIEWED_CHOG.pool)|(1n<<168n),32):base.getStorage(a,s,n);}},/initialized\/graduated/],
    [{async getStorage(a,s,n){return s===6?toBeHex((1n<<160n)|(1n<<168n),32):base.getStorage(a,s,n);}},/pool or initialized/],
    [{async getStorage(){return '0x';}},/malformed storage/],
    [{async call(){return toBeHex(6,32);}},/decimals changed/],
    [{async call(){throw Error('RPC unavailable');}},/RPC unavailable/],
    [{async send(){return null;}},/missing block/]
  ];
  for(const [change,reason]of changes)await assert.rejects(validateChogAsset(fixture(change).p),reason);
  await assert.rejects(validateChogAsset(base,'0x'+'11'.repeat(20)),/unexpected token/);
  let reads=0;await assert.rejects(validateChogAsset(fixture({async send(){return {number:block,hash:++reads===1?hash:'0x'+'cd'.repeat(32)};}}).p),/reorganized/);
});
