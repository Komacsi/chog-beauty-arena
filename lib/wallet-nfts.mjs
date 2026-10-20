import {getAddress} from 'ethers';

export const CHOG_COLLECTION='0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
export const COLLECTION_SIZE=1969;
export const ownershipAbi=[
  'function balanceOf(address) view returns(uint256)',
  'function tokensOfOwner(address) view returns(uint256[])'
];

// Chog Genesis exposes tokensOfOwner even though ERC721Enumerable is absent.
// Both reads use one block; artwork/metadata never participates in discovery.
export async function discoverOwnedChogs({collection,account,blockTag,assertWallet=async()=>{}}){
  if(getAddress(await collection.getAddress())!==getAddress(CHOG_COLLECTION))throw Error('Unexpected NFT collection');
  account=getAddress(account);await assertWallet();
  const [tokens,balance]=await Promise.all([collection.tokensOfOwner(account,{blockTag}),collection.balanceOf(account,{blockTag})]);
  if(tokens.length>COLLECTION_SIZE || BigInt(tokens.length)!==BigInt(balance))throw Error('Incomplete NFT ownership response. Please retry.');
  const ids=tokens.map(value=>Number(value));
  if(ids.some(id=>!Number.isSafeInteger(id) || id<1 || id>COLLECTION_SIZE) || new Set(ids).size!==ids.length)throw Error('Invalid NFT ownership response');
  await assertWallet();return ids.sort((a,b)=>a-b);
}
