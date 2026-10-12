const KEY='proqpay_ida_session';
let volatileSessionId:string|null=null;

export function clearIdaSessionId(){
  volatileSessionId=null;
  if(typeof window==='undefined')return;
  try{window.localStorage.removeItem(KEY);}catch{ /* private storage may be unavailable */ }
}

export function getIdaSessionId():string {
  if(typeof window==='undefined')return 'server';
  try{window.localStorage.removeItem(KEY);}catch{ /* no persistent session */ }
  if(!volatileSessionId){
    const randomPart=typeof crypto?.randomUUID==='function'
      ?crypto.randomUUID()
      :Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
    volatileSessionId=`sess-${randomPart}`;
  }
  return volatileSessionId;
}
