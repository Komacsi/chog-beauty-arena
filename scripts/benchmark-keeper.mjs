// Offline host benchmark. Historical signed drand fixture; no provider, wallet or signing.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sealBallot,openBallot,drandClient} from '../lib/timelock.mjs';
const fixture=JSON.parse(await readFile(new URL('../test/fixtures/drand-round-1.json',import.meta.url),'utf8'));
const client=drandClient(async()=>({ok:true,json:async()=>fixture}));
const count=Number(process.argv[2] || 32);
if(!Number.isSafeInteger(count)||count<1||count>128)throw Error('Sample count must be 1..128');
const account='0x1111111111111111111111111111111111111111',arena='0x2222222222222222222222222222222222222222';
const start=performance.now(),samples=[];
for(let nonce=0;nonce<count;nonce++){
  const ballot={account,arena,chainId:1337,roundId:1,betNonce:nonce,side:nonce%2,tokenId:nonce%2?2:1,amount:'5000000000000000000000'};
  const sealed=await sealBallot(ballot,1,client),expected={...ballot,commitment:sealed.commitment,beaconRound:1,nftA:1,nftB:2};
  const then=performance.now();
  const opened=await openBallot(sealed.sealedChoice,expected,0,client);
  samples.push(performance.now()-then);assert.equal(opened.betNonce,nonce);
  if(nonce===0)await assert.rejects(openBallot(sealed.sealedChoice,{...expected,betNonce:999},0,client));
}
const invalidStart=performance.now();
for(let i=0;i<1000;i++)await assert.rejects(openBallot('invalid-ciphertext',{beaconRound:1},0,client));
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),platform:process.platform,node:process.version,samples:count,signedProductionDrandFixture:true,eachCommitmentAndNonceVerified:true,wrongNonceRejected:true,invalidCiphertextsRejected:1000,invalidBatchMs:Math.round(performance.now()-invalidStart),decryptMeanMs:Math.round(samples.reduce((a,b)=>a+b,0)/count),decryptP95Ms:Math.round(samples[Math.ceil(count*.95)-1]),elapsedMs:Math.round(performance.now()-start),realTransactionsSent:0,limitations:'Offline CPU/crypto measurement only. Not mainnet throughput: RPC, confirmations, signing, gas and concurrent production load are excluded. Historical drand round is already public; future-secrecy timing is tested separately.'},null,2));
