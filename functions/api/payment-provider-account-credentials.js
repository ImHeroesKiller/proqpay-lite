import { d1First, d1Run } from './_d1.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function bytesToBase64(bytes){
  let binary='';
  for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value){
  const binary=atob(String(value||''));
  return Uint8Array.from(binary,(char)=>char.charCodeAt(0));
}

function metadata(row){
  try{
    const parsed=JSON.parse(String(row?.metadata_json||'{}'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{
    return {};
  }
}

async function encryptionKey(env){
  const secret=String(env.E2PAY_CREDENTIALS_KEY||env.PI_ENCRYPTION_KEY||'');
  if(secret.length<32) throw new Error('E2PAY_CREDENTIALS_KEY atau PI_ENCRYPTION_KEY minimal 32 karakter diperlukan');
  const material=await crypto.subtle.digest('SHA-256',encoder.encode(secret));
  return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);
}

export function providerAccountCredentialState(row){
  const meta=metadata(row);
  const credential=meta?.merchantCredential;
  const ready=Boolean(credential?.ciphertext&&credential?.iv);
  return {
    ready,
    version:Number(credential?.version||0)||null,
    updatedAt:credential?.updatedAt||null,
  };
}

export async function encryptProviderAccountCredential(env,credentials){
  const username=String(credentials?.username||'').trim();
  const passwordMd5=String(credentials?.passwordMd5||'').trim().toUpperCase();
  if(!username||!/^[A-F0-9]{32}$/.test(passwordMd5)){
    throw new Error('Credential merchant E2Pay scoped tidak valid');
  }
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=encoder.encode(JSON.stringify({username,passwordMd5}));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),plain);
  return {
    ciphertext:bytesToBase64(new Uint8Array(cipher)),
    iv:bytesToBase64(iv),
    version:1,
    updatedAt:new Date().toISOString(),
  };
}

export async function decryptProviderAccountCredential(env,row){
  const credential=metadata(row)?.merchantCredential;
  if(!credential?.ciphertext||!credential?.iv) return null;
  const plain=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:base64ToBytes(credential.iv)},
    await encryptionKey(env),
    base64ToBytes(credential.ciphertext),
  );
  const parsed=JSON.parse(decoder.decode(plain));
  const username=String(parsed?.username||'').trim();
  const passwordMd5=String(parsed?.passwordMd5||'').trim().toUpperCase();
  if(!username||!/^[A-F0-9]{32}$/.test(passwordMd5)) return null;
  return {username,passwordMd5};
}

export function mergeProviderAccountMetadata(row,patch={}){
  return JSON.stringify({...metadata(row),...patch});
}

export async function persistProviderAccountCredential(database,env,row,actorEmail,credentials,extraMetadata={}){
  const merchantCredential=await encryptProviderAccountCredential(env,credentials);
  const metadataJson=mergeProviderAccountMetadata(row,{...extraMetadata,merchantCredential});
  await d1Run(database,`UPDATE payment_provider_accounts
    SET metadata_json=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND org_id=?`,[metadataJson,actorEmail,row.id,row.org_id]);
  return {merchantCredential,metadataJson};
}

export async function scopedE2PayRuntimeEnv(database,env,row){
  const source=row?.id
    ? await d1First(database,`SELECT * FROM payment_provider_accounts WHERE id=? AND org_id=? LIMIT 1`,[row.id,row.org_id])
    : row;
  const account=source||row;
  const credential=await decryptProviderAccountCredential(env,account);
  if(!credential){
    const error=new Error('Credential merchant E2Pay sub-account belum tersimpan');
    error.code='E2PAY_SUBACCOUNT_CREDENTIAL_REQUIRED';
    throw error;
  }
  return Object.assign(Object.create(env||null),{
    E2PAY_USERNAME:credential.username,
    E2PAY_PASSWORD_MD5:credential.passwordMd5,
    E2PAY_ACCOUNT_SRC:String(account?.provider_sub_account_id||'').trim(),
    E2PAY_SOURCE_MODE:'SUB_ACCOUNT_SNAPSHOT',
  });
}
