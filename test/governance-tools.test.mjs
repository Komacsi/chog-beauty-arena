import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Interface,encryptKeystoreJson} from 'ethers';
import {governanceProposal} from '../lib/governance.mjs';
import {loadKeeperSigner} from '../lib/keeper-signer.mjs';
import {roundAlerts,monitorArena} from '../lib/monitor.mjs';
const arena='0x1111111111111111111111111111111111111111',governance='0x2222222222222222222222222222222222222222';
test('Safe proposals encode only the selected admin call, no transfer or signature',()=>{
  const abi=new Interface(['function revokeRevealer()','function setRevealer(address)','function emergencyCancelRound(uint256)','function transferOwnership(address)','function acceptOwnership()']);
  for(const [action,value,method,args] of [['revoke',undefined,'revokeRevealer',[]],['replace',arena,'setRevealer',[arena]],['cancel','12','emergencyCancelRound',[12]],['transfer-governance',arena,'transferOwnership',[arena]],['accept-governance',undefined,'acceptOwnership',[]]]){
    const p=governanceProposal({arena,governance,chainId:143,action,value,createdAt:1});
    assert.equal(p.chainId,'143');assert.equal(p.meta.createdFromSafeAddress,governance);
    assert.deepEqual(p.transactions,[{to:arena,value:'0',data:abi.encodeFunctionData(method,args),contractMethod:null,contractInputsValues:null}]);
  }
  for(const options of [{action:'constructor'},{action:'__proto__'},{action:'cancel',value:0},{action:'cancel',value:'-1'},{action:'replace',value:'0x'+'0'.repeat(40)},{action:'revoke',chainId:0}])assert.throws(()=>governanceProposal({arena,governance,chainId:143,...options}));
});
test('keeper loads an encrypted disposable key, rejects raw keys and hides unlock errors',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-keeper-test-'));
  try{
    const wallet=Wallet.createRandom(),password='local test password',key=join(dir,'key.json'),pass=join(dir,'password');
    const json=await encryptKeystoreJson({address:wallet.address,privateKey:wallet.privateKey},password,{scrypt:{N:1024,r:8,p:1}});
    await writeFile(key,json,{mode:0o600});await writeFile(pass,password+'\n',{mode:0o600});
    const env={KEEPER_KEYSTORE_PATH:key,KEEPER_PASSWORD_FILE:pass};
    assert.equal((await loadKeeperSigner(null,env)).address,wallet.address);
    await assert.rejects(loadKeeperSigner(null,{...env,KEEPER_PRIVATE_KEY:wallet.privateKey}),/encrypted keystore/);
    await assert.rejects(loadKeeperSigner(null,{}),/Set KEEPER/);
    await writeFile(pass,'incorrect');await assert.rejects(loadKeeperSigner(null,env),/^Error: Cannot unlock keeper keystore$/);
    if(process.platform!=='win32'){
      await chmod(key,0o440);
      await assert.rejects(loadKeeperSigner(null,{...env,CREDENTIALS_DIRECTORY:dir}),/protected systemd credentials/);
      await chmod(key,0o600);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('read-only monitor reports paused service, urgent refunds, low gas and coverage limits',async()=>{
  assert.deepEqual(roundAlerts(1,{settled:true},100,2),[]);
  assert.equal(roundAlerts(1,{settled:false},100,2)[0].code,'REFUND_PENDING');
  const r={settled:false,unlockAt:100,revealEndsAt:500,revealedCount:1n,committedCount:2n};
  assert.deepEqual(roundAlerts(3,r,99),[]);assert.equal(roundAlerts(3,r,250)[0].code,'REVEAL_DEADLINE_NEAR');
  assert.equal(roundAlerts(3,r,500)[0].code,'SETTLEMENT_PENDING');
  const contract={revealer:async()=>arena,owner:async()=>governance,currentRoundId:async()=>3n,interruptedThroughRound:async()=>2n,getRound:async()=>r};
  const provider={getBlock:async()=>({timestamp:50}),getBalance:async()=>0n};
  const result=await monitorArena({arena:contract,provider,validateGovernance:async()=>{throw Error();},minimumGas:1n,now:250,maxRounds:2});
  assert.deepEqual(result.alerts.map(a=>a.code),['RPC_STALE','GOVERNANCE_CONFIGURATION','KEEPER_LOW_MON','COVERAGE_LIMIT','REFUND_PENDING','REVEAL_DEADLINE_NEAR']);
  contract.revealer=async()=>'0x'+'0'.repeat(40);
  assert.ok((await monitorArena({arena:contract,provider,validateGovernance:async()=>{},minimumGas:1n,now:250})).alerts.some(a=>a.code==='KEEPER_REVOKED'));
});

test('health-only monitoring checks RPC, governance and gas without reading battles',async()=>{
  const contract={revealer:async()=>arena,owner:async()=>governance,currentRoundId:async()=>1000n,interruptedThroughRound:async()=>0n,getRound:async()=>{throw Error('Battle monitoring must remain disabled');}};
  const result=await monitorArena({arena:contract,provider:{getBlock:async()=>({timestamp:250}),getBalance:async()=>0n},validateGovernance:async()=>{},minimumGas:1n,now:250,includeRounds:false});
  assert.equal(result.checkedRounds,0);assert.deepEqual(result.alerts,[{code:'KEEPER_LOW_MON'}]);
});
