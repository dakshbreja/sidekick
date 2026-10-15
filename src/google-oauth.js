// Copyright 2026 Daksh Breja. All rights reserved.
import { base64url } from 'jose';
import { GOOGLE_CALENDAR_SCOPES } from './google-calendar.js';
import { HttpError } from './http.js';

export const GOOGLE_CALLBACK_PATH = '/api/google/callback';
export const GOOGLE_OAUTH_LIMITS = Object.freeze({ responseBytes: 32768, timeoutMs: 10000 });
export function googleConfiguration(env) {
  if (env?.GOOGLE_OAUTH_ENABLED !== 'true') throw new HttpError('google_oauth_disabled', 503);
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri, GOOGLE_CREDENTIAL_KEY: key } = env;
  let url;
  try { url = new URL(redirectUri); } catch { throw new HttpError('google_oauth_not_configured', 503); }
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/.test(clientId) ||
      typeof clientSecret !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(clientSecret) ||
      typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key) || base64url.encode(base64url.decode(key)) !== key || key === env.TENANT_ID_KEY ||
      url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== GOOGLE_CALLBACK_PATH || !url.hostname.includes('.') || url.href !== redirectUri) throw new HttpError('google_oauth_not_configured', 503);
  return { clientId, clientSecret, redirectUri, key, origin: url.origin };
}
export function googleConfigured(env) { try { googleConfiguration(env); return true; } catch { return false; } }
const safeText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
export function authorizationUrl(config, connectionId, intent) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
    state: connectionId + '.' + intent.state, code_challenge: intent.code_challenge, code_challenge_method: 'S256' });
  return url.href;
}
export class GoogleOAuthError extends Error {
  constructor(code, retryAfterSeconds = null) { super(code); this.code = code; this.status = 502; this.retryAfterSeconds = retryAfterSeconds; }
}
const invalid = () => new GoogleOAuthError('google_token_response_invalid');
/** One exchange only. An uncertain response must never automatically retry a code. */
export function createGoogleOAuthClient({ fetcher = fetch, clock = () => Date.now(), timeoutMs = GOOGLE_OAUTH_LIMITS.timeoutMs } = {}) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > GOOGLE_OAUTH_LIMITS.timeoutMs) throw invalid();
  async function requestTokens(config, fields, previous) {
    const uncertain = previous ? 'google_refresh_unavailable' : 'google_exchange_uncertain';
    const startedAt = clock(), controller = new AbortController(); let timer, reader, response;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GoogleOAuthError(uncertain)); }, timeoutMs); });
    try {
      response = await Promise.race([fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }).toString() }), timeout]);
      if (response.status >= 300 && response.status < 400) throw new GoogleOAuthError('google_exchange_redirect_rejected');
      let retryAfterSeconds = null;
      const retry = response.headers.get('Retry-After');
      if (retry && /^\d{1,10}$/.test(retry)) retryAfterSeconds = Number(retry);
      else if (retry && retry.length < 100 && Number.isFinite(Date.parse(retry))) retryAfterSeconds = Math.max(0, Math.ceil((Date.parse(retry) - clock()) / 1000));
      if (previous && (response.status === 429 || response.status >= 500)) throw new GoogleOAuthError('google_refresh_unavailable', retryAfterSeconds);
      if (!response.body) throw invalid();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > GOOGLE_OAUTH_LIMITS.responseBytes)) throw invalid();
      reader = response.body.getReader(); const chunks = []; let size = 0;
      for (;;) { const { done, value } = await Promise.race([reader.read(), timeout]); if (done) break; size += value.byteLength; if (size > GOOGLE_OAUTH_LIMITS.responseBytes) throw invalid(); chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw invalid();
      if (response.status !== 200) {
        if (body.error === 'invalid_grant') throw new GoogleOAuthError(previous ? 'google_reauthorization_required' : 'google_authorization_rejected');
        if (body.error === 'invalid_client') throw new GoogleOAuthError('google_client_rejected');
        throw new GoogleOAuthError(uncertain, retryAfterSeconds);
      }
      const refreshToken = body.refresh_token === undefined ? previous?.refresh_token : body.refresh_token;
      const grantedScope = body.scope === undefined && previous ? previous.scopes.join(' ') : body.scope;
      if (body.token_type !== 'Bearer' || !safeText(body.access_token, 4096) || !safeText(refreshToken, 4096) ||
          !Number.isSafeInteger(body.expires_in) || body.expires_in < 1 || body.expires_in > 86400 || typeof grantedScope !== 'string' || grantedScope.length > 2000) throw invalid();
      const scopes = grantedScope.split(' ');
      if (scopes.length !== GOOGLE_CALENDAR_SCOPES.length || new Set(scopes).size !== scopes.length || !GOOGLE_CALENDAR_SCOPES.every(scope => scopes.includes(scope))) throw new GoogleOAuthError('google_scopes_incomplete');
      const result = { access_token: body.access_token, refresh_token: refreshToken, scopes, expires_at: startedAt + body.expires_in * 1000 };
      if (result.expires_at <= clock()) throw invalid();
      if (previous?.refresh_expires_at !== undefined) result.refresh_expires_at = previous.refresh_expires_at;
      if (body.refresh_token_expires_in !== undefined) {
        if (!Number.isSafeInteger(body.refresh_token_expires_in) || body.refresh_token_expires_in < 1 || body.refresh_token_expires_in > 315360000) throw invalid();
        result.refresh_expires_at = startedAt + body.refresh_token_expires_in * 1000;
      }
      if (result.refresh_expires_at !== undefined && result.refresh_expires_at <= clock()) throw new GoogleOAuthError('google_reauthorization_required');
      return result;
    } catch (error) { if (error instanceof GoogleOAuthError) throw error; throw new GoogleOAuthError(uncertain); }
    finally { clearTimeout(timer); controller.abort(); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } else if (response?.body) void response.body.cancel().catch(() => {}); }
  }
  return {
    async exchange(config, { code, verifier, redirectUri }) {
      if (!safeText(code, 4096) || !safeText(verifier, 128) || verifier.length < 43 || redirectUri !== config.redirectUri) throw new GoogleOAuthError('google_exchange_input_invalid');
      return requestTokens(config, { code, code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: 'authorization_code' });
    },
    async refresh(config, previous) {
      if (!previous || !safeText(previous.refresh_token, 4096) || !Array.isArray(previous.scopes) || previous.scopes.length !== GOOGLE_CALENDAR_SCOPES.length || !GOOGLE_CALENDAR_SCOPES.every(scope => previous.scopes.includes(scope))) throw invalid();
      if (previous.refresh_expires_at !== undefined && (!Number.isSafeInteger(previous.refresh_expires_at) || previous.refresh_expires_at <= clock())) throw new GoogleOAuthError('google_reauthorization_required');
      return requestTokens(config, { refresh_token: previous.refresh_token, grant_type: 'refresh_token' }, previous);
    },
  };
}
