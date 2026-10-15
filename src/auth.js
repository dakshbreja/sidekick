// Copyright 2026 Daksh Breja. All rights reserved.
import { base64url, createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';

const MAX_TOKEN_BYTES = 16_384;
const MAX_JWKS_BYTES = 65_536;
const JWKS_TIMEOUT_MS = 5_000;
const CLOCK_TOLERANCE_SECONDS = 5;
const encoder = new TextEncoder();

export class AuthenticationError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'AuthenticationError';
    this.code = code;
    this.status = status;
  }
}

const unavailable = () => new AuthenticationError('identity_provider_unavailable', 503);
const invalidIdentity = () => new AuthenticationError('invalid_identity', 401);

function validateConfiguration(config) {
  if (!config || typeof config.issuer !== 'string' ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(config.issuer) ||
      typeof config.audience !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(config.audience) ||
      typeof config.tenantIdKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(config.tenantIdKey)) {
    throw new AuthenticationError('auth_not_configured', 503);
  }
  const bytes = base64url.decode(config.tenantIdKey);
  // A canonical 256-bit secret is required. Rotation changes all tenant addresses:
  // never rotate this secret without an explicit, tested account migration.
  if (bytes.byteLength !== 32 || base64url.encode(bytes) !== config.tenantIdKey) {
    throw new AuthenticationError('auth_not_configured', 503);
  }
  return bytes;
}

// Public signing keys are the only cross-request cache. No tokens, identity
// claims, environment secret or student data is stored here.
let publicKeyCache;

async function boundedJwksFetch(url, init) {
  const controller = new AbortController();
  let reader;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(unavailable());
    }, JWKS_TIMEOUT_MS);
  });
  const abort = () => controller.abort();
  init?.signal?.addEventListener('abort', abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  try {
    const response = await Promise.race([
      // Workers supports manual/follow; manual plus the exact 200 check below
      // rejects redirects without ever contacting their Location target.
      fetch(url, { ...init, redirect: 'manual', signal: controller.signal }),
      timeout,
    ]);
    if (response.status !== 200 || !response.body) throw unavailable();
    const announcedLength = response.headers.get('content-length');
    if (announcedLength !== null && (!/^\d+$/.test(announcedLength) || Number(announcedLength) > MAX_JWKS_BYTES)) {
      throw unavailable();
    }
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JWKS_BYTES) throw unavailable();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const jwks = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 16) throw unavailable();
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', abort);
    controller.abort();
    // Abort the actual network request before releasing a failed stream lock.
    reader?.releaseLock();
  }
}

function publicKeysFor(issuer) {
  if (publicKeyCache?.issuer !== issuer) {
    publicKeyCache = Object.freeze({
      issuer,
      resolver: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: JWKS_TIMEOUT_MS,
        cacheMaxAge: 600_000,
        cooldownDuration: 30_000,
        [customFetch]: boundedJwksFetch,
      }),
    });
  }
  return publicKeyCache.resolver;
}

/** Verify a user identity against trusted deployment configuration.
 * keyResolver is a direct code-level dependency for tests, never an HTTP option.
 */
export async function verifyIdentity(token, config, keyResolver) {
  const tenantKeyBytes = validateConfiguration(config);
  if (typeof token !== 'string' || token.length === 0) {
    throw new AuthenticationError('authentication_required', 401);
  }
  if (token.length > MAX_TOKEN_BYTES || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw invalidIdentity();
  }
  let phase = 'header';
  try {
    const header = decodeProtectedHeader(token);
    // The JOSE typ header is optional (RFC 7519 §5.1). Live Worker Access
    // assertions can omit it. Payload type=app, signature and pinned claims
    // remain mandatory; an explicitly different header type is rejected.
    if (header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT') || typeof header.kid !== 'string' ||
        header.kid.length < 1 || header.kid.length > 256 ||
        /[\s\u0000-\u001f\u007f]/.test(header.kid) ||
        ['jku', 'jwk', 'x5u'].some((key) => Object.hasOwn(header, key))) {
      throw invalidIdentity();
    }
    phase = 'signature_and_registered_claims';
    const { payload } = await jwtVerify(token, keyResolver ?? publicKeysFor(config.issuer), {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.audience,
      ...(header.typ === undefined ? {} : { typ: 'JWT' }),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'type'],
    });
    phase = 'human_identity';
    // Access application service tokens have an empty sub/common_name. Require
    // a signed end-user subject and email, while never using email as ownership.
    if (payload.type !== 'app' || typeof payload.sub !== 'string' ||
        payload.sub.length > 256 || payload.sub.trim() !== payload.sub ||
        !payload.sub || /[\s\u0000-\u001f\u007f]/.test(payload.sub) ||
        typeof payload.email !== 'string' || payload.email.length > 320 ||
        !/^[^\s@]+@[^\s@]+$/.test(payload.email) ||
        Object.hasOwn(payload, 'common_name') || Object.hasOwn(payload, 'service_token_id') ||
        (Object.hasOwn(payload, 'service_token_status') && payload.service_token_status !== false) ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= payload.iat ||
        payload.iat > Date.now() / 1000 + CLOCK_TOLERANCE_SECONDS) {
      throw invalidIdentity();
    }
    const hmacKey = await crypto.subtle.importKey('raw', tenantKeyBytes,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', hmacKey,
      encoder.encode(JSON.stringify(['school-bridge-student-v1', config.issuer, payload.sub])));
    return Object.freeze({ tenantId: base64url.encode(new Uint8Array(digest)), subject: payload.sub, issuer: config.issuer, email: payload.email });
  } catch (error) {
    if (config.diagnostics === true) {
      const reasons = ['ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_EXPIRED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JWK_INVALID'];
      console.warn(JSON.stringify({event:'authentication_rejected', phase,
        reason:reasons.includes(error?.code) ? error.code : 'validation_failed',
        claim:['iss','aud','sub','exp','iat','type'].includes(error?.claim) ? error.claim : undefined}));
    }
    if (error instanceof AuthenticationError) throw error;
    if (['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JWK_INVALID'].includes(error?.code)) throw unavailable();
    throw invalidIdentity();
  }
}

export async function authenticate(request, env) {
  // Email, X-User-ID, X-Tenant-ID, cookies, service credentials and Authorization
  // headers never select a student. Only the signed Access assertion is used.
  return verifyIdentity(request.headers.get('Cf-Access-Jwt-Assertion'), {
    issuer: env?.ACCESS_ISSUER,
    audience: env?.ACCESS_AUDIENCE,
    tenantIdKey: env?.TENANT_ID_KEY,
    diagnostics: env?.AUTH_DIAGNOSTICS === 'true',
  });
}
