// Copyright 2026 Daksh Breja. All rights reserved.
// Internal connector state only. Never expose these methods through generic
// dispatch/RPC: consumeAuthorization returns a verifier to trusted server code.
import { clearGoogleCollection } from './google-collection-state.js';
import { base64url } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { sealCredential, openCredential } from './credential-envelope.js';
import { GOOGLE_CALENDAR_SCOPES } from './google-calendar.js';
import { fail, id, object, operationId, revision, string } from './validation.js';

export const GOOGLE_STATE_LIMITS = Object.freeze({ connections: 8, pendingMs: 600000, exchangeMs: 60000, refreshMs: 60000, refreshSkewMs: 60000 });
const random = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const sameDigest = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === 43 && b.length === 43 && timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
function opaque(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || base64url.encode(base64url.decode(value)) !== value) fail('invalid_oauth_binding');
  return value;
}
function redirect(value) {
  string(value, 1000);
  let url;
  try { url = new URL(value); } catch { fail('invalid_oauth_redirect'); }
  // The caller must additionally match its server-configured callback exactly.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || !url.hostname.includes('.')) fail('invalid_oauth_redirect');
  return url.href;
}
function token(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value)) fail('invalid_provider_credentials');
  return value;
}
function credentials(value, now) {
  object(value, ['access_token', 'refresh_token', 'expires_at', 'refresh_expires_at', 'scopes']);
  if (!Number.isSafeInteger(value.expires_at) || value.expires_at <= now || value.expires_at > now + 86400000 ||
      !Array.isArray(value.scopes) || value.scopes.length !== GOOGLE_CALENDAR_SCOPES.length ||
      new Set(value.scopes).size !== value.scopes.length || !GOOGLE_CALENDAR_SCOPES.every(scope => value.scopes.includes(scope))) fail('invalid_provider_credentials');
  if (value.refresh_expires_at !== undefined && (!Number.isSafeInteger(value.refresh_expires_at) || value.refresh_expires_at <= now || value.refresh_expires_at > now + 315360000000)) fail('invalid_provider_credentials');
  return { access_token: token(value.access_token), refresh_token: token(value.refresh_token), expires_at: value.expires_at, scopes: [...GOOGLE_CALENDAR_SCOPES], ...(value.refresh_expires_at === undefined ? {} : { refresh_expires_at: value.refresh_expires_at }) };
}

/** Shares the student's SQL transaction boundary, not its public record space. */
export class GoogleConnectionState {
  #store;
  #key;
  #clock;
  constructor(store, { key, clock = () => Date.now() }) { this.#store = store; this.#key = key; this.#clock = clock; }
  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0) fail('invalid_clock', 503);
    return now;
  }
  #transaction(tenantId, callback) {
    if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(tenantId)) fail('invalid_owner', 403);
    return this.#store.storage.transactionSync(() => {
      const meta = this.#store.bind(tenantId);
      if (meta.deleted) fail('account_deleted', 410);
      return callback(meta);
    });
  }
  #get(connectionId) {
    const row = this.#store.row('SELECT body FROM google_connections WHERE id = ?', connectionId);
    return row ? JSON.parse(row.body) : null;
  }
  #save(meta, value) {
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).byteLength > 40000) fail('connection_state_too_large', 413);
    this.#store.sql.exec('INSERT INTO google_connections (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body', value.id, body);
    this.#store.sql.exec('UPDATE workspace_meta SET account_revision = ? WHERE singleton = 1', meta.account_revision + 1);
  }
  #requireRegistration(connectionId) {
    if (!this.#store.getRecord('profile', 'profile')) fail('profile_required', 409);
    if (this.#store.getRecord('connections', connectionId)?.provider !== 'google_calendar') fail('google_connection_not_found', 404);
  }
  #binding(tenantId, row, purpose) { return { tenantId, connectionId: row.id, generation: row.generation, purpose }; }
  #status(row) {
    const expired = row && ((row.status === 'authorizing' && row.expires_at <= this.#now()) || (row.status === 'exchanging' && row.lease_expires_at <= this.#now()));
    return { connection_id: row?.id, revision: row?.revision ?? 0, generation: row?.generation ?? 0,
      status: expired ? 'authorization_expired' : row?.status === 'authorized_not_synced' && row.refresh_expires_at && row.refresh_expires_at <= this.#now() ? 'reauthorization_required' : row?.refresh_lease && row.refresh_lease.expires_at > this.#now() ? 'refreshing' : row?.status ?? 'needs_authorization',
      authorized: row?.status === 'authorized_not_synced' && !(row.refresh_expires_at && row.refresh_expires_at <= this.#now()), live_sync: false, last_successful_sync: null,
      ...(row?.refresh_error ? { refresh_error: row.refresh_error, retry_at: row.refresh_retry_at } : {}) };
  }
  status(tenantId, connectionId) {
    id(connectionId);
    return this.#transaction(tenantId, () => { this.#requireRegistration(connectionId); return { ...this.#status(this.#get(connectionId)), connection_id: connectionId }; });
  }
  #replay(row, requestHash) {
    if (!sameDigest(row.request_hash, requestHash)) fail('authorization_attempt_conflict', 409);
    if (row.status !== 'authorizing' || row.expires_at <= this.#now()) fail('authorization_attempt_consumed', 409);
  }
  async #intent(tenantId, row) {
    const pending = await openCredential(this.#key, this.#binding(tenantId, row, 'google_oauth_pending'), row.pending);
    const challenge = await digest(pending.verifier);
    return this.#transaction(tenantId, () => {
      const current = this.#get(row.id);
      if (!current || current.generation !== row.generation || current.revision !== row.revision) fail('authorization_attempt_changed', 409);
      this.#replay(current, row.request_hash);
      return { ...this.#status(current), state: pending.state, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: pending.redirect_uri, expires_at: current.expires_at };
    });
  }
  async beginAuthorization(tenantId, input) {
    object(input, ['connectionId', 'expectedRevision', 'attemptId', 'browserBinding', 'redirectUri']);
    const connectionId = id(input.connectionId), expectedRevision = revision(input.expectedRevision);
    const attemptId = operationId(input.attemptId), redirectUri = redirect(input.redirectUri);
    const browserHash = await digest(opaque(input.browserBinding));
    const requestHash = await digest(JSON.stringify([connectionId, expectedRevision, attemptId, browserHash, redirectUri]));
    const previous = this.#transaction(tenantId, () => {
      this.#requireRegistration(connectionId);
      const old = this.#get(connectionId);
      if (old?.attempt_id === attemptId) { this.#replay(old, requestHash); return old; }
      if ((old?.revision ?? 0) !== expectedRevision) fail('revision_conflict', 409);
      // Reauthorization is explicit: disconnect first rather than silently
      // destroying an existing usable credential set on another tab's click.
      if (old?.status === 'authorized_not_synced' && !(old.refresh_expires_at && old.refresh_expires_at <= this.#now())) fail('disconnect_required', 409);
      return old;
    });
    if (previous?.attempt_id === attemptId) return this.#intent(tenantId, previous);
    const state = random(), verifier = random();
    const row = { id: connectionId, generation: (previous?.generation ?? 0) + 1, revision: expectedRevision + 1,
      status: 'authorizing', attempt_id: attemptId, request_hash: requestHash, browser_hash: browserHash,
      state_hash: await digest(state), expires_at: this.#now() + GOOGLE_STATE_LIMITS.pendingMs };
    row.pending = await sealCredential(this.#key, this.#binding(tenantId, row, 'google_oauth_pending'), { state, verifier, redirect_uri: redirectUri });
    const saved = this.#transaction(tenantId, meta => {
      this.#requireRegistration(connectionId);
      const current = this.#get(connectionId);
      if (current?.attempt_id === attemptId) { this.#replay(current, requestHash); return current; }
      if ((current?.revision ?? 0) !== expectedRevision) fail('revision_conflict', 409);
      if (!current && this.#store.row('SELECT COUNT(*) AS n FROM google_connections').n >= GOOGLE_STATE_LIMITS.connections) fail('connection_limit_reached', 409);
      this.#save(meta, row);
      return row;
    });
    return this.#intent(tenantId, saved);
  }
  async consumeAuthorization(tenantId, input) {
    object(input, ['connectionId', 'state', 'browserBinding']);
    const connectionId = id(input.connectionId), stateHash = await digest(opaque(input.state)), browserHash = await digest(opaque(input.browserBinding));
    const lease = random(), leaseHash = await digest(lease);
    const previous = this.#transaction(tenantId, meta => {
      const row = this.#get(connectionId);
      if (!row || row.status !== 'authorizing' || !sameDigest(row.state_hash, stateHash) || !sameDigest(row.browser_hash, browserHash)) fail('authorization_callback_rejected', 403);
      if (row.expires_at <= this.#now()) fail('authorization_expired', 409);
      const { pending, state_hash, browser_hash, expires_at, ...rest } = row;
      // Consume BEFORE decrypt/exchange. A crash here requires a new attempt;
      // never replay a potentially already-used provider authorization code.
      this.#save(meta, { ...rest, status: 'exchanging', revision: row.revision + 1, lease_hash: leaseHash, lease_expires_at: this.#now() + GOOGLE_STATE_LIMITS.exchangeMs });
      return row;
    });
    const pending = await openCredential(this.#key, this.#binding(tenantId, previous, 'google_oauth_pending'), previous.pending);
    return this.#transaction(tenantId, () => {
      const current = this.#get(connectionId);
      this.#requireLease(current, previous.generation, leaseHash);
      return { connection_id: connectionId, generation: previous.generation, lease, verifier: pending.verifier, redirect_uri: pending.redirect_uri };
    });
  }
  #requireLease(row, generation, leaseHash) {
    if (!row || row.generation !== generation || row.status !== 'exchanging' || !sameDigest(row.lease_hash, leaseHash) || row.lease_expires_at <= this.#now()) fail('authorization_exchange_stale', 409);
  }
  async finishAuthorization(tenantId, input) {
    object(input, ['connectionId', 'generation', 'lease', 'credentials']);
    const connectionId = id(input.connectionId), generation = revision(input.generation), leaseHash = await digest(opaque(input.lease));
    const normalized = credentials(input.credentials, this.#now());
    const previous = this.#transaction(tenantId, () => {
      const row = this.#get(connectionId); this.#requireLease(row, generation, leaseHash); return row;
    });
    const sealed = await sealCredential(this.#key, this.#binding(tenantId, previous, 'google_tokens'), normalized);
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId); this.#requireLease(current, generation, leaseHash);
      // Expiry may have passed while awaiting encryption.
      if (normalized.expires_at <= this.#now() || normalized.refresh_expires_at !== undefined && normalized.refresh_expires_at <= this.#now()) fail('invalid_provider_credentials');
      const { lease_hash, lease_expires_at, ...rest } = current;
      const next = { ...rest, status: 'authorized_not_synced', revision: current.revision + 1, tokens: sealed, token_revision: 1, refresh_expires_at: normalized.refresh_expires_at ?? null };
      this.#save(meta, next);
      return this.#status(next);
    });
  }
  async failAuthorization(tenantId, input) {
    object(input, ['connectionId', 'generation', 'lease', 'denied']);
    const connectionId = id(input.connectionId), generation = revision(input.generation), leaseHash = await digest(opaque(input.lease));
    if (typeof input.denied !== 'boolean') fail('invalid_value');
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId); this.#requireLease(current, generation, leaseHash);
      const next = { id: connectionId, revision: current.revision + 1, generation, status: input.denied ? 'authorization_denied' : 'authorization_failed', attempt_id: current.attempt_id, request_hash: current.request_hash };
      this.#save(meta, next);
      return this.#status(next);
    });
  }
  #requireActive(row, generation, tokenRevision) {
    if (!row || row.status !== 'authorized_not_synced' || !row.tokens || row.generation !== generation || (row.token_revision ?? 1) !== tokenRevision) fail('google_access_changed', 409);
  }
  #refreshLease(row, generation, tokenRevision, leaseHash) {
    this.#requireActive(row, generation, tokenRevision);
    if (!row.refresh_lease || !sameDigest(row.refresh_lease.hash, leaseHash) || row.refresh_lease.expires_at <= this.#now()) fail('google_refresh_stale', 409);
  }
  #invalidate(meta, current) {
    const next = { id: current.id, revision: current.revision + 1, generation: current.generation + 1, status: 'reauthorization_required' };
    this.#save(meta, next);
    this.#store.sql.exec('DELETE FROM google_choices WHERE connection_id = ?', current.id);
    clearGoogleCollection(this.#store, current.id);
    return this.#status(next);
  }
  // Internal only. A ready access token or refresh claim must never cross RPC.
  async acquireAccess(tenantId, input) {
    object(input, ['connectionId', 'rejectedTokenRevision']);
    const connectionId = id(input.connectionId);
    if (input.rejectedTokenRevision !== undefined) revision(input.rejectedTokenRevision);
    const previous = this.#transaction(tenantId, () => {
      const row = this.#get(connectionId);
      if (!row || row.status !== 'authorized_not_synced' || !row.tokens) fail('google_reauthorization_required', 409);
      return row;
    });
    const tokens = await openCredential(this.#key, this.#binding(tenantId, previous, 'google_tokens'), previous.tokens);
    const lease = random(), leaseHash = await digest(lease);
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId), tokenRevision = previous.token_revision ?? 1;
      this.#requireActive(current, previous.generation, tokenRevision);
      const now = this.#now();
      if (tokens.refresh_expires_at !== undefined && tokens.refresh_expires_at <= now) { this.#invalidate(meta, current); return { kind: 'reauthorize' }; }
      if (current.refresh_lease && current.refresh_lease.expires_at > now) return { kind: 'wait', retry_at: current.refresh_lease.expires_at };
      if (current.refresh_retry_at > now) return { kind: 'wait', retry_at: current.refresh_retry_at };
      // A 401 can force refresh only for the exact credential version rejected.
      // A concurrent newer token is reused instead of needlessly refreshing it.
      if (tokens.expires_at > now + GOOGLE_STATE_LIMITS.refreshSkewMs && input.rejectedTokenRevision !== tokenRevision) return { kind: 'ready', accessToken: tokens.access_token, generation: current.generation, tokenRevision };
      const next = { ...current, revision: current.revision + 1, refresh_lease: { hash: leaseHash, expires_at: now + GOOGLE_STATE_LIMITS.refreshMs } };
      this.#save(meta, next);
      return { kind: 'refresh', connectionId, generation: current.generation, tokenRevision, lease, credentials: tokens };
    });
  }
  async finishRefresh(tenantId, input) {
    object(input, ['connectionId', 'generation', 'tokenRevision', 'lease', 'credentials']);
    const connectionId = id(input.connectionId), generation = revision(input.generation), tokenRevision = revision(input.tokenRevision), leaseHash = await digest(opaque(input.lease));
    const normalized = credentials(input.credentials, this.#now());
    const previous = this.#transaction(tenantId, () => { const row = this.#get(connectionId); this.#refreshLease(row, generation, tokenRevision, leaseHash); return row; });
    const sealed = await sealCredential(this.#key, this.#binding(tenantId, previous, 'google_tokens'), normalized);
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId); this.#refreshLease(current, generation, tokenRevision, leaseHash);
      if (normalized.expires_at <= this.#now() || normalized.refresh_expires_at !== undefined && normalized.refresh_expires_at <= this.#now()) fail('invalid_provider_credentials');
      const { refresh_lease, refresh_error, refresh_retry_at, refresh_failures, ...rest } = current;
      const next = { ...rest, revision: current.revision + 1, tokens: sealed, token_revision: tokenRevision + 1, refresh_expires_at: normalized.refresh_expires_at ?? null };
      this.#save(meta, next);
      return { kind: 'ready', accessToken: normalized.access_token, generation, tokenRevision: next.token_revision };
    });
  }
  async failRefresh(tenantId, input) {
    object(input, ['connectionId', 'generation', 'tokenRevision', 'lease', 'error', 'retryAfterSeconds']);
    const connectionId = id(input.connectionId), generation = revision(input.generation), tokenRevision = revision(input.tokenRevision), leaseHash = await digest(opaque(input.lease));
    if (!['google_reauthorization_required', 'google_refresh_unavailable', 'google_token_response_invalid', 'google_scopes_incomplete', 'google_client_rejected', 'google_exchange_redirect_rejected'].includes(input.error)) fail('invalid_refresh_error');
    const retryAfter = input.retryAfterSeconds ?? 0;
    if (!Number.isSafeInteger(retryAfter) || retryAfter < 0 || retryAfter > Math.floor((8640000000000000 - this.#now()) / 1000)) fail('invalid_retry_delay');
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId); this.#refreshLease(current, generation, tokenRevision, leaseHash);
      if (['google_reauthorization_required', 'google_scopes_incomplete'].includes(input.error)) return this.#invalidate(meta, current);
      const { refresh_lease, ...rest } = current;
      const failures = Math.min((current.refresh_failures ?? 0) + 1, 16);
      const backoff = Math.min(3600000, 30000 * 2 ** (failures - 1));
      const jitter = crypto.getRandomValues(new Uint32Array(1))[0] % (Math.floor(backoff / 4) + 1);
      const delay = Math.max(backoff + jitter, retryAfter * 1000, input.error === 'google_client_rejected' ? 3600000 : 0);
      const next = { ...rest, revision: current.revision + 1, refresh_error: input.error, refresh_failures: failures, refresh_retry_at: this.#now() + delay };
      this.#save(meta, next);
      return this.#status(next);
    });
  }
  invalidateAccess(tenantId, { connectionId, generation, tokenRevision }) {
    id(connectionId); revision(generation); revision(tokenRevision);
    return this.#transaction(tenantId, meta => {
      const current = this.#get(connectionId); this.#requireActive(current, generation, tokenRevision);
      return this.#invalidate(meta, current);
    });
  }
  assertActiveGeneration(tenantId, connectionId, generation) {
    id(connectionId); revision(generation);
    return this.#transaction(tenantId, () => {
      const row = this.#get(connectionId);
      if (!row || row.status !== 'authorized_not_synced' || !row.tokens || row.generation !== generation || row.refresh_expires_at && row.refresh_expires_at <= this.#now()) fail('google_access_changed', 409);
    });
  }
  disconnect(tenantId, input) {
    object(input, ['connectionId', 'expectedRevision']);
    const connectionId = id(input.connectionId), expectedRevision = revision(input.expectedRevision);
    return this.#transaction(tenantId, meta => {
      this.#requireRegistration(connectionId);
      const current = this.#get(connectionId);
      // Exact retry after a lost local-erasure response is harmless.
      if (current?.status === 'disconnected' && current.revision === expectedRevision + 1) return { ...this.#status(current), provider_revocation: 'not_attempted' };
      if ((current?.revision ?? 0) !== expectedRevision) fail('revision_conflict', 409);
      // Persist a fence even before the first begin has committed: it may be
      // awaiting crypto right now and must not resurrect after this response.
      if (!current && this.#store.row('SELECT COUNT(*) AS n FROM google_connections').n >= GOOGLE_STATE_LIMITS.connections) fail('connection_limit_reached', 409);
      const next = { id: connectionId, revision: expectedRevision + 1, generation: (current?.generation ?? 0) + 1, status: 'disconnected' };
      this.#save(meta, next);
      this.#store.sql.exec('DELETE FROM google_choices WHERE connection_id = ?', connectionId);
      clearGoogleCollection(this.#store, connectionId);
      return { ...this.#status(next), provider_revocation: 'not_attempted' };
    });
  }
}
