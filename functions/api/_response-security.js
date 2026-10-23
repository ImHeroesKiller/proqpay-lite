function setIfMissing(headers,name,value){
  if(!headers.has(name)) headers.set(name,value);
}

export function applyApiSecurityHeaders(response){
  const headers=new Headers(response.headers);
  setIfMissing(headers,'X-Content-Type-Options','nosniff');
  setIfMissing(headers,'X-Frame-Options','DENY');
  setIfMissing(headers,'Referrer-Policy','same-origin');
  setIfMissing(headers,'Permissions-Policy','camera=(), microphone=(), geolocation=()');
  setIfMissing(headers,'Strict-Transport-Security','max-age=31536000; includeSubDomains');
  setIfMissing(headers,'Cache-Control','no-store');

  return new Response(response.body,{
    status:response.status,
    statusText:response.statusText,
    headers,
  });
}
