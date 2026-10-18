import tlock from 'tlock-js';
import {getAddress} from 'ethers';
import verification from 'drand-client/beacon-verification.js';
import {makeCommitment, makeSalt} from './commitments.mjs';
const {timelockEncrypt,timelockDecrypt,Buffer}=tlock;

// Pinned production quicknet parameters, verified against drand's /info endpoint.
export const DRAND_INFO=Object.freeze({public_key:'83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',period:3,genesis_time:1692803367,hash:'52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',groupHash:'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',schemeID:'bls-unchained-g1-rfc9380',metadata:{beaconID:'quicknet'}});
export const UNLOCK_DELAY_MS=5*60*1000;
export function unlockSchedule(endsAt,delay=UNLOCK_DELAY_MS){
  const beaconRound=Math.ceil(((endsAt+delay)/1000-DRAND_INFO.genesis_time)/DRAND_INFO.period)+1;
  const unlockAt=(DRAND_INFO.genesis_time+(beaconRound-1)*DRAND_INFO.period)*1000;
  return {beaconRound,unlockAt,revealEndsAt:unlockAt+60*60*1000};
}
export function drandClient(fetcher=globalThis.fetch){
  const cache=new Map();
  return {
    options:{disableBeaconVerification:false,noCache:false,chainVerificationParams:{chainHash:DRAND_INFO.hash,publicKey:DRAND_INFO.public_key}},
    chain:()=>({baseUrl:`https://api.drand.sh/${DRAND_INFO.hash}`,info:async()=>DRAND_INFO}),
    async get(round){
      if(cache.has(round))return cache.get(round);
      let last;
      for(const host of ['https://api.drand.sh','https://api2.drand.sh','https://api3.drand.sh']){
        try{const response=await fetcher(`${host}/${DRAND_INFO.hash}/public/${round}`,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error(`drand HTTP ${response.status}`);const beacon=await response.json();if(!await verification.verifyBeacon(DRAND_INFO,beacon,round))throw Error('Invalid drand signature');cache.set(round,beacon);return beacon;}catch(error){last=error;}
      }
      throw last;
    },
    async latest(){throw Error('Explicit pinned drand rounds are required');}
  };
}
export async function sealBallot(input,beaconRound,client=drandClient()){
  const ballot={...input,arena:getAddress(input.arena),account:getAddress(input.account),amount:String(input.amount),salt:input.salt || makeSalt()};
  const commitment=makeCommitment(ballot);
  // Encryption is local. Neither the side nor the salt is sent to drand.
  const json=JSON.stringify(ballot);
  if(Buffer.byteLength(json)>1024)throw Error('Ballot too large');
  // Fixed-size plaintext prevents ciphertext length revealing different token-ID lengths.
  const padded=Buffer.alloc(1024,32);padded.write(json,'utf8');
  const sealedChoice=await timelockEncrypt(beaconRound,padded,client);
  if(Buffer.byteLength(sealedChoice)>4096)throw Error('Encrypted ballot too large');
  return {commitment,sealedChoice};
}
export async function openBallot(sealedChoice,expected,unlockAt,client=drandClient(),now=Date.now()){
  if(now<unlockAt)throw Error('Ballot cannot be opened before its unlock time');
  if(!Number.isSafeInteger(expected.beaconRound) || expected.beaconRound<1)throw Error('Expected drand round is required');
  // Ciphertext is untrusted: do not let its header choose arbitrary beacon requests.
  const pinnedClient={...client,get:async round=>{
    if(round!==expected.beaconRound)throw Error('Ballot drand round mismatch');
    return client.get(round);
  }};
  const plaintext=await timelockDecrypt(sealedChoice,pinnedClient);
  const ballot=JSON.parse(plaintext.toString('utf8'));
  for(const key of ['arena','account'])if(getAddress(ballot[key])!==getAddress(expected[key]))throw Error(`Ballot ${key} mismatch`);
  for(const key of ['chainId','roundId','amount'])if(BigInt(ballot[key])!==BigInt(expected[key]))throw Error(`Ballot ${key} mismatch`);
  if(makeCommitment(ballot).toLowerCase()!==expected.commitment.toLowerCase())throw Error('Ballot commitment mismatch');
  if(expected.nftA!==undefined && ballot.tokenId!==(ballot.side===0?expected.nftA:expected.nftB))throw Error('Ballot NFT mismatch');
  return ballot;
}
