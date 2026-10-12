// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64url } from 'jose';
import { StudentStore } from '../src/store.js';
import { GoogleConnectionState } from '../src/google-connection-state.js';
import { GOOGLE_CALENDAR_SCOPES } from '../src/google-calendar.js';
import { sqliteFixture } from './sqlite-fixture.mjs';
const A = 'synthetic_student_alpha', B = 'synthetic_student_bravo', NOW = Date.parse('2026-10-12T12:00:00Z');
const random = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const choice = id => ({ id, summary: '<script>Synthetic ' + id + '</script>', timeZone: 'UTC', accessRole: 'owner' });
async function setup(t, options = {}) {
  const fixture = sqliteFixture(options); t.after(() => fixture.close()); let now = NOW, sequence = 0;
  const store = new StudentStore(fixture.storage, { clock: () => new Date(now).toISOString() });
  const state = new GoogleConnectionState(store, { key: random(), clock: () => now });
  const write = (op, data, expectedRevision = 0, operationId = 'synthetic_save_' + ++sequence) => store.dispatch({ tenantId: A, op, data, expectedRevision, operationId });
  const read = (op, data = {}) => store.dispatch({ tenantId: A, op, data });
  await write('profile.put', { display_name: 'Synthetic Student', timezone: 'UTC', consent_version: 'test-v1' });
  await write('connections.put', { id: 'google_a', provider: 'google_calendar', site_url: 'https://calendar.google.com/' });
  const authorize = async () => {
    const browser = random(), old = state.status(A, 'google_a');
    const intent = await state.beginAuthorization(A, { connectionId: 'google_a', expectedRevision: old.revision, attemptId: 'synthetic_auth_' + ++sequence, browserBinding: browser, redirectUri: 'https://synthetic.example/callback' });
    const claim = await state.consumeAuthorization(A, { connectionId: 'google_a', state: intent.state, browserBinding: browser });
    await state.finishAuthorization(A, { connectionId: 'google_a', generation: claim.generation, lease: claim.lease, credentials: { access_token: 'example-token', refresh_token: 'example-refresh-token', expires_at: now + 3600000, scopes: [...GOOGLE_CALENDAR_SCOPES] } });
  };
  await authorize();
  const cache = items => store.cacheGoogleChoices(A, 'google_a', state.status(A, 'google_a').generation, items);
  const selection = (ids, revision = 0, operationId) => write('google_selection.put', { id: 'google_a', connection_generation: state.status(A, 'google_a').generation, calendar_ids: ids }, revision, operationId);
  return { ...fixture, store, state, write, read, cache, selection, authorize, setNow: value => { now = value; } };
}

test('only source-observed calendar choices save with exact replay, metadata and revision receipts', async t => {
  const f = await setup(t); f.cache([choice('calendar_b'), choice('calendar_a')]);
  const saved = await f.selection(['calendar_b', 'calendar_a'], 0, 'synthetic_selection_1'); assert.equal(saved.ok, true);
  assert.deepEqual(saved.record.calendar_ids, ['calendar_a', 'calendar_b']); assert.equal(saved.record.calendars[0].summary, choice('calendar_a').summary);
  assert.equal(saved.record.last_successful_sync, null); assert.equal(saved.receipt.operation, 'google_selection.put');
  assert.deepEqual(await f.selection(['calendar_a', 'calendar_b'], 0, 'synthetic_selection_1'), { ...saved, replayed: true });
  assert.deepEqual((await f.read('receipt.get', { operation_id: 'synthetic_selection_1' })).receipt, saved.receipt);
  assert.equal((await f.read('google_selection.get', { id: 'google_a' })).active, true);
  assert.equal((await f.selection(['calendar_a'], 0)).error, 'revision_conflict');
});

test('forged calendar IDs, foreign owner, duplicate/oversized selections and stale discovery fail closed', async t => {
  const f = await setup(t); f.cache([choice('calendar_a')]);
  assert.equal((await f.selection(['unobserved_calendar'])).error, 'calendar_choice_not_verified');
  assert.equal((await f.selection(['calendar_a', 'calendar_a'])).error, 'duplicate_calendar_selection');
  assert.equal((await f.selection(Array.from({ length: 21 }, (_, i) => 'calendar_' + i))).error, 'invalid_calendar_selection');
  assert.equal((await f.store.dispatch({ tenantId: B, op: 'google_selection.get', data: { id: 'google_a' } })).error, 'owner_mismatch');
  f.setNow(NOW + 3600000); assert.equal((await f.selection(['calendar_a'])).error, 'calendar_choice_not_verified');
  assert.equal((await f.read('google_selection.get', { id: 'google_a' })).record, null);
});

test('retained choices can be removed after discovery expiry without granting unobserved access', async t => {
  const f = await setup(t); f.cache([choice('calendar_a'), choice('calendar_b')]); await f.selection(['calendar_a', 'calendar_b']);
  f.setNow(NOW + 7200000);
  assert.equal((await f.selection(['calendar_a'], 1)).ok, true);
  assert.equal((await f.selection(['calendar_a', 'calendar_b'], 2)).error, 'calendar_choice_not_verified');
  assert.equal((await f.selection([], 2)).ok, true);
  assert.deepEqual((await f.read('google_selection.get', { id: 'google_a' })).record.calendar_ids, []);
});

test('disconnect invalidates selection and discovery; a new authorization cannot silently reuse either', async t => {
  const f = await setup(t); f.cache([choice('calendar_a')]); const saved = await f.selection(['calendar_a'], 0, 'synthetic_selection_1');
  f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: f.state.status(A, 'google_a').revision });
  assert.equal((await f.read('google_selection.get', { id: 'google_a' })).active, false); assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_choices').n, 0);
  // A historical save receipt can be recovered without reactivating selection.
  const replay = await f.write('google_selection.put', { id: 'google_a', connection_generation: 1, calendar_ids: ['calendar_a'] }, 0, 'synthetic_selection_1');
  assert.deepEqual(replay, { ...saved, replayed: true }); assert.equal((await f.read('google_selection.get', { id: 'google_a' })).active, false);
  await f.authorize(); assert.equal((await f.selection(['calendar_a'], 1)).error, 'calendar_choice_not_verified');
  f.cache([choice('calendar_a')]); assert.equal((await f.selection(['calendar_a'], 1)).ok, true);
});

test('choice cache is bounded atomically and cannot be written after deletion or for an old generation', async t => {
  const f = await setup(t);
  for (let page = 0; page < 10; page++) f.cache(Array.from({ length: 100 }, (_, i) => choice('calendar_' + (page * 100 + i))));
  assert.throws(() => f.cache([choice('one_too_many')]), error => error.code === 'calendar_choices_limit'); assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_choices').n, 1000);
  assert.throws(() => f.store.cacheGoogleChoices(A, 'google_a', 0, [choice('stale')]), error => error.code === 'google_access_changed');
  await f.write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, (await f.read('account.export')).account_revision);
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_choices').n, 0);
  assert.throws(() => f.cache([choice('late')]), error => error.code === 'account_deleted');
});

test('selection and receipt rollback together; exports include choices but exclude discovery cache and credentials', async t => {
  let failing = false;
  const f = await setup(t, { beforeExec: query => { if (failing && query.startsWith('INSERT INTO records')) throw new Error('synthetic storage failure'); } });
  f.cache([choice('calendar_a'), choice('unselected_b')]); failing = true;
  assert.equal((await f.selection(['calendar_a'], 0, 'synthetic_selection_1')).error, 'storage_unavailable');
  assert.equal((await f.read('receipt.get', { operation_id: 'synthetic_selection_1' })).error, 'receipt_not_found');
  failing = false; assert.equal((await f.selection(['calendar_a'], 0, 'synthetic_selection_1')).ok, true);
  const exported = await f.read('account.export'); assert.deepEqual(exported.data.google_selection[0].calendar_ids, ['calendar_a']);
  assert.equal(JSON.stringify(exported).includes('unselected_b'), false); assert.equal(JSON.stringify(exported).includes('ciphertext'), false);
});
