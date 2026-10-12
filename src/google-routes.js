// Copyright 2026 Daksh Breja. All rights reserved.
import { base64url } from 'jose';
import { HttpError, json, readJSON, queryData, writePacket } from './http.js';
import { object, id, operationId, revision } from './validation.js';
import { GOOGLE_CALLBACK_PATH, googleConfiguration, authorizationUrl } from './google-oauth.js';
const COOKIE = '__Host-sb-google-browser';
function browserBinding(request) {
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(COOKIE + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) && base64url.encode(base64url.decode(value)) === value ? value : null;
}
export function googleCallbackRedirect(success = false) {
  // No untrusted query, provider text, code, state or redirect destination survives.
  return new Response(null, { status: 303, headers: { Location: '/?calendar=' + (success ? 'authorized' : 'failed') + '#sources',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
}
export async function handleGoogleRoute({ request, url, env, identity, student }) {
  const config = googleConfiguration(env);
  if (url.origin !== config.origin) throw new HttpError('google_origin_mismatch', 403);
  const call = (op, data) => student.google({ tenantId: identity.tenantId, op, data });
  const respond = result => json(result, result.ok ? 200 : result.status || 400);
  if (url.pathname === GOOGLE_CALLBACK_PATH && request.method === 'GET') {
    if (url.search.length > 8192) throw new HttpError('invalid_callback');
    const query = queryData(url, ['state', 'code', 'error', 'scope', 'authuser', 'prompt', 'hd', 'iss']);
    if (query.iss !== undefined && query.iss !== 'https://accounts.google.com') throw new HttpError('invalid_callback');
    const parts = query.state?.match(/^([A-Za-z0-9][A-Za-z0-9_-]{0,99})\.([A-Za-z0-9_-]{43})$/), browser = browserBinding(request);
    if (!parts || !browser || (query.code === undefined) === (query.error === undefined)) throw new HttpError('invalid_callback');
    if (query.error !== undefined && !/^[a-z_]{1,100}$/.test(query.error)) throw new HttpError('invalid_callback');
    const result = await call('callback', { connectionId: parts[1], state: parts[2], browserBinding: browser, code: query.code, denied: query.error !== undefined });
    return googleCallbackRedirect(result.ok && result.connection?.authorized === true);
  }
  if (url.pathname === '/api/google/status' && request.method === 'GET') {
    const query = queryData(url, ['connection_id']);
    return respond(await call('status', { connectionId: id(query.connection_id) }));
  }
  if (url.pathname === '/api/google/calendars' && request.method === 'GET') {
    const query = queryData(url, ['connection_id', 'page_token']);
    return respond(await call('calendars', { connectionId: id(query.connection_id), ...(query.page_token === undefined ? {} : { pageToken: query.page_token }) }));
  }
  if(url.pathname==='/api/google/upcoming' && request.method==='GET'){
    const query=queryData(url,['connection_id','calendar_id']);return respond(await call('upcoming',{connectionId:id(query.connection_id),calendarId:query.calendar_id}));
  }
  if(url.pathname==='/api/google/events' && request.method==='GET'){
    const query=queryData(url,['connection_id','calendar_id','limit','cursor','snapshot_id']);
    if(query.limit!==undefined && !/^[1-9][0-9]{0,2}$/.test(query.limit))throw new HttpError('invalid_collection_read');
    if(query.snapshot_id!==undefined && !/^[a-f0-9-]{36}$/.test(query.snapshot_id))throw new HttpError('invalid_collection_read');
    return respond(await call('events',{connectionId:id(query.connection_id),calendarId:query.calendar_id,...(query.limit===undefined?{}:{limit:Number(query.limit)}),...(query.cursor===undefined?{}:{cursor:query.cursor}),...(query.snapshot_id===undefined?{}:{snapshotId:query.snapshot_id})}));
  }
  if (url.pathname === '/api/google/selection' && request.method === 'GET') {
    const query = queryData(url, ['connection_id']);
    return respond(await student.dispatch({ tenantId: identity.tenantId, op: 'google_selection.get', data: { id: id(query.connection_id) } }));
  }
  if (request.method !== 'POST') throw new HttpError('method_not_allowed', 405);
  // New cookie-bearing operations require both same-origin evidence and the
  // workspace observed by the initiating UI, even if a request has no Origin.
  if (request.headers.get('Origin') !== config.origin || request.headers.get('X-Workspace-Id') !== identity.tenantId) throw new HttpError('google_intent_required', 403);
  const data = await readJSON(request, url.pathname === '/api/google/selection' ? 30000 : 4096);
  if (url.pathname === '/api/google/selection') {
    const packet = writePacket(data);
    return respond(await student.dispatch({ tenantId: identity.tenantId, op: 'google_selection.put', ...packet }));
  }
  if (url.pathname === '/api/google/prepare') {
    object(data, []);
    const value = browserBinding(request) || base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', COOKIE + '=' + value + '; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
    return response;
  }
  if (url.pathname === '/api/google/begin') {
    object(data, ['connection_id', 'attempt_id', 'expected_revision']);
    const browser = browserBinding(request); if (!browser) throw new HttpError('google_browser_binding_required', 409);
    const connectionId = id(data.connection_id);
    const result = await call('begin', { connectionId, attemptId: operationId(data.attempt_id), expectedRevision: revision(data.expected_revision), browserBinding: browser });
    if (!result.ok) return respond(result);
    return json({ ok: true, authorization_url: authorizationUrl(config, connectionId, result.intent), connection: { connection_id: connectionId, revision: result.intent.revision, status: result.intent.status, authorized: false, live_sync: false } });
  }
  if (url.pathname === '/api/google/disconnect') {
    object(data, ['connection_id', 'expected_revision']);
    return respond(await call('disconnect', { connectionId: id(data.connection_id), expectedRevision: revision(data.expected_revision) }));
  }
  throw new HttpError('not_found', 404);
}
