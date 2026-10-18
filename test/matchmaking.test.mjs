import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../lib/demo.mjs';
function fixture(){const state=d.createState();for(const [n,id]of [[1,'a'],[2,'b'],[3,'a'],[4,'b']])state.ownership[n]=d.user(state,id).address;return state;}
test('only owned available NFTs create requests; creating does not start a round',()=>{
  const s=fixture();assert.throws(()=>d.createChallenge(s,'b',1),/owner/);assert.throws(()=>d.createChallenge(s,'a',999),/owner/);
  d.createChallenge(s,'a',1);assert.equal(s.rounds.length,0);assert.throws(()=>d.createChallenge(s,'a',1),/busy/);assert.throws(()=>d.acceptChallenge(s,'a',1,3),/Different holder/);
  d.createChallenge(s,'b',2);assert.throws(()=>d.acceptChallenge(s,'b',1,2),/busy/);
});
test('creator cancels a pending request; acceptance is final and starts exactly 24 hours',()=>{
  const s=fixture();d.createChallenge(s,'a',1,1000);assert.throws(()=>d.cancelChallenge(s,'b',1),/Creator only/);d.cancelChallenge(s,'a',1);assert.equal(d.tokenAvailable(s,1),true);assert.throws(()=>d.acceptChallenge(s,'b',1,2),/closed/);
  d.createChallenge(s,'a',1,2000);const r=d.acceptChallenge(s,'b',2,2,10000);assert.equal(r.endsAt,10000+24*60*60*1000);assert.equal(d.tokenAvailable(s,1),false);assert.equal(d.tokenAvailable(s,2),false);assert.throws(()=>d.cancelChallenge(s,'a',2),/closed/);assert.throws(()=>d.createChallenge(s,'b',2),/busy/);
  d.settle(s,r,r.unlockAt);assert.equal(d.tokenAvailable(s,1),true);assert.equal(d.tokenAvailable(s,2),true);d.createChallenge(s,'a',1);assert.deepEqual(s.points,{});assert.deepEqual(s.losses,{});
});
test('ownership is checked again on acceptance and transferred requests can be cleared',()=>{
  const s=fixture();d.createChallenge(s,'a',1);s.ownership[1]=d.user(s,'new').address;assert.throws(()=>d.acceptChallenge(s,'b',1,2),/no longer/);d.cancelChallenge(s,'b',1);d.createChallenge(s,'new',1);
  assert.throws(()=>d.acceptChallenge(s,'b',2,3),/owner/);
});
test('independent pairs run concurrently and a settled pair is reusable',()=>{
  const s=fixture();d.createChallenge(s,'a',1);const first=d.acceptChallenge(s,'b',1,2);d.createChallenge(s,'a',3);const second=d.acceptChallenge(s,'b',2,4);
  assert.equal(s.rounds.length,2);d.settle(s,first,first.unlockAt);assert.equal(d.tokenAvailable(s,1),true);assert.equal(d.tokenAvailable(s,3),false);assert.equal(second.settled,false);d.createChallenge(s,'a',1);
});
