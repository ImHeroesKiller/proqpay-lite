import { d1First, hasD1 } from './_d1.js';
import { authorize, clientIdsFor, corsHeaders } from './_security.js';

const METHODS='GET, OPTIONS';

function safeWebsite(value) {
  if (!value) return null;
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    const privateIpv4=/^(?:0\.|127\.|10\.|192\.168\.|169\.254\.)/.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
    const privateIpv6=host==='[::1]'||host==='::1'||/^\[?(?:fc|fd|fe8|fe9|fea|feb)/i.test(host);
    if(url.protocol!=='https:'||host==='localhost'||host.endsWith('.local')||privateIpv4||privateIpv6) return null;
    return url;
  } catch { return null; }
}

async function fetchSafe(url,redirects=0) {
  const safe=safeWebsite(url);
  if(!safe||redirects>3) return null;
  const response=await fetch(safe.toString(),{
    redirect:'manual',
    signal:AbortSignal.timeout(5000),
    headers:{Accept:'image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,*/*;q=0.5'},
  });
  if([301,302,303,307,308].includes(response.status)) {
    const location=response.headers.get('location');
    if(!location) return null;
    const next=new URL(location,safe);
    if(!safeWebsite(next.toString())) return null;
    return fetchSafe(next.toString(),redirects+1);
  }
  if(!safeWebsite(response.url||safe.toString())) return null;
  return response;
}

export async function onRequest({request,env}) {
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders(request,env,METHODS)});
  if(request.method!=='GET') return new Response('Method not allowed',{status:405,headers:corsHeaders(request,env,METHODS)});
  const authorization=await authorize(request,env,{methods:METHODS});
  if(authorization.response) return authorization.response;
  if(!hasD1(env)) return new Response('Unavailable',{status:503,headers:corsHeaders(request,env,METHODS)});
  const id=new URL(request.url).searchParams.get('id')||'';
  if(!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
  const actor=authorization.actor;
  const organizationId=String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  if(actor.role==='CLIENT_USER') {
    const scope=clientIdsFor(actor,env)||[];
    if(!scope.includes(id)) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
  }
  const row=await d1First(env.DB,'SELECT logo_url FROM clients WHERE id=? AND org_id=? LIMIT 1',[id,organizationId]);
  const logoUrl=safeWebsite(row?.logo_url);
  if(!logoUrl) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
  try {
    const upstream=await fetchSafe(logoUrl.toString());
    if(!upstream?.ok) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
    const contentType=String(upstream.headers.get('content-type')||'').toLowerCase();
    if(!contentType.startsWith('image/')) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
    const size=Number(upstream.headers.get('content-length')||0);
    if(size>2_000_000) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
    const body=await upstream.arrayBuffer();
    if(body.byteLength>2_000_000) return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
    return new Response(body,{status:200,headers:{
      ...corsHeaders(request,env,METHODS),
      'Content-Type':contentType,
      'Cache-Control':'private, max-age=3600',
      'Content-Length':String(body.byteLength),
    }});
  } catch {
    return new Response('Not found',{status:404,headers:corsHeaders(request,env,METHODS)});
  }
}
