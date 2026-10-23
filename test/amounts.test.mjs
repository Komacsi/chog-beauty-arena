import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import {formatTokenAmount} from '../lib/amounts.mjs';

test('compact display rounds only the presentation and retains large integer digits',()=>{
  assert.equal(formatTokenAmount(parseUnits('5000.000000000000000001',18)),'5,000');
  assert.equal(formatTokenAmount(1n),'<0.001');
  assert.equal(formatTokenAmount(900719925474099312345678901234567890n),'900,719,925,474,099,312.346');
  assert.equal(formatTokenAmount(parseUnits('24750.125',18)),'24,750.125');
  assert.equal(formatTokenAmount(parseUnits('24750.9996',18)),'24,751');
  assert.equal(formatTokenAmount(parseUnits('5000.0005',18)),'5,000.001');
  assert.equal(formatTokenAmount(0n),'0');
});
