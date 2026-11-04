import assert from 'node:assert/strict';
import test from 'node:test';
import {NOTIFICATION_TYPES,renderNotificationTemplate,deliverProQPayNotification,dispatchClientNotification,notifyAfterResponse} from '../functions/api/_proqpay-notifications.js';

test('all eight ProQPay notification templates are branded and privacy-safe',()=>{
  assert.equal(NOTIFICATION_TYPES.length,9);
  for(const type of NOTIFICATION_TYPES) {
    const x=renderNotificationTemplate(type,{clientName:'PT UAT Test <script>',reference:'UAT-2026-01',period:'November 2026'});
    assert.match(x.subject,/^\[ProQPay\]/);
    assert.match(x.html,/AI PAYROLL OPERATING SYSTEM/);
    assert.match(x.html,/PT Mandiri Semesta Gemilang/);
    assert.match(x.html,/role="presentation"/);
    assert.match(x.html,/UAT-2026-01/);
    assert.doesNotMatch(x.html,/<script>/);
    assert.match(x.html,/PT UAT Test &lt;script&gt;/);
    assert.doesNotMatch(x.html,/nomor rekening pribadi|detail gaji:/);
  }
});

test('disabled notifications do not reach gateway',async()=>{
  const result=await deliverProQPayNotification({},{
    type:'PAYROLL_REVIEW',recipient:'uat@example.com',eventId:'evt-1',
  });
  assert.equal(result.status,'DISABLED');
});

test('notifications skip invalid targets',async()=>{
  const env={PROQPAY_NOTIFICATION_EMAIL_ENABLED:'true'};
  const result=await deliverProQPayNotification(env,{
    type:'EWA_APPROVED',recipient:'bad\nmail',eventId:'evt-2',
  });
  assert.equal(result.status,'SKIPPED');
});

test('notifyAfterResponse only schedules successful requests',async()=>{
  let count=0;
  const context={env:{PROQPAY_NOTIFICATION_EMAIL_ENABLED:'true'},waitUntil:(p)=>{count++; return p;}};
  const success=new Response(JSON.stringify({ok:true}),{status:200});
  notifyAfterResponse(context,success,async()=>{});
  assert.equal(count,1);
  const fail=new Response(JSON.stringify({error:'invalid'}),{status:403});
  notifyAfterResponse(context,fail,async()=>{});
  assert.equal(count,1);
});
