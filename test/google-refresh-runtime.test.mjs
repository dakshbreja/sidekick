// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64url } from 'jose';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteQueue } from '../src/write-intent.js';
import { createRuntime } from './runtime-fixture.mjs';
import { GOOGLE_CALENDAR_SCOPES } from '../src/google-calendar.js';

async function setup(t, { initialTtl = 30, refreshResponse, listResponse, persistent = false } = {}) {
  const directory = persistent ? await mkdtemp(join(tmpdir(), 'community-refresh-')) : undefined;
  const bindings = { GOOGLE_OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'example-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'example-client-secret', GOOGLE_REDIRECT_URI: 'https://community.example.invalid/api/google/callback', GOOGLE_CREDENTIAL_KEY: base64url.encode(crypto.getRandomValues(new Uint8Array(32))) };
  const calls = { authorization: 0, refresh: 0, list: 0 };
  const providerFetch = async request => {
    const url = new URL(request.url);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      assert.equal(request.method, 'POST'); const form = new URLSearchParams(await request.text());
      if (form.get('grant_type') === 'authorization_code') { calls.authorization++; return Response.json({ access_token: 'example-old', refresh_token: 'example-existing-refresh', expires_in: initialTtl, token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' ') }); }
      assert.equal(form.get('grant_type'), 'refresh_token'); assert.equal(form.get('refresh_token'), 'example-existing-refresh'); calls.refresh++;
      return refreshResponse ? refreshResponse(form) : Response.json({ access_token: 'example-new', expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(url.pathname, '/calendar/v3/users/me/calendarList'); assert.equal(request.method, 'GET'); calls.list++;
    return listResponse ? listResponse(request) : Response.json({ items: [{ id: 'example-calendar', summary: 'Synthetic calendar', accessRole: 'owner', timeZone: 'UTC' }] });
  };
  let runtime = await createRuntime({ bindings, providerFetch, persistPath: directory });
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
  const restart = async () => { const authFixture = runtime.authFixture; await runtime.close(); runtime = await createRuntime({ bindings, providerFetch, persistPath: directory, authFixture }); };
  return { request, headers, calls, list, status, restart };
}

test('actual Worker refreshes near expiry, lists calendars privately, and reuses the renewed token after restart', async t => {
  const f = await setup(t, { persistent: true });
  assert.equal((await f.list('b')).status, 409); assert.equal(f.calls.refresh, 0);
  const page = await (await f.list()).json(); assert.equal(page.ok, true); assert.equal(page.page.items[0].summary, 'Synthetic calendar'); assert.equal(page.live_sync, false); assert.equal(page.connection.revision, 5);
  assert.deepEqual(f.calls, { authorization: 1, refresh: 1, list: 1 });
  assert.equal((await f.status()).last_successful_sync, null);
  await f.restart(); assert.equal((await f.list()).status, 200); assert.equal(f.calls.refresh, 1);
  const exported = await (await f.request('/api/account/export')).text(); assert.equal(exported.includes('example-existing-refresh'), false); assert.equal(exported.includes('example-new'), false);
});

test('concurrent calendar requests use one durable refresh lease and recover without another consent', async t => {
  let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const f = await setup(t, { refreshResponse: async () => { entered(); await gate; return Response.json({ access_token: 'example-new', expires_in: 3600, token_type: 'Bearer' }); } });
  const first = f.list(); await reached;
  assert.equal((await f.status()).status, 'refreshing'); assert.equal((await f.list()).status, 503); assert.equal(f.calls.refresh, 1);
  release(); assert.equal((await first).status, 200); assert.equal((await f.list()).status, 200); assert.equal(f.calls.authorization, 1); assert.equal(f.calls.refresh, 1);
});

test('a 401 refreshes only once and a repeated 401 invalidates the grant', async t => {
  const f = await setup(t, { initialTtl: 3600, listResponse: request => request.headers.get('Authorization') === 'Bearer example-old' ? new Response(null, { status: 401 }) : Response.json({ items: [] }) });
  assert.equal((await f.list()).status, 200); assert.equal(f.calls.refresh, 1); assert.equal(f.calls.list, 2);
  const g = await setup(t, { initialTtl: 3600, listResponse: () => new Response(null, { status: 401 }) });
  assert.equal((await g.list()).status, 409); assert.equal(g.calls.refresh, 1); assert.equal(g.calls.list, 2); assert.equal((await g.status()).status, 'reauthorization_required');
  assert.equal((await g.list()).status, 409); assert.equal(g.calls.refresh, 1);
});

test('provider throttle persists Retry-After across restart and does not prompt for consent', async t => {
  const f = await setup(t, { persistent: true, refreshResponse: () => new Response(null, { status: 429, headers: { 'Retry-After': '300' } }) });
  const before = Date.now(); assert.equal((await f.list()).status, 503);
  const status = await f.status(); assert.equal(status.authorized, true); assert.equal(status.refresh_error, 'google_refresh_unavailable'); assert.ok(status.retry_at >= before + 300000);
  await f.restart(); assert.equal((await f.list()).status, 503); assert.equal(f.calls.refresh, 1); assert.equal(f.calls.list, 0);
});

test('revoked refresh credential stops calendar requests and reports reauthorization', async t => {
  const f = await setup(t, { refreshResponse: () => Response.json({ error: 'invalid_grant', error_description: 'example-private-detail' }, { status: 400 }) });
  const response = await f.list(); assert.equal(response.status, 409); assert.equal((await response.json()).error, 'google_reauthorization_required');
  assert.equal((await f.status()).authorized, false); assert.equal(f.calls.list, 0);
  assert.equal((await f.list()).status, 409); assert.equal(f.calls.refresh, 1);
});

test('disconnect during refresh and account deletion during calendar fetch discard late provider results', async t => {
  let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const f = await setup(t, { refreshResponse: async () => { entered(); await gate; return Response.json({ access_token: 'example-new', expires_in: 3600, token_type: 'Bearer' }); } });
  const request = f.list(); await reached;
  assert.equal((await f.request('/api/google/disconnect', { method: 'POST', headers: f.headers, body: { connection_id: 'google_a', expected_revision: (await f.status()).revision } })).status, 200);
  release(); assert.equal((await request).status, 409); assert.equal(f.calls.list, 0); assert.equal((await f.status()).status, 'disconnected');
  let listEntered, listRelease; const listReached = new Promise(resolve => { listEntered = resolve; }), listGate = new Promise(resolve => { listRelease = resolve; }); t.after(() => listRelease());
  const g = await setup(t, { initialTtl: 3600, listResponse: async () => { listEntered(); await listGate; return Response.json({ items: [{ id: 'example-calendar', summary: 'Synthetic late response', accessRole: 'owner' }] }); } });
  const listing = g.list(); await listReached;
  const exported = await (await g.request('/api/account/export')).json();
  assert.equal((await g.request('/api/account', { method: 'DELETE', headers: g.headers, body: { operation_id: 'synthetic_delete_1', expected_revision: exported.account_revision, confirm: 'DELETE_MY_WORKSPACE' } })).status, 200);
  listRelease(); const late = await listing; assert.equal(late.status, 410); assert.equal((await late.text()).includes('Synthetic late response'), false);
});

test('invalid listing cursors and caller identity fields cause no token refresh or provider request', async t => {
  const f = await setup(t);
  assert.equal((await f.list('a', '&page_token=' + 'x'.repeat(8193))).status, 400);
  assert.equal((await f.list('a', '&tenantId=synthetic_foreign')).status, 400);
  assert.equal(f.calls.refresh, 0); assert.equal(f.calls.list, 0);
});

test('real authenticated discovery enables receipt-verified selection and survives full restart', async t => {
  const f = await setup(t, { persistent: true });
  const body = { id: 'google_a', connection_generation: 1, calendar_ids: ['example-calendar'], expected_revision: 0, operation_id: 'synthetic_selection_1' };
  const save = () => f.request('/api/google/selection', { method: 'POST', headers: f.headers, body });
  assert.equal((await save()).status, 409);
  await f.list(); assert.equal((await save()).status, 409); body.operation_id = 'synthetic_selection_2'; const saved = await (await save()).json(); assert.equal(saved.ok, true); assert.equal(saved.receipt.operation, 'google_selection.put');
  await f.restart();
  const receipt = await (await f.request('/api/receipts/synthetic_selection_2')).json(); assert.deepEqual(receipt.receipt, saved.receipt);
  assert.equal((await (await save()).json()).replayed, true);
  const selection = await (await f.request('/api/google/selection?connection_id=google_a')).json(); assert.equal(selection.active, true); assert.equal(selection.record.calendars[0].summary, 'Synthetic calendar'); assert.equal(selection.collection_status, 'not_synced');
  assert.equal((await f.request('/api/google/selection?connection_id=google_a', { student: 'b' })).status, 404);
  assert.equal((await f.request('/api/google/selection', { student: 'b', method: 'POST', headers: f.headers, body })).status, 403);
  assert.equal((await f.request('/api/google/selection', { method: 'POST', headers: { ...f.headers, Origin: 'https://foreign.example' }, body })).status, 403);
});


test('real disconnected selection resolves an unsent browser packet through a durable rejection across restart', async t => {
  const f = await setup(t, { persistent: true }); await f.list();
  const owner = f.headers['X-Workspace-Id'], values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
  const queue = () => createWriteQueue({storage,owner});
  const packet = { id:'google_a',connection_generation:1,calendar_ids:['example-calendar'],expected_revision:0,operation_id:'synthetic_lost_selection' };
  const input = {owner,path:'/api/google/selection',method:'POST',data:{id:packet.id,connection_generation:1,calendar_ids:packet.calendar_ids}};
  const api = async (path,options) => {const response=await f.request(path,options);const body=await response.json();if(!body.ok)throw Object.assign(new Error(body.error),{code:body.error,status:response.status});return body;};
  const receipt = operation => api('/api/receipts/'+operation);
  await assert.rejects(queue().run('selection',input,async()=>packet,async()=>{throw new Error('Synthetic request lost before delivery');},receipt));
  await api('/api/google/disconnect',{method:'POST',headers:f.headers,body:{connection_id:'google_a',expected_revision:(await f.status()).revision}});
  await f.restart();let sends=0;
  // Lose the rejection reply too: the outbox must still be present.
  await assert.rejects(queue().reconcile(async(route,p)=>{sends++;await f.request(route.path,{method:route.method,headers:f.headers,body:p});throw new Error('Synthetic rejection response lost');},receipt));
  assert.equal(queue().count(),1);await f.restart();
  const resolved=await queue().reconcile(()=>assert.fail('Terminal receipt must avoid another write'),receipt);
  assert.deepEqual(resolved,{deleted:false,rejected:1});assert.equal(sends,1);assert.equal(values.size,0);
  assert.equal((await api('/api/google/selection?connection_id=google_a')).record,null);
  assert.equal((await f.request('/api/receipts/'+packet.operation_id,{student:'b'})).status,404);
  const late=await f.request('/api/google/selection',{method:'POST',headers:f.headers,body:packet});assert.equal(late.status,409);assert.equal((await late.json()).receipt.outcome,'rejected');
});
