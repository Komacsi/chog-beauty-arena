import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {deploymentDraft,validateDeploymentDraft,reviewDeploymentWallet,DEPLOYER} from '../lib/deployment-draft.mjs';
import {deploymentReviewServer} from '../lib/deployment-review-server.mjs';
const artifact=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8'));
const draft=()=>deploymentDraft(artifact,{nonce:3,gasLimit:4474532n,maxFeePerGas:202000000000n,maxPriorityFeePerGas:2000000000n});
test('deployment draft creates only the reviewed zero-value Monad contract with the exact approved constructor',async()=>{
  const value=await draft(),tx=validateDeploymentDraft(value);
  assert.equal(tx.from,DEPLOYER);assert.equal(tx.value,'0x0');assert.equal(tx.to,undefined);assert.equal(tx.chainId,'0x8f');
  assert.equal(value.maximumGasCostWei,'903855464000000000');assert.equal(tx.data.length,2+18298*2);
  assert.equal(JSON.stringify(value).includes('privateKey'),false);
});
test('deployment draft rejects a substituted build, recipient, constructor, nonce prediction or gas budget',async()=>{
  await assert.rejects(deploymentDraft({...artifact,bytecode:artifact.bytecode+'00'},{nonce:0,gasLimit:1,maxFeePerGas:1,maxPriorityFeePerGas:0}),/bytecode differs/);
  const original=await draft();
  const changes=[v=>{v.request.to=DEPLOYER;},v=>{v.request.from='0x'+'11'.repeat(20);},v=>{v.request.chainId='0x1';},v=>{v.request.value='0x1';},v=>{v.request.data=v.request.data.slice(0,-2)+'00';},v=>{v.addresses.treasury='0x'+'11'.repeat(20);},v=>{v.request.nonce='0x4';},v=>{v.request.gas='0x0';},v=>{v.maximumGasCostWei='1';},v=>{v.request.accessList=[];}];
  for(const change of changes){const value=structuredClone(original);change(value);assert.throws(()=>validateDeploymentDraft(value));}
});
test('wallet review refuses wrong account/network without any signing or transaction method',async()=>{
  const value=await draft();
  for(const [account,chain]of [['0x'+'11'.repeat(20),'0x8f'],[DEPLOYER,'0x1']]){
    const calls=[],provider={async send(method){calls.push(method);if(method==='eth_accounts')return [account];if(method==='eth_chainId')return chain;throw Error('Unexpected RPC');}};
    await assert.rejects(reviewDeploymentWallet(provider,value),/confirmed deployer|Monad mainnet/);
    assert(calls.every(method=>['eth_accounts','eth_chainId'].includes(method)));
  }
});
test('local deployment review server exposes a fixed read-only allowlist and rejects cross-origin/host requests',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-deploy-review-'));let server;
  try{
    await writeFile(join(dir,'deployment.json'),JSON.stringify(await draft()));await writeFile(join(dir,'index.html'),'<h1>Review</h1>');
    server=await deploymentReviewServer(dir,0);
    const home=await fetch(server.url);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(home.headers.get('cache-control'),'no-store');
    for(const path of ['/api/deploy','/.env','/keeper.keystore.json','/artifact.json','/../package.json'])assert.equal((await fetch(server.url+path)).status,404);
    assert.equal((await fetch(server.url+'/deployment.json',{method:'POST'})).status,405);
    assert.equal((await fetch(server.url,{headers:{origin:'https://example.com'}})).status,403);
    // Fetch normalizes Host on some Node versions; exercise the raw header.
    const wrongHost=await new Promise((done,reject)=>{http.get(server.url,{headers:{host:'attacker.example'}},response=>{response.resume();done(response.statusCode);}).on('error',reject);});
    assert.equal(wrongHost,403);
  }finally{await server?.close();await rm(dir,{recursive:true,force:true});}
});
