import {parseUnits,keccak256,toUtf8Bytes,getAddress} from 'ethers';
import {FEE_BPS,CHAIN_ID,MIN_STAKE} from './config.mjs';
import {COMMIT_DURATION_MS,DEMO_ARENA,makeCommitment} from './commitments.mjs';
import {unlockSchedule} from './timelock.mjs';
export function createState() { return {rounds:[],challenges:[],ownership:{},users:{},points:{},losses:{},draws:{},fees:'0',matchmakingVersion:1,minStakeVersion:1}; }
export function user(state,id) {const u=state.users[id] ||= {balance:parseUnits('100000',18).toString(),holder:true};u.address ||= getAddress('0x'+keccak256(toUtf8Bytes('arena-demo:'+id)).slice(-40));return u;}
export function migrateMinimumStake(state){
  if(state.minStakeVersion)return false;
  // Add play money once; retain historical stakes, payouts, results and claims.
  for(const u of Object.values(state.users))u.balance=(BigInt(u.balance)+parseUnits('99000',18)).toString();
  state.minStakeVersion=1;return true;
}
export function ownedTokens(state,id){const address=user(state,id).address;return Object.entries(state.ownership || {}).filter(([,owner])=>owner===address).map(([token])=>Number(token));}
export function tokenAvailable(state,tokenId){return !state.challenges.some(c=>!c.closed && c.tokenId===tokenId) && !state.rounds.some(r=>!r.settled && [r.nftA,r.nftB].includes(tokenId));}
export function createChallenge(state,id,tokenId,now=Date.now()){
  if(!Number.isSafeInteger(tokenId) || state.ownership[tokenId]!==user(state,id).address)throw Error('Not NFT owner');
  if(!tokenAvailable(state,tokenId))throw Error('NFT busy');
  const c={id:state.challenges.length+1,creator:user(state,id).address,tokenId,createdAt:now,roundId:0,closed:false};state.challenges.push(c);return c;
}
export function cancelChallenge(state,id,challengeId){
  const c=state.challenges.find(c=>c.id===challengeId);if(!c || c.closed)throw Error('Challenge closed');
  if(c.creator!==user(state,id).address && state.ownership[c.tokenId]===c.creator)throw Error('Creator only');c.closed=true;
}
export function acceptChallenge(state,id,challengeId,tokenId,now=Date.now(),fast=false){
  const c=state.challenges.find(c=>c.id===challengeId);if(!c || c.closed)throw Error('Challenge closed');
  if(c.creator===user(state,id).address)throw Error('Different holder required');
  if(state.ownership[c.tokenId]!==c.creator)throw Error('Creator no longer owns NFT');
  if(!Number.isSafeInteger(tokenId) || state.ownership[tokenId]!==user(state,id).address)throw Error('Not NFT owner');
  if(!tokenAvailable(state,tokenId))throw Error('NFT busy');
  const round=startRound(state,c.tokenId,tokenId,now,fast);c.closed=true;c.roundId=round.id;return round;
}
function startRound(state,nftA,nftB,now,fast) {
  const endsAt=now+(fast?120000:COMMIT_DURATION_MS);
  const round={id:state.rounds.length+1,nftA,nftB,startedAt:now,endsAt,...unlockSchedule(endsAt,fast?5000:undefined),protocolVersion:4,totalCommitted:'0',committedCount:0,revealedCount:0,votesA:0,votesB:0,poolA:'0',poolB:'0',entries:{},settled:false};
  state.rounds.push(round); return round;
}
export function commitVote(state,id,{commitment,sealedChoice,amount,roundId},now=Date.now()) {
  const round=roundId===undefined?state.rounds.at(-1):state.rounds.find(r=>r.id===roundId); const account=user(state,id);
  if(!round || !round.revealEndsAt || now>=round.endsAt || round.settled) throw new Error('Betting closed');
  if(!/^0x[0-9a-fA-F]{64}$/.test(commitment) || /^0x0+$/.test(commitment))throw new Error('Invalid commitment');
  if(typeof sealedChoice!=='string' || !sealedChoice.length || Buffer.byteLength(sealedChoice)>4096)throw new Error('Invalid encrypted ballot');
  amount=BigInt(amount);
  if(round.entries[id]) throw new Error('Already voted in this round');
  if(amount>0n && amount<MIN_STAKE)throw new Error('Minimum bet is 5000 CHOG');
  if(amount<0n || amount>BigInt(account.balance)) throw new Error('Insufficient demo balance');
  if(!account.holder && amount===0n) throw new Error('A bet is required without a Chog NFT');
  account.balance=(BigInt(account.balance)-amount).toString();
  round.entries[id]={commitment,sealedChoice,amount:amount.toString(),committed:true,revealed:false,claimed:false};
  round.totalCommitted=(BigInt(round.totalCommitted)+amount).toString();round.committedCount++;
}
export function revealVote(state,id,ballot,now=Date.now()){
  const round=state.rounds.find(r=>r.id===Number(ballot.roundId)),entry=round?.entries[id];
  if(!round || now<round.unlockAt || now>=round.revealEndsAt || round.settled)throw Error('Not revealing');
  if(!entry || entry.revealed)throw Error('Invalid reveal');
  if(ballot.account!==user(state,id).address || ballot.arena!==DEMO_ARENA || BigInt(ballot.chainId)!==BigInt(CHAIN_ID) || BigInt(ballot.roundId)!==BigInt(round.id) || BigInt(ballot.amount)!==BigInt(entry.amount))throw Error('Ballot domain mismatch');
  if(![0,1].includes(ballot.side) || ballot.tokenId!==(ballot.side===0?round.nftA:round.nftB) || makeCommitment(ballot)!==entry.commitment)throw Error('Commitment mismatch');
  entry.side=ballot.side;entry.revealed=true;round.revealedCount++;
  const key=ballot.side===0?'poolA':'poolB';round[key]=(BigInt(round[key])+BigInt(entry.amount)).toString();round[ballot.side===0?'votesA':'votesB']++;
}
export function settle(state,round,now=Date.now()) {
  if(round.settled)return;
  if(now<(round.unlockAt || round.endsAt))throw new Error('Round active');
  if(round.revealEndsAt && round.revealedCount!==round.committedCount && now<round.revealEndsAt)throw new Error('Reveal incomplete');
  const pool=BigInt(round.poolA)+BigInt(round.poolB);
  round.winner=round.votesA===round.votesB?2:round.votesA>round.votesB?0:1;
  round.refund=round.winner===2 || BigInt(round.poolA)===0n || BigInt(round.poolB)===0n;
  // Existing rounds retain the protocol under which they were created.
  if((round.protocolVersion || 0)<4 && round.revealEndsAt && round.revealedCount!==round.committedCount){round.cancelled=true;round.refund=true;round.winner=2;}
  round.distributable=pool.toString();
  round.feeOnClaim=true;
  round.feeBps=FEE_BPS;
  if(round.winner!==2) { const token=round.winner===0?round.nftA:round.nftB,loser=round.winner===0?round.nftB:round.nftA; state.points[token]=(state.points[token] || 0)+1;state.losses[loser]=(state.losses[loser] || 0)+1; }
  else if(!round.cancelled && round.votesA+round.votesB>1){for(const token of [round.nftA,round.nftB])state.draws[token]=(state.draws[token] || 0)+1;}
  round.settled=true;
}
export function payoutBreakdown(round,id) {
  const entry=round.entries[id];
  const zero={gross:0n,fee:0n,amount:0n};
  if(!round.settled || !entry || entry.claimed || entry.amount==='0')return zero;
  if(round.protocolVersion>=4 && !entry.revealed)return {gross:BigInt(entry.amount),fee:0n,amount:BigInt(entry.amount)};
  if(!round.refund && entry.side!==round.winner)return zero;
  // Historical demo rounds keep their recorded pool-first settlement amounts.
  if(!round.feeOnClaim){
    const denominator=round.refund?BigInt(round.poolA)+BigInt(round.poolB):BigInt(round.winner===0?round.poolA:round.poolB);
    const amount=BigInt(entry.amount)*BigInt(round.distributable)/denominator;
    return {gross:amount,fee:0n,amount};
  }
  if(round.refund)return {gross:BigInt(entry.amount),fee:0n,amount:BigInt(entry.amount)};
  const winningPool=BigInt(round.winner===0?round.poolA:round.poolB);
  const losingPool=BigInt(round.winner===0?round.poolB:round.poolA);
  const gross=BigInt(entry.amount)+BigInt(entry.amount)*losingPool/winningPool;
  const fee=gross*BigInt(round.feeBps)/10000n;
  return {gross,fee,amount:gross-fee};
}
export function payout(round,id) {return payoutBreakdown(round,id).amount;}
export function claim(state,round,id) {
  const {amount,fee}=payoutBreakdown(round,id); if(amount===0n)throw new Error('Nothing to claim');
  round.entries[id].claimed=true;
  state.fees=(BigInt(state.fees)+fee).toString();
  const account=user(state,id); account.balance=(BigInt(account.balance)+amount).toString(); return amount;
}
