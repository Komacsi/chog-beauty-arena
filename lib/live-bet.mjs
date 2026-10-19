import {toUtf8Bytes} from 'ethers';
import {sealBallot} from './timelock.mjs';

// Use a captured wallet and onchain schedule throughout encryption/approval.
export async function submitLiveBet({arena,token,account,chainId,roundId,side,amount,holderId,assertWallet,notify=()=>{},seal=sealBallot}){
  await assertWallet();
  const round=await arena.getRound(roundId);
  if(round.endsAt===0n || round.settled)throw Error('Battle is unavailable');
  if(side!==0 && side!==1)throw Error('Invalid contender');
  const arenaAddress=await arena.getAddress();
  const sealed=await seal({arena:arenaAddress,chainId,roundId,account,side,tokenId:Number(side===0?round.nftA:round.nftB),amount:amount.toString()},Number(round.beaconRound));
  await assertWallet();
  if(amount>0n && await token.allowance(account,arenaAddress)<amount){
    await assertWallet();notify('Approve the exact CHOG bet');
    await(await token.approve(arenaAddress,amount)).wait();
  }
  await assertWallet();
  // The contract still checks the deadline and ownership at transaction execution.
  notify('Confirm encrypted participation in your wallet');
  return (await arena.commitVote(roundId,sealed.commitment,amount,holderId,toUtf8Bytes(sealed.sealedChoice))).wait();
}
