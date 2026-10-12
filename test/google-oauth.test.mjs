// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64url } from 'jose';
import { googleConfiguration, googleConfigured, authorizationUrl, createGoogleOAuthClient, GOOGLE_OAUTH_LIMITS } from '../src/google-oauth.js';
import { GOOGLE_CALENDAR_SCOPES } from '../src/google-calendar.js';
const random = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const env = () => ({ GOOGLE_OAUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: 'example-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'example-client-secret', GOOGLE_REDIRECT_URI: 'https://community.example.invalid/api/google/callback', GOOGLE_CREDENTIAL_KEY: random(), TENANT_ID_KEY: random() });
const response = () => ({ access_token: 'example-access-token', refresh_token: 'example-refresh-token', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPES.join(' '), ignored_provider_field: 'example-ignored' });
const request = () => ({ code: 'example-authorization-code', verifier: random(), redirectUri: env().GOOGLE_REDIRECT_URI });
const rejected = (promise, code) => assert.rejects(promise, error => error.code === code);

test('Google authorization stays disabled unless complete independent configuration is valid', () => {
  const valid = env(); assert.equal(googleConfigured(valid), true);
  for (const patch of [{ GOOGLE_OAUTH_ENABLED: '' }, { GOOGLE_CLIENT_SECRET: '' }, { GOOGLE_CREDENTIAL_KEY: valid.TENANT_ID_KEY }, { GOOGLE_REDIRECT_URI: 'http://community.example.invalid/api/google/callback' }, { GOOGLE_REDIRECT_URI: 'https://community.example.invalid/api/google/callback?key=bad' }, { GOOGLE_CLIENT_ID: 'bad' }]) assert.equal(googleConfigured({ ...valid, ...patch }), false);
});

test('consent URL pins Google, two read scopes, offline access and PKCE without client secret', () => {
  const config = googleConfiguration(env()), intent = { state: random(), code_challenge: random() };
  const url = new URL(authorizationUrl(config, 'google_a', intent));
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPES.join(' '));
  assert.equal(url.searchParams.get('state'), 'google_a.' + intent.state); assert.equal(url.searchParams.get('code_challenge'), intent.code_challenge);
  assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('prompt'), 'consent select_account'); assert.equal(url.href.includes(config.clientSecret), false);
});

test('one bounded code exchange pins destination, verifies scopes and preserves refresh expiry', async () => {
  const config = googleConfiguration(env()), input = request(); let count = 0;
  const client = createGoogleOAuthClient({ clock: () => 1000, fetcher: async (url, options) => {
    count++; assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    const body = new URLSearchParams(options.body); assert.equal(body.get('code'), input.code); assert.equal(body.get('code_verifier'), input.verifier); assert.equal(body.get('client_secret'), config.clientSecret); assert.equal(body.get('redirect_uri'), config.redirectUri);
    return Response.json({ ...response(), refresh_token_expires_in: 86400 });
  } });
  const tokens = await client.exchange(config, input);
  assert.equal(tokens.expires_at, 3601000); assert.equal(tokens.refresh_expires_at, 86401000); assert.deepEqual(tokens.scopes, GOOGLE_CALENDAR_SCOPES); assert.equal(tokens.ignored_provider_field, undefined); assert.equal(count, 1);
});

test('malformed, missing or overbroad credentials and wrong token types fail closed', async () => {
  const config = googleConfiguration(env());
  for (const patch of [{ refresh_token: '' }, { access_token: 'example-invalid\nvalue' }, { expires_in: -1 }, { expires_in: '3600' }, { token_type: 'MAC' }, { scope: '' }, { scope: GOOGLE_CALENDAR_SCOPES.join(' ') + ' mail' }, { refresh_token_expires_in: 0 }]) {
    await assert.rejects(createGoogleOAuthClient({ fetcher: async () => Response.json({ ...response(), ...patch }) }).exchange(config, request()));
  }
});

test('redirects, errors, oversized JSON and unknown exchange outcomes never retry or echo provider text', async () => {
  const config = googleConfiguration(env());
  for (const [factory, code] of [
    [() => new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }), 'google_exchange_redirect_rejected'],
    [() => Response.json({ error: 'invalid_grant', error_description: 'example-private-error' }, { status: 400 }), 'google_authorization_rejected'],
    [() => Response.json({ error: 'invalid_client' }, { status: 401 }), 'google_client_rejected'],
    [() => Response.json({ error: 'example-private-error' }, { status: 500 }), 'google_exchange_uncertain'],
    [() => new Response('x'.repeat(GOOGLE_OAUTH_LIMITS.responseBytes + 1)), 'google_token_response_invalid'],
    [() => new Response('not json'), 'google_token_response_invalid'],
    [() => { throw new Error('example-private-network-error'); }, 'google_exchange_uncertain'],
  ]) {
    let count = 0; await rejected(createGoogleOAuthClient({ fetcher: async () => { count++; return factory(); } }).exchange(config, request()), code); assert.equal(count, 1);
  }
});

test('exchange deadlines also cover a stalled response body and cancellation', async () => {
  let cancelled = false;
  const client = createGoogleOAuthClient({ timeoutMs: 5, fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await rejected(client.exchange(googleConfiguration(env()), request()), 'google_exchange_uncertain'); assert.equal(cancelled, true);
});

test('deployment defaults redact query strings and disable automatic request logs and tracing', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.observability.redact_query_string, true);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
  assert.notEqual(config.vars.GOOGLE_OAUTH_ENABLED, 'true');
});

test('refresh preserves omitted refresh token, scope and expiry; accepts an explicit token replacement', async () => {
  const config = googleConfiguration(env()), previous = { refresh_token: 'example-old-refresh-token', scopes: [...GOOGLE_CALENDAR_SCOPES], refresh_expires_at: 9000000 };
  let requests = 0;
  const client = createGoogleOAuthClient({ clock: () => 1000, fetcher: async (url, options) => {
    requests++; const form = new URLSearchParams(options.body);
    assert.equal(form.get('grant_type'), 'refresh_token'); assert.equal(form.get('refresh_token'), previous.refresh_token); assert.equal(form.has('code'), false);
    return Response.json({ access_token: 'example-new-access-token', token_type: 'Bearer', expires_in: 3600, ...(requests === 2 ? { refresh_token: 'example-rotated-refresh-token' } : {}) });
  } });
  const first = await client.refresh(config, previous);
  assert.equal(first.refresh_token, previous.refresh_token); assert.deepEqual(first.scopes, previous.scopes); assert.equal(first.refresh_expires_at, previous.refresh_expires_at);
  assert.equal((await client.refresh(config, previous)).refresh_token, 'example-rotated-refresh-token'); assert.equal(requests, 2);
});

test('refresh distinguishes revoked grants and honors numeric and date Retry-After without retrying', async () => {
  const config = googleConfiguration(env()), previous = { refresh_token: 'example-refresh-token', scopes: [...GOOGLE_CALENDAR_SCOPES] };
  await rejected(createGoogleOAuthClient({ fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) }).refresh(config, previous), 'google_reauthorization_required');
  await rejected(createGoogleOAuthClient({ clock: () => 1000, fetcher: async () => { throw new Error('must not fetch'); } }).refresh(config, { ...previous, refresh_expires_at: 1000 }), 'google_reauthorization_required');
  for (const [header, expected] of [['120', 120], ['Thu, 01 Jan 1970 00:02:01 GMT', 120]]) {
    let count = 0;
    await assert.rejects(createGoogleOAuthClient({ clock: () => 1000, fetcher: async () => { count++; return new Response('not JSON', { status: 429, headers: { 'Retry-After': header } }); } }).refresh(config, previous), error => error.code === 'google_refresh_unavailable' && error.retryAfterSeconds === expected);
    assert.equal(count, 1);
  }
});
