// Copyright 2026 Daksh Breja. All rights reserved. Synthetic responses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleCalendarClient, GOOGLE_LIMITS } from '../src/google-calendar.js';
import { sealCredential, openCredential } from '../src/credential-envelope.js';
import { base64url } from 'jose';

const token = 'synthetic-access-token';
const event = () => ({ id: 'event_a', status: 'confirmed', summary: 'Synthetic quiz', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } });
const response = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
function fixture(...responses) {
  const requests = [];
  const client = createGoogleCalendarClient({ fetcher: async (url, init) => { requests.push({ url: new URL(url), ...init }); return responses.shift(); } });
  return { client, requests };
}
const args = { accessToken: token, calendarId: 'calendar@synthetic.invalid' };

test('Google pages keep a fixed origin, header-only credential and explicit continuation', async () => {
  const f = fixture(response({ items: [event()], nextPageToken: 'page_2' }), response({ items: [], nextSyncToken: 'sync_2', timeZone: 'America/New_York' }));
  const first = await f.client.eventsPage(args);
  assert.equal(first.collection_complete, false);
  assert.equal(first.next_sync_token, null);
  assert.equal(first.recurrence_expanded, false);
  const last = await f.client.eventsPage({ ...args, pageToken: first.next_page_token });
  assert.equal(last.collection_complete, true);
  assert.equal(last.next_sync_token, 'sync_2');
  assert.equal(last.time_zone, 'America/New_York');
  for (const r of f.requests) {
    assert.equal(r.url.origin, 'https://www.googleapis.com');
    assert.equal(r.url.pathname, '/calendar/v3/calendars/calendar%40synthetic.invalid/events');
    assert.equal(r.url.searchParams.get('singleEvents'), 'false');
    assert.equal(r.url.searchParams.get('showDeleted'), 'true');
    assert.equal(r.url.searchParams.get('maxResults'), '100');
    assert.equal(r.url.href.includes(token), false);
    assert.equal(r.headers.Authorization, `Bearer ${token}`);
    assert.equal(r.redirect, 'manual');
    assert.equal(r.method, 'GET');
  }
});

test('incremental pagination retains the original sync cursor and no incompatible filters', async () => {
  const f = fixture(response({ items: [], nextPageToken: 'page_2' }), response({ items: [{ id: 'deleted_a', status: 'cancelled' }], nextSyncToken: 'new_sync' }));
  const first = await f.client.eventsPage({ ...args, syncToken: 'old_sync' });
  const last = await f.client.eventsPage({ ...args, syncToken: 'old_sync', pageToken: first.next_page_token });
  assert.deepEqual(last.items, [{ id: 'deleted_a', status: 'cancelled' }]);
  for (const r of f.requests) {
    assert.equal(r.url.searchParams.get('syncToken'), 'old_sync');
    for (const key of ['timeMin', 'timeMax', 'updatedMin', 'q', 'orderBy']) assert.equal(r.url.searchParams.has(key), false);
  }
});

test('calendar choices expose only selected metadata, no event or attendee data', async () => {
  const f = fixture(response({ items: [{ id: 'cal_a', accessRole: 'reader', summary: 'Synthetic', primary: false, timeZone: 'UTC', privateUnknown: 'omit' }], nextPageToken: 'more' }));
  const result = await f.client.calendarsPage({ accessToken: token });
  assert.deepEqual(result.items[0], { id: 'cal_a', accessRole: 'reader', summary: 'Synthetic', primary: false, timeZone: 'UTC' });
  assert.equal(result.collection_complete, false);
  assert.equal(f.requests[0].url.searchParams.get('minAccessRole'), 'reader');
  assert.equal(f.requests[0].url.pathname, '/calendar/v3/users/me/calendarList');
});

test('recurring masters and cancelled instances preserve original source identity without expansion claims', async () => {
  const master = { ...event(), recurrence: ['RRULE:FREQ=WEEKLY'], description: '<script>literal source text</script>', attendees: [{ email: 'not-collected@synthetic.invalid' }] };
  const cancelled = { id: 'occurrence_a', status: 'cancelled', recurringEventId: 'event_a', originalStartTime: { date: '2026-10-27' } };
  const f = fixture(response({ items: [master, cancelled], nextSyncToken: 'sync_a' }));
  const result = await f.client.eventsPage(args);
  assert.deepEqual(result.items[1], cancelled);
  assert.deepEqual(result.items[0].recurrence, master.recurrence);
  assert.equal(result.items[0].description, master.description);
  assert.equal(result.items[0].attendees, undefined);
  assert.equal(result.recurrence_expanded, false);
});

test('malformed or incomplete pages never produce a success or usable sync cursor', async () => {
  for (const body of [null, {}, { items: [] }, { items: [], nextPageToken: 'x', nextSyncToken: 'y' },
    { items: [event(), event()], nextSyncToken: 's' },
    { items: Array.from({ length: 101 }, (_, i) => ({ ...event(), id: `e${i}` })), nextSyncToken: 's' },
    { items: [{ ...event(), start: { date: '2026-02-31' } }], nextSyncToken: 's' },
    { items: [{ ...event(), start: { dateTime: '2026-99-20T12:00:00Z' } }], nextSyncToken: 's' },
    { items: [{ ...event(), end: { date: '2026-10-19' } }], nextSyncToken: 's' },
    { items: [{ ...event(), start: { dateTime: '2026-10-20T12:00:00' } }], nextSyncToken: 's' },
    { items: [{ ...event(), status: 'invented' }], nextSyncToken: 's' },
    { items: [{ ...event(), end: undefined }], nextSyncToken: 's' },
    { items: [event()], nextSyncToken: '' }]) {
    const f = fixture(response(body));
    await assert.rejects(f.client.eventsPage(args), { code: 'calendar_provider_invalid_response' });
  }
});

test('provider failures classify reconnect, full reset and retry without leaking responses', async () => {
  for (const [status, code, retryable] of [[401, 'calendar_authorization_required', false], [410, 'calendar_full_sync_required', false], [404, 'calendar_not_accessible', false], [302, 'calendar_provider_redirect_rejected', false], [429, 'calendar_provider_unavailable', true], [503, 'calendar_provider_unavailable', true], [400, 'calendar_provider_request_rejected', false]]) {
    const f = fixture(new Response('private provider error', { status, headers: { 'retry-after': '7200', location: 'https://untrusted.invalid/' } }));
    await assert.rejects(f.client.eventsPage({ ...args, syncToken: 'old' }), error => {
      assert.equal(error.code, code); assert.equal(error.retryable, retryable);
      assert.equal(error.retryAfterSeconds, retryable ? 7200 : null);
      assert.equal(JSON.stringify(error).includes('private'), false);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
  for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'forbidden']) {
    const f = fixture(response({ error: { errors: [{ reason }], message: token } }, 403));
    await assert.rejects(f.client.eventsPage(args), error => error.retryable === (reason !== 'forbidden') && !String(error).includes(token));
  }
});

test('provider transport bounds declared/actual bytes, UTF-8, redirects and stalled bodies', async () => {
  for (const res of [new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1000001' } }),
    new Response('x'.repeat(GOOGLE_LIMITS.responseBytes + 1), { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(fixture(res).client.eventsPage(args), { code: 'calendar_provider_invalid_response' });
  }
  let cancelled = false;
  const stalled = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
  const client = createGoogleCalendarClient({ timeoutMs: 20, fetcher: async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(client.eventsPage(args), { code: 'calendar_provider_timeout' });
  assert.equal(cancelled, true);
  await assert.rejects(createGoogleCalendarClient({ timeoutMs: 20, fetcher: () => new Promise(() => {}) }).eventsPage(args), { code: 'calendar_provider_timeout' });
});

test('calendar input cannot redirect requests or inject authorization headers', async () => {
  const f = fixture(response({ items: [], nextSyncToken: 's' }));
  for (const calendarId of ['', '.', '..', 'bad\nheader']) await assert.rejects(f.client.eventsPage({ ...args, calendarId }), { code: 'calendar_provider_invalid_input' });
  await assert.rejects(f.client.eventsPage({ ...args, accessToken: 'bad\r\nheader' }), { code: 'calendar_provider_invalid_input' });
  await assert.rejects(f.client.calendarsPage({ accessToken: token, syncToken: 'unsupported' }), { code: 'calendar_provider_invalid_input' });
  await assert.rejects(f.client.eventsPage({ ...args, timeMin: '2026-10-12T00:00:00Z' }), { code: 'calendar_provider_invalid_input' });
  assert.equal(f.requests.length, 0);
  await f.client.eventsPage({ ...args, calendarId: 'https://untrusted.invalid/a?x=1#fragment' });
  assert.equal(f.requests[0].url.origin, 'https://www.googleapis.com');
  assert.equal(f.requests[0].url.hash, '');
});

const binding = { tenantId: 'synthetic_student_a', connectionId: 'google_a', generation: 1, purpose: 'google_tokens' };
const secret = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
test('credential envelopes survive serialization and use distinct unpredictable IVs', async () => {
  const key = secret(), tokens = { access_token: token, refresh_token: 'example-refresh-token' };
  const a = await sealCredential(key, binding, tokens), b = await sealCredential(key, binding, tokens);
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(JSON.stringify(a).includes(token), false);
  assert.deepEqual(await openCredential(key, binding, JSON.parse(JSON.stringify(a))), tokens);
});

test('credential envelopes reject other students, connections, purposes, generations and keys', async () => {
  const key = secret(), sealed = await sealCredential(key, binding, { token });
  for (const patch of [{ tenantId: 'synthetic_student_b' }, { connectionId: 'google_b' }, { generation: 2 }, { purpose: 'google_oauth_pending' }]) {
    await assert.rejects(openCredential(key, { ...binding, ...patch }, sealed), { code: 'credential_envelope_invalid' });
  }
  await assert.rejects(openCredential(secret(), binding, sealed), { code: 'credential_envelope_invalid' });
  for (const changed of [{ ...sealed, version: 2 }, { ...sealed, owner: 'override' }, { ...sealed, ciphertext: (sealed.ciphertext[0] === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) }, { ...sealed, iv: sealed.iv + '=' }, { ...sealed, ciphertext: 'x'.repeat(40000) }]) {
    await assert.rejects(openCredential(key, binding, changed), { code: 'credential_envelope_invalid' });
  }
});

test('credential envelopes reject weak keys, ambiguous contexts and oversized values', async () => {
  for (const key of ['', 'weak', base64url.encode(new Uint8Array(16)), secret() + '=']) await assert.rejects(sealCredential(key, binding, { token }), { code: 'credential_key_not_configured' });
  for (const patch of [{ generation: 0 }, { tenantId: 'short' }, { connectionId: 'bad/id' }, { purpose: 'arbitrary' }]) await assert.rejects(sealCredential(secret(), { ...binding, ...patch }, { token }), { code: 'credential_context_invalid' });
  await assert.rejects(sealCredential(secret(), binding, { text: '界'.repeat(9000) }), { code: 'credential_payload_invalid' });
});
