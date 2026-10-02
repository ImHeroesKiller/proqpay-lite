import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

function base32Decode(input){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean=String(input||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
  let bits=0, value=0;
  const bytes=[];
  for(const char of clean){
    const index=alphabet.indexOf(char);
    if(index<0) continue;
    value=(value<<5)|index;
    bits+=5;
    if(bits>=8){
      bytes.push((value>>>(bits-8))&255);
      bits-=8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret,now=Date.now()){
  const counter=Math.floor(now/30000);
  const bytes=Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac('sha1',base32Decode(secret)).update(bytes).digest();
  const offset=digest[digest.length-1]&15;
  const binary=((digest[offset]&127)<<24)|((digest[offset+1]&255)<<16)|((digest[offset+2]&255)<<8)|(digest[offset+3]&255);
  return String(binary%1000000).padStart(6,'0');
}

async function attachVirtualPasskey(page){
  const client=await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator',{
    options:{
      protocol:'ctap2',
      transport:'internal',
      hasResidentKey:true,
      hasUserVerification:true,
      isUserVerified:true,
      automaticPresenceSimulation:true,
    },
  });
}

async function jsonPost(page,url,body){
  return page.evaluate(async({url,body})=>{
    const response=await fetch(url,{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    return {status:response.status,body:await response.json().catch(()=>({}))};
  },{url,body});
}

async function createBrowserPasskey(page,options){
  return page.evaluate(async(input)=>{
    const decode=(value)=>{
      const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
      const padded=normalized+'='.repeat((4-normalized.length%4)%4);
      const binary=atob(padded);
      return Uint8Array.from(binary,c=>c.charCodeAt(0)).buffer;
    };
    const encode=(value)=>{
      const bytes=value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
      let binary='';
      for(const byte of bytes) binary+=String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
    };
    const user=input.user||{};
    const publicKey={
      ...input,
      challenge:decode(input.challenge),
      user:{...user,id:decode(user.id)},
      excludeCredentials:Array.isArray(input.excludeCredentials)
        ? input.excludeCredentials.map(item=>({...item,id:decode(item.id)}))
        : undefined,
    };
    const credential=await navigator.credentials.create({publicKey});
    if(!credential) throw new Error('Virtual passkey registration returned no credential');
    const response=credential.response;
    return {
      id:credential.id,
      rawId:encode(credential.rawId),
      type:credential.type,
      authenticatorAttachment:credential.authenticatorAttachment,
      clientExtensionResults:credential.getClientExtensionResults(),
      response:{
        clientDataJSON:encode(response.clientDataJSON),
        attestationObject:encode(response.attestationObject),
        transports:typeof response.getTransports==='function'?response.getTransports():[],
      },
    };
  },options);
}

async function secureUatLogin(page){
  test.skip(!hasCredentials,'Dedicated UAT credentials are required for P4 closure');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await attachVirtualPasskey(page);

  const enrollment=await jsonPost(page,'/api/security-mfa',{
    action:'ENROLL_START',email,password,
  });
  expect(enrollment.status,'Dedicated UAT account must allow fresh MFA bootstrap after deployment').toBe(200);
  const secret=String(enrollment.body?.secret||'');
  expect(secret.length).toBeGreaterThan(20);

  const activated=await jsonPost(page,'/api/security-mfa',{
    action:'ENROLL_ACTIVATE',email,password,code:totp(secret),
  });
  expect(activated.status).toBe(200);

  const login=await jsonPost(page,'/api/login',{
    email,password,mfaCode:totp(secret),
  });
  expect(login.status).toBe(200);
  expect(login.body?.security?.passkeyEnrollmentRequired).toBe(true);

  const options=await jsonPost(page,'/api/security-passkey',{action:'REGISTER_OPTIONS'});
  expect(options.status).toBe(200);
  const credential=await createBrowserPasskey(page,options.body?.options||{});
  const verified=await jsonPost(page,'/api/security-passkey',{
    action:'REGISTER_VERIFY',
    challengeId:options.body?.challengeId,
    response:credential,
    label:'P4 CI Virtual Passkey',
  });
  expect(verified.status).toBe(200);

  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:15000});

  const identity=await page.evaluate(async()=>{
    const response=await fetch('/api/me',{credentials:'same-origin'});
    return {status:response.status,body:await response.json().catch(()=>({}))};
  });
  expect(identity.status).toBe(200);
  expect(String(identity.body?.role||'')).not.toBe('');
  return {identity,secret};
}

test.describe.serial('P4 production closure regression',()=>{
  test('canonical production shell, health and hardened security headers are ready',async({page,request,baseURL})=>{
    const response=await page.goto('/',{waitUntil:'networkidle'});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText(/ProQPay/i);

    const health=await request.get(`${baseURL}/api/health`);
    expect(health.status()).toBe(200);
    const body=await health.json();
    expect(body.ready).toBe(true);
    expect(body.database).toBe('d1');
    expect(body.auth_mode).toBe('session');

    const headers=response?.headers()||{};
    const csp=headers['content-security-policy']||'';
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).not.toMatch(/(?:^|;\\s*)script-src\\s[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/(?:^|;\\s*)style-src\\s[^;]*'unsafe-inline'/);
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['access-control-allow-origin']).toBe('https://proqpay.msg-os.com');
    expect(headers['x-content-type-options']).toBe('nosniff');

    const staticResponse=await request.get(`${baseURL}/_next/static/`);
    expect(staticResponse.headers()['access-control-allow-origin']||'').not.toBe('*');
  });

  test('privileged MFA + WebAuthn login and full non-destructive workspace regression',async({page})=>{
    const pageErrors=[];
    const consoleErrors=[];
    const failedRequests=[];
    page.on('pageerror',err=>pageErrors.push(err.message));
    page.on('console',msg=>{
      if(msg.type()==='error'){
        const value=msg.text();
        if(!/401.*\/api\/me|\/api\/me.*401/i.test(value)) consoleErrors.push(value);
      }
    });
    page.on('requestfailed',req=>{
      if(req.resourceType()==='document'||req.method()==='GET'){
        failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`);
      }
    });

    const {identity}=await secureUatLogin(page);
    expect(['SUPER_ADMIN','PAYROLL_CONTROLLER']).toContain(String(identity.body?.role||''));

    const routes=[
      '/?view=dashboard',
      '/?view=clients',
      '/data-intake',
      '/?view=exceptions',
      '/?view=operations',
      '/?view=payments',
      '/?view=billing',
      '/?view=employees',
      '/?view=reports',
      '/?view=ewa',
      '/?view=integrations',
      '/?view=logs',
    ];

    for(const route of routes){
      const response=await page.goto(route,{waitUntil:'domcontentloaded'});
      expect(response?.ok(),`Route must load: ${route}`).toBeTruthy();
      await expect(page.locator('body')).not.toContainText(/Application error|Something went wrong|Internal Server Error/i);
      await expect(page.locator('body')).toContainText(/ProQPay/i);
    }

    const apiChecks=await page.evaluate(async()=>{
      const paths=['/api/me','/api/operating-model','/api/billing','/api/payment-gateway?resource=overview'];
      const results=[];
      for(const path of paths){
        const response=await fetch(path,{credentials:'same-origin'});
        results.push({path,status:response.status});
      }
      return results;
    });
    for(const result of apiChecks){
      expect(result.status,`${result.path} authenticated status`).toBeLessThan(500);
      expect(result.status,`${result.path} must not lose authentication`).not.toBe(401);
    }

    await page.setViewportSize({width:390,height:844});
    await page.goto('/?view=dashboard',{waitUntil:'domcontentloaded'});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);

    expect(pageErrors,`Unhandled page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(failedRequests,`Failed GET/navigation requests: ${failedRequests.join(' | ')}`).toEqual([]);
    expect(consoleErrors,`Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('anonymous financial and operational APIs continue to fail closed',async({request,baseURL})=>{
    for(const path of ['/api/me','/api/operating-model','/api/billing','/api/payment-gateway']){
      const response=await request.get(`${baseURL}${path}`);
      expect([401,403],`${path} must reject anonymous access`).toContain(response.status());
    }
  });
});
