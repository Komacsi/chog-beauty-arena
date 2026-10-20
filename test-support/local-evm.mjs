// Disposable local EVM only. Official pinned Anvil binary, no production keys.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {JsonRpcProvider} from 'ethers';
const require=createRequire(import.meta.url),children=new Set();
process.once('exit',()=>{for(const child of children)child.kill();});
function binary(){
  const arch={x64:'amd64',arm64:'arm64'}[process.arch];
  if(!arch || !['linux','darwin','win32'].includes(process.platform))throw Error('Unsupported Anvil test platform');
  return require.resolve('@foundry-rs/anvil-'+process.platform+'-'+arch+'/bin/anvil'+(process.platform==='win32'?'.exe':''));
}
export async function startLocalEvm({accounts=6,timestamp,forkUrl,forkBlockNumber}={}){
  const args=['--host','127.0.0.1','--port','0','--chain-id','1337','--hardfork','shanghai','--accounts',String(accounts)];
  if(timestamp!==undefined)args.push('--timestamp',String(timestamp));
  if(forkUrl){
    const url=new URL(forkUrl);
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1')throw Error('Fork must use the local read-only RPC gateway');
    if(!Number.isSafeInteger(forkBlockNumber) || forkBlockNumber<1)throw Error('Pinned fork block required');
    args.push('--fork-url',url.href,'--fork-block-number',String(forkBlockNumber),'--timeout','15000','--retries','1','--no-storage-caching');
  }
  // Native HTTP clients may inherit a Windows system proxy. Local test RPC
  // must stay on loopback, including the read-only fork gateway.
  const child=spawn(binary(),args,{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,NO_PROXY:'127.0.0.1,localhost'}});children.add(child);
  let provider,closed=false;
  async function close(){
    if(closed)return;closed=true;provider?.destroy();
    if(child.pid && child.exitCode===null && child.signalCode===null){
      await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});
    }
    children.delete(child);child.stdout.destroy();child.stderr.destroy();
  }
  try{
    const url=await new Promise((resolve,reject)=>{
      let output='',diagnostics='';const timer=setTimeout(()=>reject(Error('Local Anvil startup timed out')),forkUrl?45000:15000);
      const finish=(fn,value)=>{clearTimeout(timer);fn(value);};
      child.once('error',()=>finish(reject,Error('Cannot start the installed Anvil binary')));
      child.once('exit',code=>finish(reject,Error('Local Anvil exited before startup (code '+code+'): '+diagnostics)));
      child.stdout.on('data',data=>{output=(output+data.toString()).slice(-16384);const match=output.match(/Listening on (127\.0\.0\.1:\d+)/);if(match)finish(resolve,'http://'+match[1]);});
      // Drain startup diagnostics without printing generated disposable keys.
      child.stderr.on('data',data=>{diagnostics=(diagnostics+data.toString()).slice(-4096);});
    });
    provider=new JsonRpcProvider(url,1337,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
    if(timestamp!==undefined)await provider.send('anvil_setBlockTimestampInterval',[0]);
    return {provider,url,close};
  }catch(error){await close();throw error;}
}
