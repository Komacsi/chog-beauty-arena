import {Wallet,getAddress} from 'ethers';
import {open} from 'node:fs/promises';
// Offline only: no provider, RPC, environment keys or signing transactions.
export async function exportKeeperKeystore({privateKey,password,expectedAddress,outputFile}){
  if(typeof privateKey!=='string' || !/^(0x)?[a-fA-F0-9]{64}$/.test(privateKey))throw Error('Expected one account private key');
  if(typeof password!=='string' || password.length<16 || password.length>1024)throw Error('Use a password of 16–1024 characters');
  const wallet=new Wallet(privateKey.startsWith('0x')?privateKey:'0x'+privateKey);
  if(wallet.address!==getAddress(expectedAddress))throw Error('Private key does not match the keeper address');
  const json=await wallet.encrypt(password);
  // Exclusive creation, owner-only POSIX permissions. Windows wizard protects the directory ACL first.
  const file=await open(outputFile,'wx',0o600);
  try{await file.writeFile(json,{encoding:'utf8'});await file.sync();}finally{await file.close();}
  return {address:wallet.address,outputFile};
}
