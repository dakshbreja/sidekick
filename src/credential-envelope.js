// Copyright 2026 Daksh Breja. All rights reserved.
// Server-side encryption at rest, NOT end-to-end encryption. Storage lifecycle,
// refresh leases, key rotation and deletion are owned by the connector store.
import { base64url } from 'jose';

const MAX_PLAINTEXT_BYTES = 24000;
const encoder = new TextEncoder();
export class CredentialEnvelopeError extends Error {
  constructor(code) { super(code); this.name = 'CredentialEnvelopeError'; this.code = code; }
}
const fail = code => { throw new CredentialEnvelopeError(code); };
function decode(value, max) {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) fail('credential_envelope_invalid');
  const bytes = base64url.decode(value);
  if (base64url.encode(bytes) !== value) fail('credential_envelope_invalid');
  return bytes;
}
function context({ tenantId, connectionId, generation, purpose }) {
  if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(tenantId) ||
      typeof connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(connectionId) ||
      !Number.isSafeInteger(generation) || generation < 1 || !['google_tokens', 'google_oauth_pending', 'school_feed'].includes(purpose)) fail('credential_context_invalid');
  // Ordered tuple prevents ambiguous concatenation and cross-purpose reuse.
  return encoder.encode(JSON.stringify(['school-bridge-credential', 1, tenantId, connectionId, generation, purpose]));
}
async function key(secret) {
  let bytes;
  try { bytes = decode(secret, 43); } catch { fail('credential_key_not_configured'); }
  if (bytes.byteLength !== 32) fail('credential_key_not_configured');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealCredential(secret, binding, value) {
  const additionalData = context(binding);
  let plaintext;
  try {
    const serialized = JSON.stringify(value);
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('credential_payload_invalid');
    plaintext = encoder.encode(serialized);
  } catch { fail('credential_payload_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || plaintext.byteLength > MAX_PLAINTEXT_BYTES) fail('credential_payload_invalid');
  const imported = await key(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, imported, plaintext);
  return { version: 1, iv: base64url.encode(iv), ciphertext: base64url.encode(new Uint8Array(ciphertext)) };
}
export async function openCredential(secret, binding, envelope) {
  const additionalData = context(binding);
  const imported = await key(secret);
  try {
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'ciphertext,iv,version' || envelope.version !== 1) throw new Error();
    const iv = decode(envelope.iv, 16), ciphertext = decode(envelope.ciphertext, Math.ceil((MAX_PLAINTEXT_BYTES + 16) * 4 / 3));
    if (iv.byteLength !== 12 || ciphertext.byteLength < 18 || ciphertext.byteLength > MAX_PLAINTEXT_BYTES + 16) throw new Error();
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, imported, ciphertext);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail('credential_envelope_invalid'); }
}
