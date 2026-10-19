import test from 'node:test';
import assert from 'node:assert/strict';
import {submitLiveBet} from '../lib/live-bet.mjs';

function fixture(changeAt){
  let changed=false;const calls=[];
  const options={account:'0x1111111111111111111111111111111111111111',chainId:143,roundId:7,side:1,amount:5000n*10n**18n,holderId:0,
    arena:{getRound:async()=>({endsAt:100n,settled:false,nftA:299n,nftB:379n,beaconRound:123456n}),getAddress:async()=>'0x2222222222222222222222222222222222222222',commitVote:async(...args)=>{calls.push(['commit',...args]);return {wait:async()=>{}};}},
    token:{allowance:async()=>0n,approve:async(...args)=>{calls.push(['approve',...args]);return {wait:async()=>{if(changeAt==='approval')changed=true;}};}},
    seal:async(ballot,beacon)=>{calls.push(['seal',ballot,beacon]);if(changeAt==='encryption')changed=true;return {commitment:'0x'+'ab'.repeat(32),sealedChoice:'encrypted'};},
    assertWallet:async()=>{if(changed)throw Error('Wallet changed');}
  };return {options,calls};
}

for(const stage of ['encryption','approval'])test(`wallet replacement during ${stage} never submits a mismatched commitment`,async()=>{
  const {options,calls}=fixture(stage);await assert.rejects(submitLiveBet(options),/Wallet changed/);
  assert.ok(!calls.some(c=>c[0]==='commit'));if(stage==='encryption')assert.ok(!calls.some(c=>c[0]==='approve'));
});

test('live encryption uses the onchain NFT pair and beacon, with exact approval before commitment',async()=>{
  const {options,calls}=fixture();await submitLiveBet(options);
  assert.deepEqual(calls.map(c=>c[0]),['seal','approve','commit']);
  assert.equal(calls[0][1].tokenId,379);assert.equal(calls[0][2],123456);
  assert.equal(calls[1][2],options.amount);assert.equal(calls[2][1],7);
});
