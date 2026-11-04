import assert from 'node:assert/strict';
import test from 'node:test';

import { applyApiSecurityHeaders } from '../functions/api/_response-security.js';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';

test('API baseline adds missing browser hardening without changing body or status',async()=>{
  const original=new Response('payload',{status:207,headers:{'Content-Type':'text/plain'}});
  const hardened=applyApiSecurityHeaders(original);
  assert.equal(hardened.status,207);
  assert.equal(await hardened.text(),'payload');
  assert.equal(hardened.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(hardened.headers.get('X-Frame-Options'),'DENY');
  assert.equal(hardened.headers.get('Referrer-Policy'),'same-origin');
  assert.equal(hardened.headers.get('Permissions-Policy'),'camera=(), microphone=(), geolocation=()');
  assert.equal(hardened.headers.get('Strict-Transport-Security'),'max-age=31536000; includeSubDomains');
  assert.equal(hardened.headers.get('Cache-Control'),'no-store');
});

test('API baseline never overwrites endpoint CORS cache or stricter referrer policy',async()=>{
  const original=new Response('image',{
    headers:{
      'Access-Control-Allow-Origin':'https://ess.example.test',
      'Access-Control-Allow-Credentials':'true',
      'Vary':'Origin',
      'Cache-Control':'private, max-age=3600',
      'Referrer-Policy':'no-referrer',
      'Cross-Origin-Resource-Policy':'cross-origin',
    },
  });
  const hardened=applyApiSecurityHeaders(original);
  assert.equal(hardened.headers.get('Access-Control-Allow-Origin'),'https://ess.example.test');
  assert.equal(hardened.headers.get('Access-Control-Allow-Credentials'),'true');
  assert.equal(hardened.headers.get('Vary'),'Origin');
  assert.equal(hardened.headers.get('Cache-Control'),'private, max-age=3600');
  assert.equal(hardened.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(hardened.headers.get('Cross-Origin-Resource-Policy'),'cross-origin');
});

test('API baseline does not invent a global CORP policy',()=>{
  const hardened=applyApiSecurityHeaders(new Response('ok'));
  assert.equal(hardened.headers.has('Cross-Origin-Resource-Policy'),false);
});

test('API middleware applies baseline to direct responses and preserves correlation id',async()=>{
  const response=await apiMiddleware({
    request:new Request('https://proqpay.msg-os.com/api/direct-test',{
      headers:{'X-Request-Id':'REQ-BASELINE-001'},
    }),
    env:{},
    next:async()=>new Response('direct',{status:200}),
  });
  assert.equal(response.headers.get('X-Request-Id'),'REQ-BASELINE-001');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  assert.equal(response.headers.get('Permissions-Policy'),'camera=(), microphone=(), geolocation=()');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('API middleware preserves endpoint-specific cache and referrer semantics',async()=>{
  const response=await apiMiddleware({
    request:new Request('https://proqpay.msg-os.com/api/client-logo?id=CLIENT-1'),
    env:{},
    next:async()=>new Response('logo',{
      headers:{
        'Cache-Control':'private, max-age=3600',
        'Referrer-Policy':'no-referrer',
        'Access-Control-Allow-Origin':'https://proqpay.msg-os.com',
        'Vary':'Origin',
      },
    }),
  });
  assert.equal(response.headers.get('Cache-Control'),'private, max-age=3600');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://proqpay.msg-os.com');
  assert.equal(response.headers.get('Vary'),'Origin');
});

test('provider webhook-style direct response gets baseline without browser CORS being injected',async()=>{
  const response=await apiMiddleware({
    request:new Request('https://proqpay.msg-os.com/api/payment-gateway-webhook',{method:'POST'}),
    env:{},
    next:async()=>new Response(JSON.stringify({ok:true}),{
      headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
    }),
  });
  assert.equal(response.headers.has('Access-Control-Allow-Origin'),false);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
});
