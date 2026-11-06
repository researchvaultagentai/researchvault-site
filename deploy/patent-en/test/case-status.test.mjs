import assert from 'node:assert/strict';
import test from 'node:test';
import { caseNotifications, caseNext, countdown, nextAction, teamUpdates } from '../workflow/case-status.js';

test('customer, receipt review, and official processing show distinct next actions',()=>{
  assert.equal(caseNext({stage:'report_payment'}).owner,'client');
  assert.equal(caseNext({stage:'report_payment',invoices:[{status:'issued',receipt_pending:true}]}).owner,'team');
  assert.match(nextAction({stage:'isa_wait'}),/data-next-owner="authority"/);
  assert.equal(teamUpdates({stage:'isa_wait'}),'');
  assert.match(teamUpdates({stage:'isa_wait',server_now:1,team_updates:[{kind:'message',due_at:86400}]}),/Reply to your private message/);
  assert.equal(countdown(86401,1).tone,'soon');
  assert.deepEqual(countdown(1,1),{text:'Update overdue',tone:'late'});
});

test('only published and unread case milestones are shown in notifications',()=>{
  const events=[
    {revision:4,event_type:'isa_received',created_at:60},
    {revision:3,event_type:'admin_document_uploaded',created_at:55},
    {revision:2,event_type:'team_update_posted',created_at:50},
  ];
  const html=caseNotifications({client_seen_revision:2,events});
  assert.match(html,/1 new case notification/);
  assert.match(html,/outcome of the international search/);
  assert.doesNotMatch(html,/private update|uploaded/);
  assert.equal(caseNotifications({client_seen_revision:4,events}),'');
});
