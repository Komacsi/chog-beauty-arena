import {randomInt} from 'node:crypto';
import {parseUnits} from 'ethers';
import {FEE_BPS} from './config.mjs';
export function createState() { return {rounds:[],users:{},points:{},fees:'0'}; }
export function user(state,id) { return state.users[id] ||= {balance:parseUnits('1000',18).toString(),holder:true}; }
export function startRound(state,nfts,now=Date.now()) {
  if(nfts.length<2) throw new Error('Import at least two NFTs');
  const a=randomInt(nfts.length); let b=randomInt(nfts.length-1); if(b>=a)b++;
  const round={id:state.rounds.length+1,nftA:nfts[a].tokenId,nftB:nfts[b].tokenId,endsAt:now+86400000,votesA:0,votesB:0,poolA:'0',poolB:'0',entries:{},settled:false};
  state.rounds.push(round); return round;
}
export function vote(state,id,side,amount,now=Date.now()) {
  const round=state.rounds.at(-1); const account=user(state,id);
  if(!round || now>=round.endsAt || round.settled) throw new Error('Voting closed');
  if(![0,1].includes(side)) throw new Error('Invalid side');
  if(round.entries[id]) throw new Error('Already voted in this round');
  if(amount<0n || amount>BigInt(account.balance)) throw new Error('Insufficient demo balance');
  if(!account.holder && amount===0n) throw new Error('A stake is required without a Chog NFT');
  account.balance=(BigInt(account.balance)-amount).toString();
  round.entries[id]={side,amount:amount.toString(),claimed:false};
  const key=side===0?'poolA':'poolB'; round[key]=(BigInt(round[key])+amount).toString();
  round[side===0?'votesA':'votesB']++;
}
export function settle(state,round,now=Date.now()) {
  if(round.settled)return;
  if(now<round.endsAt)throw new Error('Round active');
  const pool=BigInt(round.poolA)+BigInt(round.poolB);
  round.winner=round.votesA===round.votesB?2:round.votesA>round.votesB?0:1;
  round.refund=round.winner===2 || BigInt(round.poolA)===0n || BigInt(round.poolB)===0n;
  round.distributable=pool.toString();
  round.feeOnClaim=true;
  round.feeBps=FEE_BPS;
  if(round.winner!==2) { const token=round.winner===0?round.nftA:round.nftB; state.points[token]=(state.points[token] || 0)+1; }
  round.settled=true;
}
export function payoutBreakdown(round,id) {
  const entry=round.entries[id];
  const zero={gross:0n,fee:0n,amount:0n};
  if(!round.settled || !entry || entry.claimed || entry.amount==='0')return zero;
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
