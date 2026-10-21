import {exportKeeperKeystore} from '../lib/keystore-export.mjs';
import {resolve} from 'node:path';
try{
  if(process.argv.length!==3 || process.stdin.isTTY)throw Error('Use the local PowerShell wizard');
  let input='',bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16384)throw Error('Input too large');input+=chunk;}
  const {privateKey,password}=JSON.parse(Buffer.from(input.trim(),'base64').toString('utf8'));
  const result=await exportKeeperKeystore({privateKey,password,expectedAddress:'0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908',outputFile:resolve(process.argv[2])});
  console.log(JSON.stringify(result));
}catch{
  // ethers errors may embed a supplied key. Never print exception details.
  console.error('Keystore export failed. Check keeper address, password length and a new writable output path. No secret details are logged.');
  process.exitCode=1;
}
