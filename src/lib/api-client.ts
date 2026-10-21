/** G2 shared API error contract. No automatic retries for financial mutations. */
export const AUTHENTICATION_REQUIRED_EVENT='proqpay:authentication-required';
export function notifyAuthenticationRequired(status:number,body:Record<string,unknown>):boolean {
  // A provider rejection or invalid MFA code is not an expired application session.
  const required=status===401 && body.error==='Authentication required';
  if(required && typeof window!=='undefined')window.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
  return required;
}
export class ApiRequestError extends Error {
  readonly status:number;
  readonly code:string|undefined;
  readonly correlationId:string|undefined;
  constructor(message:string,status:number,body:Record<string,unknown>={}){
    super(message);
    this.name='ApiRequestError';
    this.status=status;
    this.code=typeof body.code==='string'?body.code:undefined;
    this.correlationId=typeof body.correlationId==='string'?body.correlationId:undefined;
  }
}
export function isAbortedRequest(error:unknown):boolean {
  return error instanceof Error && (error.name==='AbortError'||error.message==='STALE_ACTOR_CONTEXT');
}
export async function parseApiResponse<T>(response:Response):Promise<T> {
  let body:unknown;
  try{body=await response.json();}
  catch{
    if(response.ok&&response.status===204)return undefined as T;
    if(response.ok)throw new ApiRequestError('INVALID_API_RESPONSE',response.status);
    body={};
  }
  const payload=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
  if(!response.ok){
    if(notifyAuthenticationRequired(response.status,payload)) {
      throw new ApiRequestError('Sesi berakhir. Silakan masuk kembali.',response.status,payload);
    }
    const message=typeof payload.error==='string'?payload.error:
      typeof payload.message==='string'?payload.message:`HTTP ${response.status}`;
    throw new ApiRequestError(message,response.status,payload);
  }
  if(!body||typeof body!=='object')throw new ApiRequestError('INVALID_API_RESPONSE',response.status);
  return body as T;
}
export function getJson<T>(url:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);
  if(!headers.has('Accept'))headers.set('Accept','application/json');
  return fetch(url,{...options,headers}).then(parseApiResponse<T>);
}
