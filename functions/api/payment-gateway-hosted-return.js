import { d1Batch, d1First, hasD1 } from './_d1.js';
import { validateHostedReturn } from './payment-gateway-hosted-core.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function redirect(origin, path, params = {}) {
  const url = new URL(path || '/', origin);
  Object.entries(params).forEach(([key,value]) => { if (value != null) url.searchParams.set(key,String(value)); });
  return new Response(null,{ status:303,headers:{ Location:url.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff' } });
}

export async function onRequest(context) {
  const { request,env } = context;
  if (request.method !== 'GET') return new Response('Method not allowed',{status:405,headers:{'Cache-Control':'no-store'}});
  const origin = new URL(request.url).origin;
  if (!hasD1(env)) return redirect(origin,'/',{payment:'unavailable'});

  const params = new URL(request.url).searchParams;
  const sessionId = String(params.get('sessionId') || '').trim();
  const state = String(params.get('state') || '').trim();
  if (!sessionId || !state) return redirect(origin,'/',{payment:'invalid_return'});

  const session = await d1First(env.DB,`SELECT id,payment_instruction_id,status,return_path,state_hash,expires_at
    FROM hosted_payment_sessions WHERE id=? LIMIT 1`,[sessionId]);
  if (!session) return redirect(origin,'/',{payment:'session_not_found'});
  if (!await validateHostedReturn({state,expectedStateHash:session.state_hash})) return redirect(origin,'/',{payment:'invalid_state'});
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await d1Batch(env.DB,[{statement:`UPDATE hosted_payment_sessions SET status='EXPIRED',updated_at=${NOW} WHERE id=? AND status<>'COMPLETED'`,bindings:[session.id]}]);
    return redirect(origin,session.return_path,{payment:'expired',paymentInstructionId:session.payment_instruction_id});
  }

  if (!['COMPLETED','CANCELLED','FAILED','EXPIRED'].includes(session.status)) {
    await d1Batch(env.DB,[
      {statement:`UPDATE hosted_payment_sessions SET status='RETURNED',returned_at=COALESCE(returned_at,${NOW}),updated_at=${NOW} WHERE id=?`,bindings:[session.id]},
      {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
        VALUES(?,?,?,?,?,?,?,?)`,bindings:[`AUD-${crypto.randomUUID()}`,String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'),'hosted-return','SYSTEM',
        'HOSTED_PAYMENT_BROWSER_RETURNED',`Hosted session ${session.id} returned; awaiting signed webhook`,'payment_instruction',session.payment_instruction_id]},
    ]);
  }
  return redirect(origin,session.return_path,{payment:'processing',paymentInstructionId:session.payment_instruction_id,hostedSessionId:session.id});
}
