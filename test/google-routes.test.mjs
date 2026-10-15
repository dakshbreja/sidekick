// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64url } from 'jose';
import { createRuntime } from './runtime-fixture.mjs';
import { GOOGLE_CALENDAR_SCOPES } from '../src/google-calendar.js';

const bindings = () => ({ GOOGLE_OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'example-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'example-client-secret', GOOGLE_REDIRECT_URI: 'https://community.example.invalid/api/google/callback', GOOGLE_CREDENTIAL_KEY: base64url.encode(crypto.getRandomValues(new Uint8Array(32))) });
async function setup(t, provider) {
  const exchanges = [];
  const runtime = await createRuntime({ bindings: bindings(), providerFetch: async request => {
    assert.equal(request.url, 'https://oauth2.googleapis.com/token'); assert.equal(request.method, 'POST');
    const form = new URLSearchParams(await request.text()); exchanges.push(form);
    return provider ? provider(form) : Response.json({ access_token: 'example-access-token', refresh_token: 'example-refresh-token', token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' '), expires_in: 3600 });
  } });
  t.after(() => runtime.close());
  for (const student of ['a', 'b']) {
    for (const [path, data, operation_id] of [
      ['/api/onboarding', { display_name: 'Synthetic Student', timezone: 'UTC', consent_version: 'test-v1' }, 'synthetic_profile_1'],
      ['/api/connections', { id: 'google_a', provider: 'google_calendar', site_url: 'https://calendar.google.com/' }, 'synthetic_connection_1'],
    ]) assert.equal((await runtime.request(path, { student, method: 'PUT', body: { ...data, operation_id, expected_revision: 0 } })).status, 200);
  }
  const owner = (await (await runtime.request('/api/onboarding')).json()).workspace_id;
  const headers = { 'X-Workspace-Id': owner };
  const prepared = await runtime.request('/api/google/prepare', { method: 'POST', headers, body: {} });
  assert.equal(prepared.status, 200);
  const cookie = prepared.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax/);
  headers.Cookie = cookie.split(';')[0];
  const begin = async (extra = {}) => runtime.request('/api/google/begin', { method: 'POST', headers, body: { connection_id: 'google_a', attempt_id: 'synthetic_attempt_1', expected_revision: 0, ...extra } });
  const start = async () => { const response = await begin(); assert.equal(response.status, 200); const body = await response.json(); return new URL(body.authorization_url); };
  const callback = (url, options = {}) => runtime.request('/api/google/callback?state=' + encodeURIComponent(url.searchParams.get('state')) + '&code=example-authorization-code', { headers: { Cookie: headers.Cookie }, ...options });
  const status = async (student = 'a') => (await (await runtime.request('/api/google/status?connection_id=google_a', { student })).json()).connection;
  return { ...runtime, exchanges, owner, headers, begin, start, callback, status };
}

test('authenticated real Worker completes consent without exposing credentials; exact begin retry and callback replay are safe', async t => {
  const f = await setup(t), url = await f.start();
  const retry = await (await f.begin()).json(); assert.equal(retry.authorization_url, url.href);
  const returned = await f.callback(url); assert.equal(returned.status, 303); assert.equal(returned.headers.get('location'), '/?calendar=authorized#sources'); assert.equal(returned.headers.get('referrer-policy'), 'no-referrer');
  const state = await f.status(); assert.equal(state.authorized, true); assert.equal(state.live_sync, false); assert.equal(state.last_successful_sync, null);
  const form = f.exchanges[0];
  const challenge = base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier')))));
  assert.equal(challenge, url.searchParams.get('code_challenge')); assert.equal(form.get('redirect_uri'), f.origin + '/api/google/callback');
  assert.equal((await f.callback(url)).headers.get('location'), '/?calendar=failed#sources'); assert.equal(f.exchanges.length, 1);
  assert.equal((await f.status('b')).status, 'needs_authorization');
  const exported = await (await f.request('/api/account/export')).text(); assert.equal(exported.includes('example-access-token'), false); assert.equal(exported.includes('ciphertext'), false);
  const removed = await f.request('/api/google/disconnect', { method: 'POST', headers: f.headers, body: { connection_id: 'google_a', expected_revision: state.revision } });
  assert.equal((await removed.json()).connection.provider_revocation, 'not_attempted'); assert.equal((await f.status()).status, 'disconnected');
});

test('wrong account, absent/duplicate browser cookie and changed state cannot exchange an authorization code', async t => {
  const f = await setup(t), url = await f.start();
  for (const options of [{ student: 'b' }, { student: null }, { headers: {} }, { headers: { Cookie: f.headers.Cookie + '; ' + f.headers.Cookie } }]) {
    const result = await f.callback(url, options); assert.equal(result.headers.get('location'), '/?calendar=failed#sources');
  }
  const changed = new URL(url); changed.searchParams.set('state', 'google_a.' + base64url.encode(crypto.getRandomValues(new Uint8Array(32))));
  assert.equal((await f.callback(changed)).headers.get('location'), '/?calendar=failed#sources');
  assert.equal(f.exchanges.length, 0); assert.equal((await f.status()).status, 'authorizing');
  assert.equal((await f.callback(url)).headers.get('location'), '/?calendar=authorized#sources');
});

test('new Google mutations require verified workspace, same origin, cookie and strict fields', async t => {
  const f = await setup(t);
  for (const headers of [{}, { 'X-Workspace-Id': 'synthetic_wrong_owner' }, { ...f.headers, Origin: 'https://foreign.example' }, { ...f.headers, Origin: '' }]) {
    assert.equal((await f.request('/api/google/prepare', { method: 'POST', body: {}, headers })).status, 403);
  }
  assert.equal((await f.request('/api/google/begin', { method: 'POST', headers: { 'X-Workspace-Id': f.owner }, body: { connection_id: 'google_a', attempt_id: 'synthetic_attempt_1', expected_revision: 0 } })).status, 409);
  assert.equal((await f.begin({ tenantId: 'synthetic_foreign' })).status, 400);
  assert.equal((await f.begin({ redirectUri: 'https://foreign.example/' })).status, 400);
  assert.equal(f.exchanges.length, 0);
});

test('declined consent and malformed callbacks remove no existing source data and expose no query', async t => {
  const f = await setup(t), url = await f.start();
  const state = encodeURIComponent(url.searchParams.get('state'));
  const malformed = await f.request('/api/google/callback?state=' + state + '&state=duplicate&code=example-code', { headers: { Cookie: f.headers.Cookie } });
  assert.equal(malformed.headers.get('location'), '/?calendar=failed#sources'); assert.equal(await malformed.text(), '');
  const denied = await f.request('/api/google/callback?state=' + state + '&error=access_denied', { headers: { Cookie: f.headers.Cookie } });
  assert.equal(denied.headers.get('location'), '/?calendar=failed#sources'); assert.equal((await f.status()).status, 'authorization_denied'); assert.equal(f.exchanges.length, 0);
  assert.equal((await (await f.request('/api/onboarding')).json()).connections.length, 1);
});

test('uncertain provider exchange is recorded once and cannot be replayed from browser refresh', async t => {
  const f = await setup(t, () => Response.json({ error: 'example-private-provider-error' }, { status: 503 })), url = await f.start();
  assert.equal((await f.callback(url)).headers.get('location'), '/?calendar=failed#sources');
  assert.equal((await f.status()).status, 'authorization_failed');
  await f.callback(url); assert.equal(f.exchanges.length, 1);
});

test('default deployment has no Google capability and rejects all source activation', async t => {
  const f = await createRuntime(); t.after(() => f.close());
  assert.equal((await (await f.request('/api/onboarding')).json()).capabilities.google_calendar_oauth, false);
  assert.equal((await f.request('/api/google/status?connection_id=google_a')).status, 503);
  assert.equal((await f.request('/api/google/callback?code=example-code&state=example-state')).headers.get('location'), '/?calendar=failed#sources');
  assert.equal(f.outboundRequests.every(r => r.url.endsWith('/cdn-cgi/access/certs')), true);
});

test('disconnect while the provider exchange is in flight prevents late credentials from becoming active', async t => {
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await setup(t, async () => { entered(); await gate; return Response.json({ access_token: 'example-access-token', refresh_token: 'example-refresh-token', token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' '), expires_in: 3600 }); });
  const url = await f.start(), callback = f.callback(url); await reached;
  const exchanging = await f.status(); assert.equal(exchanging.status, 'exchanging');
  assert.equal((await f.request('/api/google/disconnect', { method: 'POST', headers: f.headers, body: { connection_id: 'google_a', expected_revision: exchanging.revision } })).status, 200);
  release(); assert.equal((await callback).headers.get('location'), '/?calendar=failed#sources');
  assert.equal((await f.status()).status, 'disconnected'); assert.equal(f.exchanges.length, 1);
});

test('account deletion while a provider exchange is pending cannot restore a deleted workspace', async t => {
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await setup(t, async () => { entered(); await gate; return Response.json({ access_token: 'example-access-token', refresh_token: 'example-refresh-token', token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' '), expires_in: 3600 }); });
  const url = await f.start(), callback = f.callback(url); await reached;
  const exported = await (await f.request('/api/account/export')).json();
  assert.equal((await f.request('/api/account', { method: 'DELETE', headers: f.headers, body: { operation_id: 'synthetic_delete_1', expected_revision: exported.account_revision, confirm: 'DELETE_MY_WORKSPACE' } })).status, 200);
  release(); assert.equal((await callback).headers.get('location'), '/?calendar=failed#sources');
  assert.equal((await (await f.request('/api/account/export')).json()).deleted, true);
  assert.equal((await f.request('/api/google/status?connection_id=google_a')).status, 410);
  assert.equal((await f.status('b')).status, 'needs_authorization');
});
