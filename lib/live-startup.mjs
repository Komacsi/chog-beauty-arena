import {keccak256} from 'ethers';
import {RELEASE_STATUS,assertLiveReleaseAllowed} from './release.mjs';
import {validateChogAsset} from './chog-asset.mjs';

// Fail closed before loading credentials or creating a live index. No env bypass.
export async function validateLiveStartup(provider,address,fromBlock){
  assertLiveReleaseAllowed(address);
  if(!address || String(fromBlock)!==String(RELEASE_STATUS.deploymentBlock))throw Error('Use the verified arena deployment block');
  const code=await provider.getCode(address);
  if(keccak256(code)!=='0xbd74a3b91d02ec76e7420b32847d4972fffc2f685564e4d3907cb6b8c7b7e9b5')throw Error('Live arena runtime differs from the verified deployment');
  return validateChogAsset(provider);
}
