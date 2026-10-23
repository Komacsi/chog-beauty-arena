import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {exportKeeperKeystore} from '../lib/keystore-export.mjs';
test('offline export encrypts only the selected account and never overwrites; wrong account/weak password produce no file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chog-keystore-export-'));
  // Disposable test wallet only. No production secret is read.
  const wallet=Wallet.createRandom(),password='disposable-test-password-123',outputFile=join(dir,'wallet.json');
  try{
    await assert.rejects(()=>exportKeeperKeystore({privateKey:wallet.privateKey,password,expectedAddress:'0x1111111111111111111111111111111111111111',outputFile}));
    await assert.rejects(()=>exportKeeperKeystore({privateKey:wallet.privateKey,password:'short',expectedAddress:wallet.address,outputFile}));
    assert.deepEqual(await readdir(dir),[]);
    const result=await exportKeeperKeystore({privateKey:wallet.privateKey,password,expectedAddress:wallet.address,outputFile});
    assert.equal(result.address,wallet.address);
    const json=await readFile(outputFile,'utf8');assert.ok(!json.includes(wallet.privateKey.slice(2)));assert.ok(!json.includes(password));
    assert.equal((await Wallet.fromEncryptedJson(json,password)).address,wallet.address);
    await assert.rejects(()=>Wallet.fromEncryptedJson(json,'incorrect-password'));
    await assert.rejects(()=>exportKeeperKeystore({privateKey:wallet.privateKey,password,expectedAddress:wallet.address,outputFile}),{code:'EEXIST'});
    assert.equal(await readFile(outputFile,'utf8'),json);
    if(process.platform!=='win32')assert.equal((await stat(outputFile)).mode&0o777,0o600);
    const cli=spawnSync(process.execPath,['scripts/create-keeper-keystore.mjs',join(dir,'unexpected.json')],{cwd:new URL('..',import.meta.url),input:Buffer.from(JSON.stringify({privateKey:wallet.privateKey,password})).toString('base64'),encoding:'utf8',windowsHide:true});
    assert.equal(cli.status,1);assert.ok(!cli.stderr.includes(wallet.privateKey.slice(2)));assert.ok(!cli.stderr.includes(password));
    assert.deepEqual(await readdir(dir),['wallet.json']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
