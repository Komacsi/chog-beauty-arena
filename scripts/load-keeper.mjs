// Offline only. Never imports a provider or credential loader; random disposable signer.
import {readFile,writeFile} from 'node:fs/promises';
import {drandClient} from '../lib/timelock.mjs';
import {loadFixtures,runLoadModel} from '../test-support/keeper-load-model.mjs';
// tlock logs the same public historical beacon on every opening. Omit only that
// known fixture chatter from this benchmark; preserve every other diagnostic.
const originalLog=console.log.bind(console);console.log=(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('beacon received:'))return;originalLog(...args);};
const [output,countArg='1000',rpcArg='25',scenario='all']=process.argv.slice(2),count=Number(countArg),rpcMs=Number(rpcArg);
if(!output||!Number.isSafeInteger(count)||count<10||count>5000||!Number.isFinite(rpcMs)||rpcMs<1||rpcMs>1000)throw Error('Usage: load-keeper NEW_REPORT [10..5000 entries] [1..1000 modeled RPC ms]');
const scenarios=[{name:'measured-latency',rpcMs},{name:'rpc-outages-restarts-malformed',rpcMs,invalid:1000,outages:[[120000,150000],[600000,645000]],ambiguousEvery:31,restartEvery:100},{name:'slow-rpc-250ms',rpcMs:250}];
if(scenario!=='all'&&!scenarios.some(s=>s.name===scenario))throw Error('Unknown load scenario');
const fixture=JSON.parse(await readFile(new URL('../test/fixtures/drand-round-1.json',import.meta.url),'utf8')),client=drandClient(async()=>({ok:true,json:async()=>fixture}));
const {abi}=JSON.parse(await readFile(new URL('../artifacts/BeautyArena.json',import.meta.url),'utf8'));
const onProgress=value=>console.error(JSON.stringify(value)),roundCount=10,started=performance.now();
const fixtures=await loadFixtures(count,roundCount,client,onProgress),cases=[];
for(const options of scenarios.filter(s=>scenario==='all'||s.name===scenario)){onProgress({stage:'scenario',name:options.name});cases.push(await runLoadModel({...options,fixtures,roundCount,client,abi,onProgress}));}
const report={checkedAt:new Date().toISOString(),node:process.version,platform:process.platform,scope:'Offline production-code capacity model, not mainnet',preparedUniqueValidCiphertexts:count,actualElapsedMs:Math.round(performance.now()-started),cases,peakRssKiB:process.resourceUsage().maxRSS,transactionsSent:0,productionCodeChanged:false,limitations:'The modeled block interval is 300 ms and transaction inclusion is optimistic at the next block. RPC delays are constant per scenario. Compare with read-only latency evidence; outlier tails, drand outage, real transaction propagation and chain gas throughput remain unmeasured.'};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
