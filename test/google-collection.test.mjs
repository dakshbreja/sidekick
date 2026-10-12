// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url} from 'jose';
import {StudentStore} from '../src/store.js';
import {GoogleConnectionState} from '../src/google-connection-state.js';
import {collectGooglePage} from '../src/google-collector.js';
import {GoogleCollectionState,COLLECTION_LIMITS} from '../src/google-collection-state.js';
import {GOOGLE_CALENDAR_SCOPES} from '../src/google-calendar.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
const A='synthetic_student_alpha',B='synthetic_student_bravo',NOW=Date.parse('2026-10-12T12:00:00Z');
const random=()=>base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const event=(id,extra={})=>({id,status:'confirmed',summary:'Synthetic '+id,start:{date:'2026-10-12'},end:{date:'2026-10-13'},...extra});
const page=(items,{next=null,sync='example-sync-v1'}={})=>({items,next_page_token:next,next_sync_token:next?null:sync,collection_complete:!next,time_zone:'America/New_York',recurrence_expanded:false});
async function setup(t,{limits,beforeExec}={}) {
 const f=sqliteFixture({beforeExec});t.after(()=>f.close());let now=NOW,seq=0;
 const store=new StudentStore(f.storage,{clock:()=>new Date(now).toISOString()}),auth=new GoogleConnectionState(store,{key:random(),clock:()=>now});
 const collection=new GoogleCollectionState(store,{clock:()=>now,limits});
 const write=(op,data,expectedRevision=0)=>store.dispatch({tenantId:A,op,data,expectedRevision,operationId:'synthetic_save_'+ ++seq});
 await write('profile.put',{display_name:'Synthetic student',timezone:'UTC',consent_version:'test-v1'});
 await write('connections.put',{id:'google_a',provider:'google_calendar',site_url:'https://calendar.google.com/'});
 const authorize=async()=>{const browser=random(),old=auth.status(A,'google_a');const intent=await auth.beginAuthorization(A,{connectionId:'google_a',expectedRevision:old.revision,attemptId:'synthetic_auth_'+ ++seq,browserBinding:browser,redirectUri:'https://synthetic.example/callback'});const claim=await auth.consumeAuthorization(A,{connectionId:'google_a',state:intent.state,browserBinding:browser});await auth.finishAuthorization(A,{connectionId:'google_a',generation:claim.generation,lease:claim.lease,credentials:{access_token:'example-access',refresh_token:'example-refresh',expires_at:now+3600000,scopes:[...GOOGLE_CALENDAR_SCOPES]}});};
 await authorize();
 const select=async(ids=['calendar_a'])=>{const generation=auth.status(A,'google_a').generation;store.cacheGoogleChoices(A,'google_a',generation,ids.map(id=>({id,summary:'Synthetic '+id,accessRole:'owner'})));const result=await write('google_selection.put',{id:'google_a',connection_generation:generation,calendar_ids:ids},store.getRecord('google_selection','google_a')?.revision??0);assert.equal(result.ok,true);return result;};
 await select();
 const claim=(calendarId='calendar_a')=>collection.claim(A,{connectionId:'google_a',calendarId});
 const snapshot=(extra={})=>collection.snapshot(A,{connectionId:'google_a',calendarId:'calendar_a',...extra});
 const exported=()=>store.dispatch({tenantId:A,op:'account.export'});
 return {...f,store,auth,collection,write,select,authorize,claim,snapshot,exported,advance:ms=>now+=ms,setNow:value=>now=value,now:()=>now,disconnect:()=>auth.disconnect(A,{connectionId:'google_a',expectedRevision:auth.status(A,'google_a').revision})};
}
const rejects=(run,code)=>assert.rejects(run,error=>error.code===code);
const throws=(run,code)=>assert.throws(run,error=>error.code===code);

test('full pages stay private until atomic publication, with replacement IDs and exportable source facts',async t=>{
 const f=await setup(t),before=(await f.exported()).account_revision,first=f.claim();
 assert.equal(first.syncToken,null);assert.equal(first.pageToken,null);
 assert.deepEqual(await f.collection.commit(A,first,page([event('a'),event('b')],{next:'example-page-2'})),{published:false,pages_staged:1});
 assert.equal(f.snapshot().snapshot_complete,false);assert.deepEqual(f.snapshot().events,[]);assert.deepEqual((await f.exported()).data.google_calendar_snapshots,[]);
 assert.equal((await f.exported()).account_revision,before);assert.equal(f.claim().kind,'wait');f.advance(1000);
 const second=f.claim();assert.equal(second.runId,first.runId);assert.equal(second.pageToken,'example-page-2');assert.equal(second.syncToken,null);
 const finished=await f.collection.commit(A,second,page([event('b',{summary:'Replaced'}),event('c')]));assert.equal(finished.published,true);
 const snapshot=f.snapshot();assert.equal(snapshot.snapshot_complete,true);assert.deepEqual(snapshot.events.map(e=>e.id),['a','b','c']);assert.equal(snapshot.events[1].summary,'Replaced');assert.equal(snapshot.time_zone,'America/New_York');
 const exported=await f.exported();assert.equal(exported.account_revision,before+1);assert.equal(exported.data.google_calendar_snapshots[0].events.length,3);
 assert.doesNotMatch(JSON.stringify(exported),/example-sync|example-page|base_sync_token|lease|ciphertext/);
 assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_event_stage').n,0);await rejects(()=>f.collection.commit(A,second,page([])),'collection_lease_stale');
});

test('incremental pages reuse the base cursor, retain the prior snapshot, and preserve recurring cancellation evidence',async t=>{
 const f=await setup(t);await f.collection.commit(A,f.claim(),page([event('a'),event('b',{recurrence:['RRULE:FREQ=WEEKLY']})]));const old=f.snapshot();f.advance(COLLECTION_LIMITS.intervalMs);
 const start=f.claim();assert.equal(start.syncToken,'example-sync-v1');
 const canceled={id:'b_exception',status:'cancelled',recurringEventId:'b',originalStartTime:{date:'2026-10-19'}};
 await f.collection.commit(A,start,page([event('a',{summary:'Changed'}),canceled],{next:'example-page-2'}));assert.equal(f.snapshot().events[0].summary,'Synthetic a');assert.equal(f.snapshot().snapshot_id,old.snapshot_id);
 f.advance(1000);const next=f.claim();assert.equal(next.syncToken,'example-sync-v1');assert.equal(next.pageToken,'example-page-2');
 await f.collection.commit(A,next,page([{id:'a',status:'cancelled'}],{sync:'example-sync-v2'}));
 assert.deepEqual(f.snapshot().events,[{id:'a',status:'cancelled'},event('b',{recurrence:['RRULE:FREQ=WEEKLY']}),canceled]);assert.notEqual(f.snapshot().snapshot_id,old.snapshot_id);assert.equal(f.snapshot().recurrence_expanded,false);
 f.advance(COLLECTION_LIMITS.intervalMs);assert.equal(f.claim().syncToken,'example-sync-v2');
});

test('lease expiration resumes the same page and rejects a late worker, including across component recreation',async t=>{
 const f=await setup(t),old=f.claim();assert.equal(f.claim().kind,'wait');f.advance(COLLECTION_LIMITS.leaseMs);
 const fresh=new GoogleCollectionState(f.store,{clock:f.now}),claim=fresh.claim(A,{connectionId:'google_a',calendarId:'calendar_a'});assert.equal(claim.runId,old.runId);assert.notEqual(claim.lease,old.lease);
 await rejects(()=>f.collection.commit(A,old,page([event('late')])),'collection_lease_stale');await fresh.commit(A,claim,page([event('correct')]));assert.equal(f.snapshot().events[0].id,'correct');
});

test('selection changes cancel partial runs, preserve retained snapshots, and remove deselected source content',async t=>{
 const f=await setup(t);await f.select(['calendar_a','calendar_b']);await f.collection.commit(A,f.claim(),page([event('a')]));f.advance(COLLECTION_LIMITS.intervalMs);
 const old=f.claim();await f.collection.commit(A,old,page([event('staged')],{next:'example-page-2'}));f.advance(1000);const inFlight=f.claim();
 await f.select(['calendar_a']);assert.deepEqual(f.snapshot().events.map(e=>e.id),['a']);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_event_stage').n,0);
 await rejects(()=>f.collection.commit(A,inFlight,page([event('late')])),'collection_lease_stale');
 assert.equal(f.claim().pageToken,null);await f.select([]);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_events').n,0);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_collection').n,0);
});

test('snapshot pagination requires its opaque identity and detects deletion/recreation without revision ABA',async t=>{
 const f=await setup(t);await f.collection.commit(A,f.claim(),page([event('a'),event('b')]));const old=f.snapshot({limit:1});assert.equal(old.next_cursor,'a');
 throws(()=>f.snapshot({cursor:old.next_cursor}),'snapshot_id_required');assert.equal(f.snapshot({cursor:old.next_cursor,snapshotId:old.snapshot_id}).events[0].id,'b');
 await f.select([]);await f.select();throws(()=>f.snapshot({cursor:old.next_cursor,snapshotId:old.snapshot_id}),'calendar_snapshot_changed');
 await f.collection.commit(A,f.claim(),page([event('c'),event('d')]));assert.equal(f.snapshot().snapshot_revision,old.snapshot_revision);assert.notEqual(f.snapshot().snapshot_id,old.snapshot_id);
 throws(()=>f.snapshot({cursor:old.next_cursor,snapshotId:old.snapshot_id}),'calendar_snapshot_changed');
});

test('disconnect and account deletion erase published/staged data and fence late commits and foreign reads',async t=>{
 const f=await setup(t);await f.collection.commit(A,f.claim(),page([event('a')]));f.advance(COLLECTION_LIMITS.intervalMs);const claim=f.claim();
 throws(()=>f.collection.snapshot(B,{connectionId:'google_a',calendarId:'calendar_a'}),'owner_mismatch');f.disconnect();
 for(const table of ['google_collection','google_event_stage','google_events','google_page_history'])assert.equal(f.store.row('SELECT COUNT(*) AS n FROM '+table).n,0);
 await rejects(()=>f.collection.commit(A,claim,page([event('late')])),'google_access_changed');assert.deepEqual((await f.exported()).data.google_calendar_snapshots,[]);
 await f.authorize();await f.select();const after=f.claim();await f.collection.commit(A,after,page([event('new')],{next:'example-page-2'}));f.advance(1000);const final=f.claim();
 await f.write('account.delete',{confirm:'DELETE_MY_WORKSPACE'},(await f.exported()).account_revision);await rejects(()=>f.collection.commit(A,final,page([])),'account_deleted');
 for(const table of ['google_collection','google_event_stage','google_events','google_page_history'])assert.equal(f.store.row('SELECT COUNT(*) AS n FROM '+table).n,0);
});

test('provider backoff preserves page and snapshot, honors Retry-After, and pauses after a bounded failure budget',async t=>{
 const f=await setup(t,{limits:{failures:2}});await f.collection.commit(A,f.claim(),page([event('a')]));const published=f.snapshot();f.advance(COLLECTION_LIMITS.intervalMs);
 const claim=f.claim();const status=f.collection.failure(A,claim,{code:'calendar_provider_unavailable',retryAfterSeconds:600});assert.equal(status.status,'backoff');assert.ok(status.retry_at>=f.now()+600000);assert.equal(status.freshness,'stale');assert.equal(f.snapshot().snapshot_id,published.snapshot_id);
 assert.equal(f.claim().kind,'wait');f.setNow(status.retry_at);const retry=f.claim();assert.equal(retry.runId,claim.runId);assert.equal(retry.syncToken,claim.syncToken);
 assert.equal(f.collection.failure(A,retry,{code:'calendar_provider_timeout'}).status,'paused');assert.equal(f.claim().kind,'paused');assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_event_stage').n,0);assert.equal(f.snapshot().events[0].id,'a');
 await f.select();assert.equal(f.claim().kind,'page');
});

test('expired sync token wipes old source data before full reset; permission removal pauses and erases',async t=>{
 const f=await setup(t);await f.collection.commit(A,f.claim(),page([event('a')]));const old=f.snapshot();f.advance(COLLECTION_LIMITS.intervalMs);const claim=f.claim();
 f.collection.failure(A,claim,{code:'calendar_full_sync_required'});assert.deepEqual(f.snapshot().events,[]);assert.equal(f.snapshot().last_successful_sync,null);assert.notEqual(f.snapshot().snapshot_id,old.snapshot_id);assert.deepEqual((await f.exported()).data.google_calendar_snapshots,[]);
 f.advance(1000);const reset=f.claim();assert.equal(reset.syncToken,null);assert.equal(reset.pageToken,null);await f.collection.commit(A,reset,page([event('b')]));
 f.advance(COLLECTION_LIMITS.intervalMs);f.collection.failure(A,f.claim(),{code:'calendar_not_accessible'});assert.equal(f.claim().kind,'paused');assert.deepEqual(f.snapshot().events,[]);
});

test('event, byte and final published-workspace quotas rollback without reporting partial completion',async t=>{
 const f=await setup(t,{limits:{calendarEvents:2,workspaceEvents:2}});const claim=f.claim();await rejects(()=>f.collection.commit(A,claim,page([event('a'),event('b'),event('c')])),'calendar_collection_limit');assert.deepEqual(f.snapshot().events,[]);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_event_stage').n,0);
 await f.collection.commit(A,claim,page([event('a'),event('b')]));await f.select(['calendar_a','calendar_b']);const second=f.claim('calendar_b');
 await rejects(()=>f.collection.commit(A,second,page([event('c')])),'calendar_collection_limit');assert.deepEqual(f.snapshot().events.map(e=>e.id),['a','b']);assert.equal(f.store.row("SELECT COUNT(*) AS n FROM google_events WHERE calendar_id = 'calendar_b'").n,0);
 const g=await setup(t,{limits:{workspaceBytes:100}});await rejects(()=>g.collection.commit(A,g.claim(),page([event('oversized')])),'calendar_collection_limit');assert.equal(g.snapshot().snapshot_complete,false);
});

test('repeated cursors, page budgets and malformed source pages cannot advance staged state',async t=>{
 const f=await setup(t);await f.collection.commit(A,f.claim(),page([event('a')],{next:'example-repeat'}));f.advance(1000);const claim=f.claim();
 await rejects(()=>f.collection.commit(A,claim,page([event('b')],{next:'example-repeat'})),'calendar_cursor_repeated');assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_event_stage').n,1);
 await rejects(()=>f.collection.commit(A,claim,{...page([]),collection_complete:false}),'calendar_provider_invalid_response');
 const g=await setup(t,{limits:{pages:2}});await g.collection.commit(A,g.claim(),page([],{next:'example-next-1'}));g.advance(1000);await rejects(()=>g.collection.commit(A,g.claim(),page([],{next:'example-next-2'})),'calendar_collection_limit');assert.equal(g.snapshot().snapshot_complete,false);
});

test('a failure after deleting old published rows rolls back the whole publication and can retry exactly',async t=>{
 let failing=false;const f=await setup(t,{beforeExec:query=>{if(failing && query.startsWith('INSERT INTO google_events SELECT'))throw new Error('Synthetic publish storage failure');}});
 await f.collection.commit(A,f.claim(),page([event('old')]));const old=f.snapshot();f.advance(COLLECTION_LIMITS.intervalMs);const claim=f.claim();failing=true;
 await assert.rejects(f.collection.commit(A,claim,page([event('new')],{sync:'example-sync-v2'})),/Synthetic publish/);assert.deepEqual(f.snapshot().events,old.events);assert.equal(f.snapshot().snapshot_id,old.snapshot_id);
 failing=false;await f.collection.commit(A,claim,page([event('new')],{sync:'example-sync-v2'}));assert.deepEqual(f.snapshot().events.map(e=>e.id),['new','old']);
});


test('a selection removed while access is being acquired cannot trigger an event request',async t=>{
 const f=await setup(t);const state={acquireAccess:async(...args)=>{const result=await f.auth.acquireAccess(...args);await f.select([]);return result;},assertActiveGeneration:(...args)=>f.auth.assertActiveGeneration(...args)};
 const result=await collectGooglePage({tenantId:A,connectionId:'google_a',calendarId:'calendar_a',collection:f.collection,state,config:{},client:{eventsPage:()=>assert.fail('Unselected source must not be fetched')}});
 assert.equal(result.kind,'stopped');assert.equal(result.error,'calendar_not_selected');
});

test('failed selection, disconnect and deletion transactions preserve published data and authorization together',async t=>{
 let failure=null;const f=await setup(t,{beforeExec:query=>{if(failure && query.startsWith(failure))throw new Error('Synthetic lifecycle failure');}});
 await f.collection.commit(A,f.claim(),page([event('kept')]));const before=f.snapshot(),grant=f.auth.status(A,'google_a');
 failure='INSERT INTO records';assert.equal((await f.write('google_selection.put',{id:'google_a',connection_generation:1,calendar_ids:[]},1)).error,'storage_unavailable');assert.deepEqual(f.snapshot(),before);
 failure='DELETE FROM google_events';assert.throws(()=>f.disconnect(),/Synthetic lifecycle failure/);assert.deepEqual(f.auth.status(A,'google_a'),grant);assert.deepEqual(f.snapshot(),before);
 failure='UPDATE workspace_meta SET deleted';assert.equal((await f.write('account.delete',{confirm:'DELETE_MY_WORKSPACE'},(await f.exported()).account_revision)).error,'storage_unavailable');assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.auth.status(A,'google_a'),grant);
});


test('competing staging reservations back off durably without partial copies or loss of published events',async t=>{
 const f=await setup(t,{limits:{workspaceEvents:3}});await f.select(['calendar_a','calendar_b']);
 await f.collection.commit(A,f.claim(),page([event('a')]));await f.collection.commit(A,f.claim('calendar_b'),page([event('b'),event('c')]));f.advance(COLLECTION_LIMITS.intervalMs);
 await f.collection.commit(A,f.claim(),page([event('added')],{next:'example-page-2'}));
 const blocked=f.claim('calendar_b');assert.equal(blocked.kind,'wait');assert.equal(blocked.retry_at,f.now()+60000);assert.equal(f.store.row("SELECT COUNT(*) AS n FROM google_event_stage WHERE calendar_id = 'calendar_b'").n,0);
 assert.equal(f.collection.snapshot(A,{connectionId:'google_a',calendarId:'calendar_b'}).events.length,2);
 f.advance(1000);f.collection.failure(A,f.claim(),{code:'calendar_collection_limit'});f.advance(59000);assert.equal(f.claim('calendar_b').kind,'page');
});
