import {open,lstat,constants} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Wallet} from 'ethers';
async function privateFile(path,maxBytes,credentialsDirectory){
  const handle=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try{const stat=await handle.stat();if(!stat.isFile() || stat.size>maxBytes)throw Error('Invalid keeper secret file');
    if(process.platform!=='win32' && (stat.mode & 0o077)){
      // systemd presents root-owned 0440 credentials in its protected 0550
      // per-service mount. Accept only that exact location/metadata, never an
      // arbitrary group-readable key or a caller-selected writable directory.
      let protectedCredential=false;
      if(/^\/run\/credentials\/[A-Za-z0-9_.@-]+$/.test(credentialsDirectory || '') && dirname(path)===credentialsDirectory && stat.uid===0 && stat.gid===0 && (stat.mode & 0o777)===0o440){
        const directory=await lstat(credentialsDirectory);
        protectedCredential=directory.isDirectory() && directory.uid===0 && directory.gid===0 && (directory.mode & 0o777)===0o550;
      }
      if(!protectedCredential)throw Error('Keeper secret files must be accessible only to their owner (0600) or protected systemd credentials');
    }
    return await handle.readFile('utf8');
  }finally{await handle.close();}
}
export async function loadKeeperSigner(provider,env=process.env){
  if(env.KEEPER_PRIVATE_KEY)throw Error('Use an encrypted keystore instead of KEEPER_PRIVATE_KEY');
  if(!env.KEEPER_KEYSTORE_PATH || !env.KEEPER_PASSWORD_FILE)throw Error('Set KEEPER_KEYSTORE_PATH and KEEPER_PASSWORD_FILE');
  const json=await privateFile(env.KEEPER_KEYSTORE_PATH,262144,env.CREDENTIALS_DIRECTORY),password=await privateFile(env.KEEPER_PASSWORD_FILE,4096,env.CREDENTIALS_DIRECTORY);
  let wallet;try{wallet=await Wallet.fromEncryptedJson(json,password.replace(/\r?\n$/,''));}catch{throw Error('Cannot unlock keeper keystore');}
  return wallet.connect(provider);
}
