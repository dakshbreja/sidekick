// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url} from 'jose';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRuntime} from './runtime-fixture.mjs';
import {GOOGLE_CALENDAR_SCOPES} from '../src/google-calendar.js';
async function setup(t, { initialTtl = 3600, refreshResponse, listResponse, persistent = true, enabled = true, eventsResponse } = {}) {
  const directory = persistent ? await mkdtemp(join(tmpdir(), 'community-refresh-')) : undefined;
  const root=fileURLToPath(new URL('../',import.meta.url)),deploymentBundle=join(directory,'synthetic-worker.mjs');
  const source=`export {default} from './src/index.js';import {CollectionBudget as BudgetBase} from './src/collection-budget-object.js';export class CollectionBudget extends BudgetBase {async exhaust(){const now=Date.now();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO provider_budget VALUES (1,?)',JSON.stringify({hour_start:Math.floor(now/3600000)*3600000,hour_used:3000,day_start:Math.floor(now/86400000)*86400000,day_used:3000}));}}import {StudentState as Base} from './src/student-object.js';export class StudentState extends Base {async inspectSchedule(){return {alarm:await this.ctx.storage.getAlarm(),state:this.scheduler.state()};}async failNextSchedule(){this.failSchedule=true;}async reschedule(replace){await super.reschedule(replace);if(this.failSchedule){this.failSchedule=false;throw new Error('Synthetic schedule failure');}}}`;
  const compiled=await build({stdin:{contents:source,resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*','node:*'],logLevel:'silent'});await writeFile(deploymentBundle,compiled.outputFiles[0].text);
  const bindings = { GOOGLE_COLLECTION_ENABLED: enabled?'true':'false', GOOGLE_OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'example-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'example-client-secret', GOOGLE_REDIRECT_URI: 'https://community.example.invalid/api/google/callback', GOOGLE_CREDENTIAL_KEY: base64url.encode(crypto.getRandomValues(new Uint8Array(32))) };
  const calls = { authorization: 0, refresh: 0, list: 0, events: 0 };
  const providerFetch = async request => {
    const url = new URL(request.url);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      assert.equal(request.method, 'POST'); const form = new URLSearchParams(await request.text());
      if (form.get('grant_type') === 'authorization_code') { calls.authorization++; return Response.json({ access_token: 'example-old', refresh_token: 'example-existing-refresh', expires_in: initialTtl, token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' ') }); }
      assert.equal(form.get('grant_type'), 'refresh_token'); assert.equal(form.get('refresh_token'), 'example-existing-refresh'); calls.refresh++;
      return refreshResponse ? refreshResponse(form) : Response.json({ access_token: 'example-new', expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(url.origin, 'https://www.googleapis.com'); if(url.pathname.endsWith('/events')){calls.events++;return eventsResponse?eventsResponse(request,calls.events):Response.json({items:[{id:'synthetic_event',status:'confirmed',summary:'Synthetic event',start:{date:'2026-10-12'},end:{date:'2026-10-13'}}],nextSyncToken:'example-sync',timeZone:'UTC'});} assert.equal(url.pathname, '/calendar/v3/users/me/calendarList'); assert.equal(request.method, 'GET'); calls.list++;
    return listResponse ? listResponse(request) : Response.json({ items: [{ id: 'example-calendar', summary: 'Synthetic calendar', accessRole: 'owner', timeZone: 'UTC' }] });
  };
  let runtime = await createRuntime({ deploymentBundle, bindings, providerFetch, persistPath: directory });
  t.after(async () => { await runtime.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const request = (...args) => runtime.request(...args);
  for (const [path, data, operation_id] of [
    ['/api/onboarding', { display_name: 'Synthetic Student', timezone: 'UTC', consent_version: 'test-v1' }, 'synthetic_profile_1'],
    ['/api/connections', { id: 'google_a', provider: 'google_calendar', site_url: 'https://calendar.google.com/' }, 'synthetic_connection_1'],
  ]) assert.equal((await request(path, { method: 'PUT', body: { ...data, operation_id, expected_revision: 0 } })).status, 200);
  const owner = (await (await request('/api/onboarding')).json()).workspace_id, headers = { 'X-Workspace-Id': owner };
  const prepared = await request('/api/google/prepare', { method: 'POST', headers, body: {} }); headers.Cookie = prepared.headers.get('set-cookie').split(';')[0];
  const intent = await (await request('/api/google/begin', { method: 'POST', headers, body: { connection_id: 'google_a', attempt_id: 'synthetic_attempt_1', expected_revision: 0 } })).json();
  const state = new URL(intent.authorization_url).searchParams.get('state');
  assert.equal((await request('/api/google/callback?state=' + encodeURIComponent(state) + '&code=example-code', { headers })).headers.get('location'), '/?calendar=authorized#sources');
  const list = (student = 'a', extra = '') => request('/api/google/calendars?connection_id=google_a' + extra, { student });
  const status = async () => (await (await request('/api/google/status?connection_id=google_a')).json()).connection;
  const restart = async () => { const authFixture = runtime.authFixture; await runtime.close(); runtime = await createRuntime({ deploymentBundle, bindings, providerFetch, persistPath: directory, authFixture }); };
  const probe=async()=>{const ns=await runtime.mf.getDurableObjectNamespace('STUDENTS');return ns.get(ns.idFromName('student-v1:'+owner));};
  return { request, headers, calls, list, status, restart,exhaust:async()=>{const ns=await runtime.mf.getDurableObjectNamespace('COLLECTION_BUDGETS');await ns.getByName('google-calendar-v1').exhaust();},inspect:async()=>(await probe()).inspectSchedule(),failNextSchedule:async()=>(await probe()).failNextSchedule() };
}


async function select(f){await f.list();const response=await f.request('/api/google/selection',{method:'POST',headers:f.headers,body:{id:'google_a',connection_generation:1,calendar_ids:['example-calendar'],expected_revision:0,operation_id:'synthetic_select'}});assert.equal(response.status,200);return response.json();}
const waitFor=async check=>{const until=Date.now()+20000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Synthetic scheduled collection timed out');};
const events=f=>f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar');
test('saved selection wakes automatically after a full runtime restart and publishes only its final page',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 const f=await setup(t,{eventsResponse:async(request,count)=>{if(count===1){return Response.json({items:[{id:'a',status:'confirmed',summary:'Synthetic first',start:{date:'2026-10-12'},end:{date:'2026-10-13'}}],nextPageToken:'example-page',timeZone:'UTC'});}await gate;assert.equal(new URL(request.url).searchParams.get('pageToken'),'example-page');return Response.json({items:[{id:'b',status:'confirmed',summary:'Synthetic second',start:{date:'2026-10-13'},end:{date:'2026-10-14'}}],nextSyncToken:'example-sync',timeZone:'UTC'});}});
 await select(f);const savedAlarm=(await f.inspect()).alarm;assert.ok(savedAlarm>Date.now());await f.restart();assert.equal((await f.inspect()).alarm,savedAlarm);await waitFor(()=>f.calls.events===2);
 assert.deepEqual((await (await events(f)).json()).events,[]);assert.equal((await f.status()).live_sync,false);
 release();await waitFor(async()=>(await f.status()).live_sync);const snapshot=await(await events(f)).json();assert.equal(snapshot.snapshot_complete,true);assert.deepEqual(snapshot.events.map(e=>e.id),['a','b']);
 assert.equal((await f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar',{student:'b'})).status,409);
 assert.equal((await f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar&tenantId=synthetic_foreign')).status,400);
 const first=await(await f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar&limit=1')).json();
 assert.equal((await f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar&cursor='+first.next_cursor)).status,400);
 const next=await(await f.request('/api/google/events?connection_id=google_a&calendar_id=example-calendar&cursor='+first.next_cursor+'&snapshot_id='+first.snapshot_id)).json();assert.equal(next.events[0].id,'b');
 await f.restart();assert.equal((await(await events(f)).json()).snapshot_id,snapshot.snapshot_id);assert.equal(f.calls.events,2);
 const output=await(await f.request('/api/account/export')).text();assert.doesNotMatch(output,/example-sync|example-page|example-existing-refresh|reservationId|next_allowed/);
});
test('feature off never schedules selected calendars and rejects event reads',async t=>{
 const f=await setup(t,{enabled:false});await select(f);await new Promise(r=>setTimeout(r,1500));assert.equal(f.calls.events,0);assert.equal((await events(f)).status,409);assert.equal((await f.status()).collection,undefined);
});
test('disconnect while an automatic fetch is in flight erases its schedule and fences late publication',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());
 const f=await setup(t,{eventsResponse:async()=>{await gate;return Response.json({items:[{id:'late',status:'confirmed',summary:'Synthetic late',start:{date:'2026-10-12'},end:{date:'2026-10-13'}}],nextSyncToken:'example-sync'});}});
 await select(f);await waitFor(()=>f.calls.events===1);const status=await f.status();assert.equal((await f.request('/api/google/disconnect',{method:'POST',headers:f.headers,body:{connection_id:'google_a',expected_revision:status.revision}})).status,200);release();
 await waitFor(async()=>(await f.status()).collection.scheduler.status==='idle');await f.restart();assert.equal((await f.status()).status,'disconnected');assert.equal((await events(f)).status,409);assert.deepEqual((await(await f.request('/api/account/export')).json()).data.google_calendar_snapshots,[]);assert.equal(f.calls.events,1);
});

test('selection receipt and wakeup roll back together when alarm storage fails',async t=>{
 const f=await setup(t);await f.list();await f.failNextSchedule();const packet={id:'google_a',connection_generation:1,calendar_ids:['example-calendar'],expected_revision:0,operation_id:'synthetic_rollback_selection'};
 const save=()=>f.request('/api/google/selection',{method:'POST',headers:f.headers,body:packet});assert.equal((await save()).status,503);assert.equal((await f.inspect()).alarm,null);assert.equal((await f.request('/api/receipts/'+packet.operation_id)).status,404);assert.equal((await(await f.request('/api/google/selection?connection_id=google_a')).json()).record,null);
 assert.equal((await save()).status,200);await waitFor(()=>f.calls.events===1);await waitFor(async()=>(await f.status()).live_sync);
});

test('shared request budget denies provider work and preserves its cooldown across restart and reselection',async t=>{
 const f=await setup(t);await f.exhaust();await select(f);await waitFor(async()=>(await f.status()).collection.scheduler.error==='collection_global_limit');assert.equal(f.calls.events,0);const before=(await f.status()).collection.scheduler.next_run_at;
 await f.restart();assert.equal((await f.status()).collection.scheduler.next_run_at,before);
 for(let i=1;i<=2;i++){const response=await f.request('/api/google/selection',{method:'POST',headers:f.headers,body:{id:'google_a',connection_generation:1,calendar_ids:['example-calendar'],expected_revision:i,operation_id:'synthetic_retry_'+i}});assert.equal(response.status,200);}
 assert.equal((await f.status()).collection.scheduler.next_run_at,before);assert.equal(f.calls.events,0);
});
test('workspace deletion cancels the alarm and a pending provider reply cannot restore student data',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);t.after(()=>release());const f=await setup(t,{eventsResponse:async()=>{await gate;return Response.json({items:[],nextSyncToken:'example-sync'});}});await select(f);await waitFor(()=>f.calls.events===1);
 const snapshot=await(await f.request('/api/account/export')).json();assert.equal((await f.request('/api/account',{method:'DELETE',headers:f.headers,body:{operation_id:'synthetic_delete',expected_revision:snapshot.account_revision,confirm:'DELETE_MY_WORKSPACE'}})).status,200);assert.equal((await f.inspect()).alarm,null);release();await f.restart();assert.equal((await f.inspect()).alarm,null);assert.equal((await(await f.request('/api/account/export')).json()).deleted,true);assert.equal(f.calls.events,1);
});
