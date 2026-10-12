// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64url } from 'jose';
import { StudentStore } from '../src/store.js';
import { GoogleConnectionState, GOOGLE_STATE_LIMITS } from '../src/google-connection-state.js';
import { GOOGLE_CALENDAR_SCOPES } from '../src/google-calendar.js';
import { openCredential } from '../src/credential-envelope.js';
import { sqliteFixture } from './sqlite-fixture.mjs';

const A = 'synthetic_student_alpha', B = 'synthetic_student_bravo';
const random = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const browser = random();
const initialNow = Date.parse('2026-10-12T12:00:00Z');
const beginInput = (extra = {}) => ({ connectionId: 'google_a', expectedRevision: 0, attemptId: 'synthetic_attempt_1', browserBinding: browser, redirectUri: 'https://synthetic.example/oauth/google/callback', ...extra });
const tokens = () => ({ access_token: 'example-access-token', refresh_token: 'example-refresh-token', expires_at: initialNow + 3600000, scopes: [...GOOGLE_CALENDAR_SCOPES] });
async function setup(t, options = {}) {
  const fixture = sqliteFixture(options);
  const store = new StudentStore(fixture.storage, { clock: () => new Date(initialNow).toISOString() });
  let now = initialNow;
  const key = random(), state = new GoogleConnectionState(store, { key, clock: () => now });
  t.after(() => { if (fixture.database.isOpen) fixture.close(); });
  let sequence = 0;
  const write = (op, data, expectedRevision = 0) => store.dispatch({ tenantId: A, op, data, expectedRevision, operationId: `synthetic_write_${++sequence}` });
  const read = (op) => store.dispatch({ tenantId: A, op });
  assert.equal((await write('profile.put', { display_name: 'Synthetic Student', timezone: 'UTC', consent_version: 'test-v1' })).ok, true);
  const register = async (id = 'google_a') => assert.equal((await write('connections.put', { id, provider: 'google_calendar', site_url: 'https://calendar.google.com/' })).ok, true);
  await register();
  const consume = intent => state.consumeAuthorization(A, { connectionId: 'google_a', state: intent.state, browserBinding: browser });
  const finish = (claim, value = tokens()) => state.finishAuthorization(A, { connectionId: 'google_a', generation: claim.generation, lease: claim.lease, credentials: value });
  return { ...fixture, store, state, key, write, read, register, consume, finish, setNow: value => { now = value; } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
function pauseEncryption(t) {
  const original = crypto.subtle.encrypt;
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  crypto.subtle.encrypt = async function (...args) { const result = await original.apply(this, args); entered(); await gate; return result; };
  t.after(() => { crypto.subtle.encrypt = original; release(); });
  return { reached, release };
}

test('pending OAuth survives a real SQLite close/reopen and exact retry preserves state and PKCE', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'community-oauth-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'state.sqlite');
  const f = await setup(t, { filename });
  const first = await f.state.beginAuthorization(A, beginInput());
  f.close();
  const reopened = sqliteFixture({ filename }); t.after(() => reopened.close());
  const restored = new GoogleConnectionState(new StudentStore(reopened.storage), { key: f.key, clock: () => initialNow });
  assert.deepEqual(await restored.beginAuthorization(A, beginInput()), first);
  assert.equal(first.code_challenge_method, 'S256'); assert.equal(first.revision, 1);
  assert.equal(first.authorized, false); assert.equal(first.live_sync, false);
  const claim = await restored.consumeAuthorization(A, { connectionId: 'google_a', state: first.state, browserBinding: browser });
  assert.equal(base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(claim.verifier)))), first.code_challenge);
  assert.equal(claim.redirect_uri, first.redirect_uri);
});

test('tenant, browser, state, redirect and attempt mismatch cannot consume or replace an authorization', async t => {
  const f = await setup(t), intent = await f.state.beginAuthorization(A, beginInput());
  await rejects(f.state.beginAuthorization(B, beginInput()), 'owner_mismatch');
  await rejects(f.state.beginAuthorization(A, beginInput({ browserBinding: random() })), 'authorization_attempt_conflict');
  await rejects(f.state.beginAuthorization(A, beginInput({ redirectUri: 'https://different.example/callback' })), 'authorization_attempt_conflict');
  await rejects(f.state.consumeAuthorization(B, { connectionId: 'google_a', state: intent.state, browserBinding: browser }), 'owner_mismatch');
  await rejects(f.state.consumeAuthorization(A, { connectionId: 'google_a', state: random(), browserBinding: browser }), 'authorization_callback_rejected');
  await rejects(f.state.consumeAuthorization(A, { connectionId: 'google_a', state: intent.state, browserBinding: random() }), 'authorization_callback_rejected');
  const claim = await f.consume(intent);
  assert.equal(claim.generation, 1);
  await rejects(f.consume(intent), 'authorization_callback_rejected');
  await rejects(f.state.beginAuthorization(A, beginInput()), 'authorization_attempt_consumed');
});

test('parallel exact begins converge and competing callbacks get only one exchange lease', async t => {
  const f = await setup(t);
  const results = await Promise.all([f.state.beginAuthorization(A, beginInput()), f.state.beginAuthorization(A, beginInput())]);
  assert.deepEqual(results[0], results[1]);
  const consumed = await Promise.allSettled([f.consume(results[0]), f.consume(results[1])]);
  assert.equal(consumed.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(consumed.find(x => x.status === 'rejected').reason.code, 'authorization_callback_rejected');
  assert.equal(f.state.status(A, 'google_a').revision, 2);
});

test('expired state and exchange leases cannot authorize; a new attempt invalidates an older callback', async t => {
  const f = await setup(t), first = await f.state.beginAuthorization(A, beginInput());
  f.setNow(initialNow + GOOGLE_STATE_LIMITS.pendingMs);
  assert.equal(f.state.status(A, 'google_a').status, 'authorization_expired');
  await rejects(f.consume(first), 'authorization_expired');
  const second = await f.state.beginAuthorization(A, beginInput({ expectedRevision: 1, attemptId: 'synthetic_attempt_2' }));
  await rejects(f.consume(first), 'authorization_callback_rejected');
  const claim = await f.consume(second);
  f.setNow(initialNow + GOOGLE_STATE_LIMITS.pendingMs + GOOGLE_STATE_LIMITS.exchangeMs);
  await rejects(f.finish(claim), 'authorization_exchange_stale');
  assert.equal(f.state.status(A, 'google_a').status, 'authorization_expired');
});

test('authorization stores only contextual ciphertext and makes no successful-sync claim', async t => {
  const f = await setup(t), intent = await f.state.beginAuthorization(A, beginInput());
  const pendingRaw = f.store.row('SELECT body FROM google_connections').body;
  assert.equal(pendingRaw.includes(intent.state), false); assert.equal(pendingRaw.includes(browser), false);
  const claim = await f.consume(intent), result = await f.finish(claim);
  assert.equal(result.status, 'authorized_not_synced'); assert.equal(result.authorized, true);
  assert.equal(result.live_sync, false); assert.equal(result.last_successful_sync, null);
  const raw = f.store.row('SELECT body FROM google_connections').body, row = JSON.parse(raw);
  assert.equal(raw.includes('example-access-token'), false); assert.equal(raw.includes('example-refresh-token'), false);
  assert.equal(raw.includes(claim.verifier), false); assert.equal(row.pending, undefined); assert.equal(row.lease_hash, undefined);
  assert.deepEqual(await openCredential(f.key, { tenantId: A, connectionId: 'google_a', generation: 1, purpose: 'google_tokens' }, row.tokens), tokens());
  for (const binding of [{ tenantId: B }, { connectionId: 'google_b' }, { generation: 2 }]) {
    await assert.rejects(openCredential(f.key, { tenantId: A, connectionId: 'google_a', generation: 1, purpose: 'google_tokens', ...binding }, row.tokens));
  }
  const exported = JSON.stringify(await f.read('account.export'));
  assert.equal(exported.includes('ciphertext'), false); assert.equal(exported.includes('example-refresh-token'), false);
  const receipts = JSON.stringify(f.store.sql.exec('SELECT body FROM operations').toArray());
  assert.equal(receipts.includes('ciphertext'), false); assert.equal(receipts.includes(intent.state), false);
  await rejects(f.finish(claim), 'authorization_exchange_stale'); // response loss: read status, do not re-exchange
  await rejects(f.state.beginAuthorization(A, beginInput({ expectedRevision: 3, attemptId: 'synthetic_attempt_2' })), 'disconnect_required');
});

test('missing refresh, expanded/missing scopes and malformed credentials never count as authorized', async t => {
  const f = await setup(t), claim = await f.consume(await f.state.beginAuthorization(A, beginInput()));
  for (const value of [
    { ...tokens(), refresh_token: '' }, { ...tokens(), access_token: 'example-invalid\nunsafe' },
    { ...tokens(), scopes: [GOOGLE_CALENDAR_SCOPES[0]] }, { ...tokens(), scopes: [...GOOGLE_CALENDAR_SCOPES, 'mail'] },
    { ...tokens(), scopes: [GOOGLE_CALENDAR_SCOPES[0], GOOGLE_CALENDAR_SCOPES[0]] },
    { ...tokens(), expires_at: initialNow }, { ...tokens(), expires_at: initialNow + 90000000 },
  ]) await rejects(f.finish(claim, value), 'invalid_provider_credentials');
  assert.equal(f.state.status(A, 'google_a').authorized, false);
});

test('disconnect erases credentials, is replayable and rejects late exchange commits', async t => {
  const f = await setup(t), claim = await f.consume(await f.state.beginAuthorization(A, beginInput()));
  const erased = f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 2 });
  assert.equal(erased.status, 'disconnected'); assert.equal(erased.provider_revocation, 'not_attempted');
  assert.deepEqual(f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 2 }), erased);
  await rejects(f.finish(claim), 'authorization_exchange_stale');
  const next = await f.state.beginAuthorization(A, beginInput({ expectedRevision: 3, attemptId: 'synthetic_attempt_2' }));
  assert.equal(next.generation, 3);
  await f.finish(await f.consume(next));
  const final = f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 6 });
  assert.equal(final.revision, 7);
  const raw = f.store.row('SELECT body FROM google_connections').body;
  assert.equal(raw.includes('ciphertext'), false); assert.equal(raw.includes('lease'), false);
});

test('disconnect fences an initial begin awaiting encryption before any connection row exists', async t => {
  const f = await setup(t), barrier = pauseEncryption(t);
  const pending = f.state.beginAuthorization(A, beginInput()); await barrier.reached;
  assert.equal(f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 0 }).revision, 1);
  barrier.release(); await rejects(pending, 'revision_conflict');
  assert.equal(f.state.status(A, 'google_a').status, 'disconnected');
});

test('disconnect during final credential encryption prevents a stale authorization from returning', async t => {
  const f = await setup(t), claim = await f.consume(await f.state.beginAuthorization(A, beginInput()));
  const barrier = pauseEncryption(t), pending = f.finish(claim); await barrier.reached;
  f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 2 });
  barrier.release(); await rejects(pending, 'authorization_exchange_stale');
});

test('account deletion atomically clears private state and fences a pending encrypted commit', async t => {
  const f = await setup(t), claim = await f.consume(await f.state.beginAuthorization(A, beginInput()));
  const barrier = pauseEncryption(t), pending = f.finish(claim); await barrier.reached;
  const before = await f.read('account.export');
  assert.equal((await f.write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, before.account_revision)).ok, true);
  barrier.release(); await rejects(pending, 'account_deleted');
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_connections').n, 0);
  assert.equal((await f.read('account.export')).deleted, true);
  await rejects(f.state.beginAuthorization(A, beginInput()), 'account_deleted');
  assert.throws(() => f.state.status(A, 'google_a'), error => error.code === 'account_deleted');
});

test('connector changes increment account revision so a stale account deletion cannot succeed', async t => {
  const f = await setup(t), before = await f.read('account.export');
  await f.state.beginAuthorization(A, beginInput());
  assert.equal((await f.write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, before.account_revision)).error, 'revision_conflict');
  assert.equal(f.state.status(A, 'google_a').status, 'authorizing');
});

test('SQL failure rolls back credential erasure and account tombstone together', async t => {
  let failUpdate = false;
  const f = await setup(t, { beforeExec: query => { if (failUpdate && query.startsWith('UPDATE workspace_meta SET deleted')) throw new Error('synthetic SQL failure'); } });
  await f.state.beginAuthorization(A, beginInput());
  failUpdate = true;
  const result = await f.write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, (await f.read('account.export')).account_revision);
  assert.equal(result.error, 'storage_unavailable');
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_connections').n, 1);
  assert.equal((await f.read('account.export')).deleted, false);
});

test('connection quotas, registration and input bounds apply before storing secrets', async t => {
  const f = await setup(t);
  for (let i = 0; i < GOOGLE_STATE_LIMITS.connections; i++) {
    const connectionId = `google_${i}`; await f.register(connectionId);
    await f.state.beginAuthorization(A, beginInput({ connectionId }));
  }
  await rejects(f.state.beginAuthorization(A, beginInput()), 'connection_limit_reached');
  assert.throws(() => f.state.disconnect(A, { connectionId: 'google_a', expectedRevision: 0 }), error => error.code === 'connection_limit_reached');
  await rejects(f.state.beginAuthorization(A, beginInput({ connectionId: 'not_registered' })), 'google_connection_not_found');
  await rejects(f.state.beginAuthorization(A, beginInput({ browserBinding: 'short' })), 'invalid_oauth_binding');
  await rejects(f.state.beginAuthorization(A, beginInput({ redirectUri: 'https://synthetic.example/callback?secret=bad' })), 'invalid_oauth_redirect');
  await rejects(f.state.beginAuthorization(A, { ...beginInput(), owner: B }), 'unknown_field');
  await rejects(f.state.beginAuthorization('bad', beginInput()), 'invalid_owner');
});

test('bad encryption keys and a failed begin transaction leave no partial authorization', async t => {
  let failSave = false;
  const f = await setup(t, { beforeExec: query => { if (failSave && query.startsWith('UPDATE workspace_meta SET account_revision')) throw new Error('synthetic commit failure'); } });
  const bad = new GoogleConnectionState(f.store, { key: 'not-a-key', clock: () => initialNow });
  await rejects(bad.beginAuthorization(A, beginInput()), 'credential_key_not_configured');
  const before = (await f.read('account.export')).account_revision;
  failSave = true;
  await assert.rejects(f.state.beginAuthorization(A, beginInput()));
  assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_connections').n, 0);
  assert.equal((await f.read('account.export')).account_revision, before);
});

test('generic storage dispatch cannot read or mutate internal connector state', async t => {
  const f = await setup(t);
  await f.state.beginAuthorization(A, beginInput());
  for (const op of ['google.status', 'google.consumeAuthorization', 'google.finishAuthorization', 'google_connections.list']) {
    const result = await f.store.dispatch({ tenantId: A, op });
    assert.equal(result.ok, false); assert.equal(result.error, 'unknown_operation');
  }
});
