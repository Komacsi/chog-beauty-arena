import {open,constants} from 'node:fs/promises';
import {Wallet} from 'ethers';
async function privateFile(path,maxBytes){
  const handle=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try{const stat=await handle.stat();if(!stat.isFile() || stat.size>maxBytes)throw Error('Invalid keeper secret file');
    if(process.platform!=='win32' && (stat.mode & 0o077))throw Error('Keeper secret files must be accessible only to their owner (0600)');
    return await handle.readFile('utf8');
  }finally{await handle.close();}
}
export async function loadKeeperSigner(provider,env=process.env){
  if(env.KEEPER_PRIVATE_KEY)throw Error('Use an encrypted keystore instead of KEEPER_PRIVATE_KEY');
  if(!env.KEEPER_KEYSTORE_PATH || !env.KEEPER_PASSWORD_FILE)throw Error('Set KEEPER_KEYSTORE_PATH and KEEPER_PASSWORD_FILE');
  const json=await privateFile(env.KEEPER_KEYSTORE_PATH,262144),password=await privateFile(env.KEEPER_PASSWORD_FILE,4096);
  let wallet;try{wallet=await Wallet.fromEncryptedJson(json,password.replace(/\r?\n$/,''));}catch{throw Error('Cannot unlock keeper keystore');}
  return wallet.connect(provider);
}
