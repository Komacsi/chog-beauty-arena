import {keccak256} from 'ethers';
import {RELEASE_STATUS,assertLiveReleaseAllowed} from './release.mjs';
import {validateChogAsset} from './chog-asset.mjs';

// Fail closed before loading credentials or creating a live index. No env bypass.
export async function validateLiveStartup(provider,address,fromBlock){
  assertLiveReleaseAllowed(address);
  if(!address || String(fromBlock)!==String(RELEASE_STATUS.deploymentBlock))throw Error('Use the verified arena deployment block');
  const code=await provider.getCode(address);
  if(keccak256(code)!==RELEASE_STATUS.runtimeCodeHash)throw Error('Live arena runtime differs from the verified deployment');
  return validateChogAsset(provider);
}
