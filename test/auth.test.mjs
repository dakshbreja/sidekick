import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { base64url, generateKeyPair, SignJWT } from 'jose';
import { authenticate, verifyIdentity } from '../src/auth.js';
import { createAuthFixture } from './auth-fixtures.mjs';

let fixture;
before(async () => { fixture = await createAuthFixture(); });
const verify = (token, config = fixture.config) => verifyIdentity(token, config, fixture.keyResolver);
const rejectsIdentity = (operation) => assert.rejects(operation, { code: 'invalid_identity', status: 401, message: 'invalid_identity' });

test('signed users receive distinct frozen server-derived tenant identities', async () => {
  const a = await verify(fixture.tokens.a);
  const b = await verify(fixture.tokens.b);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(Object.keys(a).sort(), ['email', 'issuer', 'subject', 'tenantId']);
  assert.equal(a.subject, 'synthetic-student-a');
  assert.equal(a.email, 'student-a@example.invalid');
  assert.match(a.tenantId, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.tenantId, b.tenantId);
  assert.deepEqual(await verify(fixture.tokens.a), a);
});

test('tenant identity follows signed subject, not changed email, tenant claims or user claims', async () => {
  const a = await verify(fixture.tokens.a);
  const changed = await verify(await fixture.signToken({
    email: 'renamed@example.invalid', tenantId: 'other-user', user_id: 'other-user', owner: 'other-user',
  }));
  assert.equal(changed.tenantId, a.tenantId);
  assert.equal(changed.email, 'renamed@example.invalid');
  const newKey = { ...fixture.config, tenantIdKey: base64url.encode(crypto.getRandomValues(new Uint8Array(32))) };
  assert.notEqual((await verify(fixture.tokens.a, newKey)).tenantId, a.tenantId);
});

test('unconfigured deployment fails closed before accepting any identity', async () => {
  await assert.rejects(authenticate(new Request('https://community.example.invalid/api/onboarding'), {}),
    { code: 'auth_not_configured', status: 503 });
});

test('the same signed subject under another trusted issuer has a distinct workspace', async () => {
  const a = await verify(fixture.tokens.a);
  const issuer = 'https://separate-synthetic-team.cloudflareaccess.com';
  const token = await fixture.signToken({iss:issuer});
  const other = await verify(token,{...fixture.config,issuer});
  assert.equal(other.subject,a.subject);
  assert.notEqual(other.tenantId,a.tenantId);
});

test('application audience change validates new tokens without silently moving the same subject', async () => {
  const a = await verify(fixture.tokens.a);
  const audience = 'synthetic-replacement-application';
  const config = {...fixture.config,audience};
  await rejectsIdentity(()=>verify(fixture.tokens.a,config));
  const token = await fixture.signToken({aud:[audience]});
  const replacement = await verify(token,config);
  assert.equal(replacement.tenantId,a.tenantId);
  await rejectsIdentity(()=>verify(token,fixture.config));
});

test('cached public keys never cache successful authentication for a later expired assertion', async () => {
  const remote = await createAuthFixture('https://cached-expiry-synthetic.cloudflareaccess.com');
  const originalFetch = globalThis.fetch;let keyReads=0;
  globalThis.fetch = async()=>{keyReads++;return new Response(JSON.stringify(remote.jwks));};
  const request = token=>new Request('https://community.example.invalid/api/onboarding',{headers:{'Cf-Access-Jwt-Assertion':token}});
  try {
    const first = await authenticate(request(remote.tokens.a),remote.env);
    const now = Math.floor(Date.now()/1000);
    const expired = await remote.signToken({iat:now-120,nbf:now-120,exp:now-60});
    await rejectsIdentity(()=>authenticate(request(expired),remote.env));
    const second = await authenticate(request(remote.tokens.b),remote.env);
    assert.notEqual(first.tenantId,second.tenantId);
    assert.equal(keyReads,1,'cached keys must not bypass per-request identity and lifetime checks');
  } finally {globalThis.fetch=originalFetch;}
});

test('missing assertion rejects forwarded identity and alternative credentials', async () => {
  const request = new Request('https://community.example.invalid/api/onboarding', { headers: {
    'Cf-Access-Authenticated-User-Email': 'owner@example.invalid', 'X-Tenant-ID': 'victim',
    'X-User-ID': 'victim', Authorization: `Bearer ${fixture.tokens.a}`,
    Cookie: `CF_Authorization=${fixture.tokens.a}`, 'CF-Access-Client-ID': 'service',
  } });
  await assert.rejects(authenticate(request, fixture.env), { code: 'authentication_required', status: 401 });
});

for (const [name, patch] of [
  ['insecure issuer', { issuer: 'http://synthetic-students.cloudflareaccess.com' }],
  ['issuer with attacker host', { issuer: 'https://synthetic-students.cloudflareaccess.com.attacker.invalid' }],
  ['issuer path', { issuer: 'https://synthetic-students.cloudflareaccess.com/keys' }],
  ['issuer credentials', { issuer: 'https://user@synthetic-students.cloudflareaccess.com' }],
  ['issuer port', { issuer: 'https://synthetic-students.cloudflareaccess.com:443' }],
  ['missing audience', { audience: '' }],
  ['audience array', { audience: ['synthetic-application-audience'] }],
  ['short tenant secret', { tenantIdKey: 'short' }],
  ['noncanonical tenant secret', { tenantIdKey: 'A'.repeat(42) + 'B' }],
]) test(`configuration rejects ${name}`, async () => {
  await assert.rejects(verify(fixture.tokens.a, { ...fixture.config, ...patch }), { code: 'auth_not_configured', status: 503 });
});

for (const [name, patch] of [
  ['expired token', { exp: 1 }],
  ['wrong issuer', { iss: 'https://attacker.cloudflareaccess.com' }],
  ['wrong audience', { aud: ['another-application'] }],
  ['future not-before', { nbf: 4_000_000_000 }],
  ['future issue time', { iat: 4_000_000_000, exp: 4_000_000_100 }],
  ['missing issue time', { iat: undefined }],
  ['missing expiry', { exp: undefined }],
  ['missing subject', { sub: undefined }],
  ['empty subject', { sub: '' }],
  ['object subject', { sub: { id: 'student' } }],
  ['whitespace subject', { sub: 'student a' }],
  ['oversized subject', { sub: 'a'.repeat(257) }],
  ['missing email', { email: undefined }],
  ['service token', { sub: '', common_name: 'synthetic-service.access', email: undefined }],
  ['service token with forged human-shaped subject', { common_name: 'synthetic-service.access' }],
  ['service token ID', { service_token_id: 'synthetic-service' }],
  ['service token flag', { service_token_status: true }],
  ['string service flag', { service_token_status: 'true' }],
  ['organization token', { type: 'org' }],
  ['missing token type', { type: undefined }],
]) test(`identity rejects ${name}`, async () => {
  await rejectsIdentity(async () => verify(await fixture.signToken(patch)));
});

test('forged signature from another RSA key rejects', async () => {
  const attacker = await generateKeyPair('RS256');
  await rejectsIdentity(() => fixture.signToken({}, {}, attacker.privateKey).then(verify));
});

test('HS256 signed token cannot use the RSA public key as an HMAC secret', async () => {
  const token = await new SignJWT({ iss: fixture.config.issuer, aud: fixture.config.audience, sub: 'synthetic-student-a' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: fixture.kid })
    .sign(new TextEncoder().encode(JSON.stringify(fixture.jwks)));
  await rejectsIdentity(() => verify(token));
});

for (const [name, token] of [
  ['unsigned JWT', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9.'],
  ['malformed JWT', 'not-a-token'],
  ['combined duplicate header', 'first.token.signature,second.token.signature'],
  ['oversized JWT', 'a'.repeat(16_385)],
]) test(`identity rejects ${name}`, async () => { await rejectsIdentity(() => verify(token)); });

for (const [name, header] of [
  ['missing key ID', { kid: undefined }], ['unknown key ID', { kid: 'unknown-key' }],
  ['wrong token type', { typ: 'at+jwt' }],
  ['caller JWKS URL', { jku: 'https://attacker.example.invalid/jwks' }],
  ['embedded caller key', { jwk: { kty: 'RSA' } }],
  ['caller certificate URL', { x5u: 'https://attacker.example.invalid/cert' }],
]) test(`identity rejects ${name}`, async () => {
  await rejectsIdentity(() => fixture.signToken({}, header).then(verify));
});

test('key service failures return safe service error with no upstream content', async () => {
  await assert.rejects(verifyIdentity(fixture.tokens.a, fixture.config, async () => {
    throw Object.assign(new Error('private upstream detail'), { code: 'ERR_JWKS_TIMEOUT' });
  }), { code: 'identity_provider_unavailable', status: 503, message: 'identity_provider_unavailable' });
});

test('remote verification pins JWKS URL and disregards client-selected tenant headers', async () => {
  const remote = await createAuthFixture('https://remote-synthetic-students.cloudflareaccess.com');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), redirect: init.redirect });
    return new Response(JSON.stringify(remote.jwks));
  };
  try {
    const request = new Request('https://community.example.invalid/api/onboarding', { headers: {
      'Cf-Access-Jwt-Assertion': remote.tokens.a, 'X-Tenant-ID': 'victim',
      'Cf-Access-Authenticated-User-Email': 'victim@example.invalid',
    } });
    const identity = await authenticate(request, remote.env);
    assert.equal(identity.subject, 'synthetic-student-a');
    assert.notEqual(identity.tenantId, 'victim');
    assert.deepEqual(calls, [{ url: `${remote.config.issuer}/cdn-cgi/access/certs`, redirect: 'manual' }]);
    await authenticate(request, remote.env);
    assert.equal(calls.length, 1, 'only public JWKS is cached');
  } finally { globalThis.fetch = originalFetch; }
});

for (const kind of ['announced oversize', 'stream oversize', 'invalid JWKS', 'non-200 status', 'redirect response']) {
  test(`remote JWKS rejects ${kind}`, async () => {
    const remote = await createAuthFixture(`https://bounded-${kind.toLowerCase().replaceAll(' ', '-')}.cloudflareaccess.com`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      if (kind === 'announced oversize') return new Response('{}', { headers: { 'content-length': '65537' } });
      if (kind === 'stream oversize') return new Response(' '.repeat(65_537));
      if (kind === 'invalid JWKS') return new Response('not JSON');
      if (kind === 'redirect response') return new Response(null, { status: 302, headers: { location: 'https://attacker.example.invalid/keys' } });
      return new Response('upstream private detail', { status: 503 });
    };
    try {
      await assert.rejects(authenticate(new Request('https://community.example.invalid/api/onboarding', {
        headers: { 'Cf-Access-Jwt-Assertion': remote.tokens.a },
      }), remote.env), { code: 'identity_provider_unavailable', status: 503 });
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('JWKS deadline covers a stalled response body after successful headers', async () => {
  const remote = await createAuthFixture('https://stalled-body.cloudflareaccess.com');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
  try {
    const started = Date.now();
    await assert.rejects(authenticate(new Request('https://community.example.invalid/api/onboarding', {
      headers: { 'Cf-Access-Jwt-Assertion': remote.tokens.a },
    }), remote.env), { code: 'identity_provider_unavailable', status: 503 });
    assert.ok(Date.now() - started < 7_500, 'response body is bounded by the five-second deadline');
  } finally { globalThis.fetch = originalFetch; }
});
