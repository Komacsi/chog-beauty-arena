import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLiveStartup} from '../lib/live-startup.mjs';
import {RELEASE_STATUS} from '../lib/release.mjs';

test('live startup rejects a changed deployment block before any RPC or credential access',async()=>{
  for(const block of [undefined,'',0,115710674,115710676]){
    await assert.rejects(validateLiveStartup({},RELEASE_STATUS.arenaAddress,block),/verified arena deployment block/);
  }
});
test('live startup rejects missing or changed arena code before accepting the asset',async()=>{
  for(const code of ['0x','0x60006000']){
    await assert.rejects(validateLiveStartup({getCode:async()=>code},RELEASE_STATUS.arenaAddress,RELEASE_STATUS.deploymentBlock),/runtime differs/);
  }
});
