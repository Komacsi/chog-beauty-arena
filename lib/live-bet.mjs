import {toUtf8Bytes} from 'ethers';
import {sealBallot} from './timelock.mjs';
import {holderTokensHash,normalizeHolderTokens} from './holder-ballots.mjs';

export async function submitLiveHolderVotes({arena,account,chainId,roundId,side,tokenIds,assertWallet,notify=()=>{},seal=sealBallot}){
  const ids=normalizeHolderTokens(tokenIds);
  await assertWallet();
  const round=await arena.getRound(roundId);
  if(round.endsAt===0n || round.settled)throw Error('Battle is unavailable');
  if(side!==0 && side!==1)throw Error('Invalid contender');
  if((await Promise.all(ids.map(id=>arena.unstakedVoteUsed(roundId,id)))).some(Boolean))throw Error('A selected NFT has already voted in this battle');
  const sealed=await seal({arena:await arena.getAddress(),chainId,roundId,account,side,tokenId:Number(side===0?round.nftA:round.nftB),amount:'0',holderKey:ids[0],holderTokenIdsHash:holderTokensHash(ids)},Number(round.beaconRound));
  await assertWallet();
  const args=[roundId,ids,sealed.commitment,toUtf8Bytes(sealed.sealedChoice)];
  // Check ownership and current usage again without spending gas.
  await arena.commitHolderVotes.staticCall(...args);
  await assertWallet();notify('Confirm '+ids.length+' encrypted NFT vote'+(ids.length===1?'':'s')+' in your wallet');
  return (await arena.commitHolderVotes(...args)).wait();
}

// Use a captured wallet and onchain schedule throughout encryption/approval.
export async function submitLiveBet({arena,token,account,chainId,roundId,side,amount,assertWallet,notify=()=>{},seal=sealBallot}){
  await assertWallet();
  const round=await arena.getRound(roundId);
  if(round.endsAt===0n || round.settled)throw Error('Battle is unavailable');
  if(side!==0 && side!==1)throw Error('Invalid contender');
  if(amount<5000n*10n**18n)throw Error('Minimum bet is 5,000 CHOG');
  const arenaAddress=await arena.getAddress();
  const betNonce=Number(await arena.betCount(roundId,account));
  const sealed=await seal({arena:arenaAddress,chainId,roundId,account,betNonce,side,tokenId:Number(side===0?round.nftA:round.nftB),amount:amount.toString()},Number(round.beaconRound));
  await assertWallet();
  if(amount>0n && await token.allowance(account,arenaAddress)<amount){
    await assertWallet();notify('Approve the exact CHOG bet');
    await(await token.approve(arenaAddress,amount)).wait();
  }
  await assertWallet();
  // The contract still checks the deadline and ownership at transaction execution.
  const args=[roundId,sealed.commitment,amount,betNonce,toUtf8Bytes(sealed.sealedChoice)];
  await arena.commitVote.staticCall(...args);
  await assertWallet();
  notify('Confirm encrypted participation in your wallet');
  return (await arena.commitVote(...args)).wait();
}
