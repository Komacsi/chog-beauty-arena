import test from 'node:test';
import assert from 'node:assert/strict';
import {startReadOnlyForkRpc} from '../test-support/fork-rpc.mjs';
test('fork gateway rejects broadcasts and admin calls before reaching upstream',async()=>{
  const calls=[],gateway=await startReadOnlyForkRpc({send:async(method,params)=>{calls.push({method,params});return method==='eth_getBlockByNumber'?{number:'0x1'}:'0x8f';}});
  const rpc=async(method,params=[])=>{const r=await fetch(gateway.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return r.json();};
  try{
    for(const method of ['eth_sendRawTransaction','eth_sendTransaction','anvil_setBalance','evm_mine'])assert.match((await rpc(method)).error.message,/blocked/);
    assert.equal(calls.length,0);
    assert.equal((await rpc('eth_chainId')).result,'0x8f');
    assert.deepEqual((await rpc('eth_getBlockByNumber',['latest',false])).result,{number:'0x1',withdrawals:[]});
    assert.equal(calls.length,2);
  }finally{await gateway.close();}
});
