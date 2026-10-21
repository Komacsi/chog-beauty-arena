import test from 'node:test';
import assert from 'node:assert/strict';
import {webOrigins,allowedWebOrigin} from '../lib/web-origin.mjs';
test('Netlify proxy accepts only an exact configured frontend origin',()=>{
  const host='chog-api.72-56-98-23.sslip.io',allowed=webOrigins('https://arena.netlify.app');
  assert.equal(allowedWebOrigin('https://arena.netlify.app',host,allowed),true);
  for(const origin of ['https://another.netlify.app','https://arena.netlify.app.evil.example','http://arena.netlify.app','https://arena.netlify.app/','null','https://user:password@arena.netlify.app'])assert.equal(allowedWebOrigin(origin,host,allowed),false);
  assert.equal(allowedWebOrigin('http://localhost:3104','localhost:3104'),true);
  assert.equal(allowedWebOrigin(undefined,host,allowed),true);
  for(const origin of ['*','http://arena.netlify.app','https://arena.netlify.app/path','https://arena.netlify.app/'])assert.throws(()=>webOrigins(origin));
});
