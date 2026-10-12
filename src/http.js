export class HttpError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export const json = (value, status = 200) => Response.json(value, {status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Vary': 'Cf-Access-Jwt-Assertion',
}});

export async function readJSON(request, maxBytes = 350000) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError('json_required', 415);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > maxBytes) throw new HttpError('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('body_required');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError('request_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new HttpError('invalid_json'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new HttpError('object_required');
  return body;
}

export function mutationOrigin(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin || site === 'cross-site') throw new HttpError('cross_origin_write', 403);
}

export function queryData(url, allowed) {
  const result = {};
  for (const [key,value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result,key)) throw new HttpError('unknown_query_field');
    result[key] = value;
  }
  return result;
}

export function writePacket(body) {
  const {operation_id:operationId, expected_revision:expectedRevision, ...data} = body;
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) throw new HttpError('operation_id_required');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new HttpError('expected_revision_required');
  return {operationId, expectedRevision, data};
}
