// Synthetic only. Keys are generated per test run and never persisted.
import { base64url, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function createAuthFixture(issuer = 'https://synthetic-students.cloudflareaccess.com') {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = crypto.randomUUID();
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid, use: 'sig', alg: 'RS256' }] };
  const config = {
    issuer,
    audience: 'synthetic-application-audience',
    tenantIdKey: base64url.encode(crypto.getRandomValues(new Uint8Array(32))),
  };
  const env = {
    ACCESS_ISSUER: config.issuer,
    ACCESS_AUDIENCE: config.audience,
    TENANT_ID_KEY: config.tenantIdKey,
  };
  async function signToken(overrides = {}, header = {}, signingKey = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: config.issuer, aud: [config.audience], sub: 'synthetic-student-a',
      email: 'student-a@example.invalid', type: 'app', iat: now, nbf: now, exp: now + 300,
      ...overrides,
    }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid, ...header }).sign(signingKey);
  }
  return {
    config, env, jwks, kid, publicKey, privateKey, signToken,
    keyResolver: createLocalJWKSet(jwks),
    tokens: {
      a: await signToken(),
      b: await signToken({ sub: 'synthetic-student-b', email: 'student-b@example.invalid' }),
    },
  };
}
