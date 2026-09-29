import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { d1All, d1First, d1Run } from './_d1.js';

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');
}

function base64UrlToBytes(value) {
  const normalized=String(value || '').replaceAll('-','+').replaceAll('_','/');
  const padded=normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary=atob(padded);
  return Uint8Array.from(binary,(char)=>char.charCodeAt(0));
}

function transports(value) {
  try {
    const parsed=Array.isArray(value) ? value : JSON.parse(value || '[]');
    return parsed.filter((item)=>typeof item === 'string').slice(0,8);
  } catch {
    return [];
  }
}

export function passkeyEnforcementMode(env={}) {
  const mode=String(env.SECURITY_PASSKEY_ENFORCEMENT || 'AUDIT').trim().toUpperCase();
  return mode === 'ENFORCE' ? 'ENFORCE' : 'AUDIT';
}

export function webauthnConfig(request,env={}) {
  const url=new URL(request.url);
  const rpID=String(env.WEBAUTHN_RP_ID || url.hostname).trim().toLowerCase();
  const configuredOrigins=String(env.WEBAUTHN_ORIGINS || '')
    .split(',')
    .map((value)=>value.trim())
    .filter(Boolean);
  const expectedOrigin=configuredOrigins.includes(url.origin)
    ? url.origin
    : configuredOrigins[0] || url.origin;
  return {
    rpID,
    rpName:String(env.WEBAUTHN_RP_NAME || 'ProQPay'),
    expectedOrigin,
  };
}

export async function activePasskeys(database,userId) {
  return d1All(database,`SELECT id,credential_id,public_key_b64,counter,transports_json,device_type,backed_up,label,created_at,last_used_at
    FROM app_user_passkeys WHERE user_id=? AND status='ACTIVE' ORDER BY created_at ASC`,[userId]);
}

export async function hasActivePasskey(database,userId) {
  const row=await d1First(database,`SELECT 1 AS configured FROM app_user_passkeys
    WHERE user_id=? AND status='ACTIVE' LIMIT 1`,[userId]);
  return Boolean(row?.configured);
}

async function storeChallenge(database,{userId,purpose,challenge,rpID,expectedOrigin}) {
  const id=`WAC-${crypto.randomUUID()}`;
  await d1Run(database,`INSERT INTO webauthn_challenges
    (id,user_id,purpose,challenge,rp_id,expected_origin,expires_at)
    VALUES(?,?,?,?,?,?,datetime('now','+5 minutes'))`,
    [id,userId,purpose,challenge,rpID,expectedOrigin]);
  return id;
}

async function consumeChallenge(database,{id,userId,purpose}) {
  const row=await d1First(database,`SELECT * FROM webauthn_challenges
    WHERE id=? AND user_id=? AND purpose=? AND consumed_at IS NULL
      AND datetime(expires_at)>datetime('now') LIMIT 1`,[id,userId,purpose]);
  if(!row) return null;
  await d1Run(database,`UPDATE webauthn_challenges
    SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,[id]);
  return row;
}

export async function beginPasskeyRegistration(database,request,env,user) {
  const cfg=webauthnConfig(request,env);
  const existing=await activePasskeys(database,user.id);
  const options=await generateRegistrationOptions({
    rpName:cfg.rpName,
    rpID:cfg.rpID,
    userID:encoder.encode(String(user.id)),
    userName:String(user.email || user.id),
    userDisplayName:String(user.name || user.email || user.id),
    attestationType:'none',
    excludeCredentials:existing.map((row)=>({
      id:row.credential_id,
      transports:transports(row.transports_json),
    })),
    authenticatorSelection:{
      residentKey:'required',
      userVerification:'required',
    },
    supportedAlgorithmIDs:[-7,-257],
  });
  const challengeId=await storeChallenge(database,{
    userId:user.id,
    purpose:'REGISTER',
    challenge:options.challenge,
    rpID:cfg.rpID,
    expectedOrigin:cfg.expectedOrigin,
  });
  return {challengeId,options};
}

export async function finishPasskeyRegistration(database,request,env,user,{challengeId,response,label}) {
  const challenge=await consumeChallenge(database,{
    id:String(challengeId || ''),
    userId:user.id,
    purpose:'REGISTER',
  });
  if(!challenge) return {ok:false,reason:'PASSKEY_CHALLENGE_INVALID'};
  const verification=await verifyRegistrationResponse({
    response,
    expectedChallenge:challenge.challenge,
    expectedOrigin:challenge.expected_origin,
    expectedRPID:challenge.rp_id,
    requireUserVerification:true,
    supportedAlgorithmIDs:[-7,-257],
  });
  if(!verification.verified || !verification.registrationInfo) {
    return {ok:false,reason:'PASSKEY_REGISTRATION_NOT_VERIFIED'};
  }
  const info=verification.registrationInfo;
  const credential=info.credential;
  const id=`PASSKEY-${crypto.randomUUID()}`;
  await d1Run(database,`INSERT INTO app_user_passkeys
    (id,user_id,credential_id,public_key_b64,counter,transports_json,device_type,backed_up,label,status)
    VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE')
    ON CONFLICT(credential_id) DO UPDATE SET
      public_key_b64=excluded.public_key_b64,
      counter=excluded.counter,
      transports_json=excluded.transports_json,
      device_type=excluded.device_type,
      backed_up=excluded.backed_up,
      label=COALESCE(excluded.label,app_user_passkeys.label),
      status='ACTIVE',
      revoked_at=NULL,
      revoked_by=NULL`,
    [
      id,
      user.id,
      credential.id,
      bytesToBase64Url(credential.publicKey),
      Number(credential.counter || 0),
      JSON.stringify(credential.transports || response?.response?.transports || []),
      info.credentialDeviceType || null,
      info.credentialBackedUp ? 1 : 0,
      String(label || '').trim().slice(0,120) || null,
    ]);
  return {
    ok:true,
    credentialId:credential.id,
    deviceType:info.credentialDeviceType || null,
    backedUp:Boolean(info.credentialBackedUp),
  };
}

export async function beginPasskeyAuthentication(database,request,env,user) {
  const cfg=webauthnConfig(request,env);
  const keys=await activePasskeys(database,user.id);
  if(!keys.length) return {ok:false,reason:'PASSKEY_NOT_ENROLLED'};
  const options=await generateAuthenticationOptions({
    rpID:cfg.rpID,
    allowCredentials:keys.map((row)=>({
      id:row.credential_id,
      transports:transports(row.transports_json),
    })),
    userVerification:'required',
  });
  const challengeId=await storeChallenge(database,{
    userId:user.id,
    purpose:'AUTHENTICATE',
    challenge:options.challenge,
    rpID:cfg.rpID,
    expectedOrigin:cfg.expectedOrigin,
  });
  return {ok:true,challengeId,options};
}

export async function finishPasskeyAuthentication(database,request,env,user,{challengeId,response}) {
  const challenge=await consumeChallenge(database,{
    id:String(challengeId || ''),
    userId:user.id,
    purpose:'AUTHENTICATE',
  });
  if(!challenge) return {ok:false,reason:'PASSKEY_CHALLENGE_INVALID'};
  const row=await d1First(database,`SELECT * FROM app_user_passkeys
    WHERE user_id=? AND credential_id=? AND status='ACTIVE' LIMIT 1`,[
      user.id,
      String(response?.id || ''),
    ]);
  if(!row) return {ok:false,reason:'PASSKEY_CREDENTIAL_UNKNOWN'};
  const verification=await verifyAuthenticationResponse({
    response,
    expectedChallenge:challenge.challenge,
    expectedOrigin:challenge.expected_origin,
    expectedRPID:challenge.rp_id,
    credential:{
      id:row.credential_id,
      publicKey:base64UrlToBytes(row.public_key_b64),
      counter:Number(row.counter || 0),
      transports:transports(row.transports_json),
    },
    requireUserVerification:true,
  });
  if(!verification.verified) return {ok:false,reason:'PASSKEY_AUTH_NOT_VERIFIED'};
  await d1Run(database,`UPDATE app_user_passkeys SET
    counter=?,
    last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=?`,[
      Number(verification.authenticationInfo?.newCounter || row.counter || 0),
      row.id,
    ]);
  return {ok:true,credentialId:row.credential_id};
}

export async function revokeAllPasskeys(database,userId,revokedBy) {
  const result=await d1Run(database,`UPDATE app_user_passkeys SET
    status='REVOKED',
    revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    revoked_by=?
    WHERE user_id=? AND status='ACTIVE'`,[String(revokedBy || 'SECURITY_RECOVERY'),userId]);
  return Number(result?.meta?.changes || 0);
}
