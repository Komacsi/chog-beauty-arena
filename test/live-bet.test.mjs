import test from 'node:test';
import assert from 'node:assert/strict';
import {submitLiveBet,submitLiveHolderVotes} from '../lib/live-bet.mjs';
import {holderTokensHash} from '../lib/holder-ballots.mjs';

test('NFT voting binds the exact selected group and simulates one batch without requesting token approvals',async()=>{
  const {options,calls}=fixture(),commit=async(...args)=>{calls.push(['holder-commit',...args]);return {wait:async()=>{}};};
  commit.staticCall=async(...args)=>{calls.push(['holder-simulate',...args]);};
  options.arena.commitHolderVotes=commit;options.arena.unstakedVoteUsed=async()=>false;
  await submitLiveHolderVotes({...options,tokenIds:[5,1,3]});
  assert.deepEqual(calls.map(c=>c[0]),['seal','holder-simulate','holder-commit']);
  assert.equal(calls[0][1].holderTokenIdsHash,holderTokensHash([1,3,5]));assert.equal(calls[0][1].amount,'0');
  assert.deepEqual(calls[2][2],[1,3,5]);
});
test('NFT voting rejects already used tokens and wallet changes before any signature',async()=>{
  for(const scenario of ['used','encryption']){
    const {options,calls}=fixture(scenario);
    options.arena.unstakedVoteUsed=async()=>scenario==='used';
    options.arena.commitHolderVotes=async()=>{throw Error('Should not submit');};
    await assert.rejects(submitLiveHolderVotes({...options,tokenIds:[1]}),scenario==='used'?/already voted/:/Wallet changed/);
    assert.ok(!calls.some(c=>c[0]==='approve' || c[0]==='commit'));
  }
});

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
