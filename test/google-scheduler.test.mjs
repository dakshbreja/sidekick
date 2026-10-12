// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderBudgetStore,reserveWindow,COLLECTION_BUDGET} from '../src/collection-budget.js';
import {GoogleScheduler} from '../src/google-scheduler.js';
import {StudentStore} from '../src/store.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
const NOW=Date.parse('2026-10-12T12:00:00Z');
test('budget windows bound hourly and daily requests and never refill on clock rollback',()=>{
 let state={};for(let i=0;i<2;i++){const r=reserveWindow(state,NOW,{hour:6,day:9});assert.equal(r.allowed,true);state=r.state;}
 const limited=reserveWindow(state,NOW,{hour:6,day:9});assert.equal(limited.allowed,false);assert.equal(limited.retry_at,NOW+3600000);
 const later=reserveWindow(state,NOW+3600000,{hour:6,day:9});assert.equal(later.allowed,true);
 const rollback=reserveWindow(later.state,NOW,{hour:6,day:9});assert.equal(rollback.allowed,false);assert.equal(rollback.state.day_used,9);
 assert.equal(reserveWindow(later.state,NOW+7200000,{hour:6,day:9}).retry_at,Date.parse('2026-10-13T00:00:00Z'));
 assert.equal(reserveWindow(later.state,Date.parse('2026-10-13T00:00:00Z'),{hour:6,day:9}).allowed,true);
});
test('global reservations are atomic, idempotent, short-lived and contain no student identity',t=>{
 let fail=false,now=NOW;const f=sqliteFixture({beforeExec:q=>{if(fail&&q.startsWith('INSERT INTO provider_reservations'))throw new Error('Synthetic reservation failure');}});t.after(f.close);
 const budget=new ProviderBudgetStore(f.storage,{clock:()=>now}),reservationId=crypto.randomUUID();
 fail=true;assert.throws(()=>budget.reserve({reservationId}),/Synthetic/);assert.equal(f.storage.sql.exec('SELECT COUNT(*) AS n FROM provider_budget').one().n,0);
 fail=false;const first=budget.reserve({reservationId});assert.equal(first.allowed,true);assert.deepEqual(budget.reserve({reservationId}),first);
 assert.equal(JSON.parse(f.storage.sql.exec('SELECT body FROM provider_budget').one().body).hour_used,3);
 now+=60000;assert.equal(budget.reserve({reservationId}).error,'budget_reservation_expired');
 assert.throws(()=>budget.reserve({reservationId,tenantId:'synthetic_student_owner'}),e=>e.code==='invalid_budget_reservation');
 assert.throws(()=>budget.reserve({reservationId:'-'.repeat(36)}),e=>e.code==='invalid_budget_reservation');
 const state={hour_start:NOW,hour_used:COLLECTION_BUDGET.globalHour,day_start:Date.parse('2026-10-12T00:00:00Z'),day_used:COLLECTION_BUDGET.globalHour};
 f.storage.sql.exec('UPDATE provider_budget SET body=?',JSON.stringify(state));const denied=budget.reserve({reservationId:crypto.randomUUID()});assert.equal(denied.allowed,false);assert.equal(denied.retry_at,NOW+3600000);
 now+=172800001;budget.reserve({reservationId:crypto.randomUUID()});assert.equal(f.storage.sql.exec('SELECT COUNT(*) AS n FROM provider_reservations').one().n,1);
});
async function setup(t){const f=sqliteFixture();t.after(f.close);let now=NOW;const store=new StudentStore(f.storage),scheduler=new GoogleScheduler(store,{clock:()=>now});
 await store.dispatch({tenantId:'synthetic_student_owner',op:'profile.put',data:{display_name:'Synthetic',timezone:'UTC',consent_version:'test'},expectedRevision:0,operationId:'synthetic_setup'});
 // Synthetic authorization/selection facts for scheduler-only tests; lifecycle is covered separately.
 store.sql.exec('INSERT INTO google_connections VALUES (?,?)','google_a',JSON.stringify({status:'authorized_not_synced',generation:1,tokens:{synthetic:true}}));
 store.sql.exec("INSERT INTO records (kind,id,revision,updated_at,byte_count,body) VALUES (?,?,?,'synthetic',0,?)",'google_selection','google_a',1,JSON.stringify({id:'google_a',connection_generation:1,calendar_ids:['a','b']}));
 return {store,scheduler,advance:ms=>now+=ms,now:()=>now};}
test('scheduler resumes persisted reservations, rotates calendars fairly and respects source backoff',async t=>{
 const f=await setup(t),s=f.scheduler;assert.equal(s.nextTime(),NOW+1000);const a=s.reserve();assert.equal(a.calendarId,'a');assert.equal(s.reserve().kind,'wait');
 const restarted=new GoogleScheduler(f.store,{clock:f.now});assert.equal(restarted.reserve().kind,'wait');f.advance(60000);const b=restarted.reserve();assert.equal(b.calendarId,'b');
 restarted.finish(a.reservationId,{kind:'done'});assert.equal(restarted.state().pending.id,b.reservationId);restarted.finish(b.reservationId,{kind:'done'});
 f.store.sql.exec('INSERT INTO google_collection VALUES (?,?,?)','google_a','a',JSON.stringify({status:'backoff',next_due:f.now()+300000}));f.advance(5000);assert.equal(restarted.reserve().calendarId,'b');
});
test('selection retries cannot reset local quotas or global cooldowns, and repeated faults pause durably',async t=>{
 const f=await setup(t),s=f.scheduler;let r=s.reserve();s.finish(r.reservationId,{kind:'global_wait',retry_at:NOW+3600000});s.selectionChanged();s.selectionChanged();assert.equal(s.nextTime(),NOW+3600000);assert.equal(s.reserve().kind,'wait');
 f.advance(3600000);for(let i=0;i<8;i++){r=s.reserve();assert.equal(r.kind,'reserved');s.finish(r.reservationId,undefined,true);f.advance(3600000);}
 assert.equal(s.status().status,'paused');assert.equal(s.nextTime(),null);s.selectionChanged();assert.equal(s.status().status,'scheduled');
 const state=s.state();state.budget.hour_used=COLLECTION_BUDGET.studentHour;state.budget.hour_start=f.now();s.save(state);const before=s.state().budget;s.selectionChanged();assert.equal(s.reserve().kind,'wait');assert.deepEqual(s.state().budget,before);
});
test('removed authorization and deleted workspaces stop scheduling; account deletion clears reservations',async t=>{
 const f=await setup(t);f.scheduler.reserve();f.store.sql.exec('DELETE FROM google_connections');assert.equal(f.scheduler.nextTime(),null);assert.equal(f.scheduler.reserve().kind,'idle');
 const exported=await f.store.dispatch({tenantId:'synthetic_student_owner',op:'account.export'});const deleted=await f.store.dispatch({tenantId:'synthetic_student_owner',op:'account.delete',data:{confirm:'DELETE_MY_WORKSPACE'},expectedRevision:exported.account_revision,operationId:'synthetic_delete'});assert.equal(deleted.ok,true);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_schedule').n,0);f.scheduler.finish('obsolete',{kind:'done'});assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_schedule').n,0);
});
