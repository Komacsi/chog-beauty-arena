import {AbiCoder,getAddress,id,keccak256} from 'ethers';
export const MAX_HOLDER_BATCH=50;
export const HOLDER_VOTE_DOMAIN=id('CHOG_HOLDER_VOTE_V1');
export function normalizeHolderTokens(ids){
  if(!Array.isArray(ids) || ids.length<1 || ids.length>MAX_HOLDER_BATCH)throw Error('Select between 1 and 50 NFTs');
  if(ids.some(value=>!Number.isSafeInteger(value) || value<0))throw Error('Invalid NFT selection');
  const tokens=[...ids].sort((a,b)=>a-b);
  if(tokens.some((value,index)=>index>0 && value===tokens[index-1]))throw Error('Choose each NFT only once');
  return tokens;
}
export function holderTokensHash(ids){return keccak256(AbiCoder.defaultAbiCoder().encode(['uint256[]'],[normalizeHolderTokens(ids)]));}
export function makeHolderCommitment({arena,chainId,roundId,account,side,tokenId,holderTokenIdsHash,salt,amount=0}){
  if(side!==0 && side!==1)throw Error('Invalid side');
  if(BigInt(amount)!==0n)throw Error('NFT votes cannot contain a token bet');
  if(!/^0x[0-9a-fA-F]{64}$/.test(salt) || !/^0x[0-9a-fA-F]{64}$/.test(holderTokenIdsHash))throw Error('Invalid NFT ballot proof');
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['bytes32','address','uint256','uint256','address','uint8','uint256','bytes32','bytes32'],
    [HOLDER_VOTE_DOMAIN,getAddress(arena),chainId,roundId,getAddress(account),side,tokenId,holderTokenIdsHash,salt]
  ));
}
