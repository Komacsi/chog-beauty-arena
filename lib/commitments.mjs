import {AbiCoder, getAddress, keccak256, randomBytes, hexlify} from 'ethers';
import {makeHolderCommitment} from './holder-ballots.mjs';

export const COMMIT_DURATION_MS = 24 * 60 * 60 * 1000;
export const REVEAL_DURATION_MS = 60 * 60 * 1000;
export const DEMO_ARENA = '0x0000000000000000000000000000000000000000';
export const BET_DOMAIN=keccak256(new TextEncoder().encode('CHOG_PAID_BET_V1'));

// A random 256-bit salt is essential: hashing A/B alone is trivially guessable.
export function makeSalt() { return hexlify(randomBytes(32)); }
export function makeCommitment(input) {
  if(input.holderTokenIdsHash!==undefined && input.betNonce!==undefined)throw Error('Ambiguous ballot type');
  if(input.holderTokenIdsHash!==undefined)return makeHolderCommitment(input);
  const {arena, chainId, roundId, account, side, tokenId, amount, salt}=input;
  if(side!==0 && side!==1)throw new Error('Invalid side');
  if(!/^0x[0-9a-fA-F]{64}$/.test(salt))throw new Error('Invalid reveal secret');
  if(input.betNonce!==undefined)return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['bytes32','address','uint256','uint256','address','uint256','uint8','uint256','uint256','bytes32'],
    [BET_DOMAIN,getAddress(arena),chainId,roundId,getAddress(account),input.betNonce,side,tokenId,amount,salt]
  ));
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['address','uint256','uint256','address','uint8','uint256','uint256','bytes32'],
    [getAddress(arena),chainId,roundId,getAddress(account),side,tokenId,amount,salt]
  ));
}
export function phase(round, now=Date.now()) {
  if(!round)return 'none';
  if(round.settled)return 'settled';
  if(round.interrupted)return 'interrupted';
  if(!round.revealEndsAt)return now<round.endsAt?'legacy':'settlement';
  if(now<round.endsAt)return 'commit';
  if(round.unlockAt && now<round.unlockAt)return 'waiting';
  if(now<round.revealEndsAt)return 'reveal';
  return 'settlement';
}
export function secretKey({arena, chainId, roundId, account}) {
  return `chog-reveal:${chainId}:${getAddress(arena).toLowerCase()}:${roundId}:${getAddress(account).toLowerCase()}`;
}
