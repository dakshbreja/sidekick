// Copyright 2026 Daksh Breja. All rights reserved.
// Server-only transport. No routes, credentials, consent or scheduler are enabled
// by importing this module. Callers must bind selections/cursors to one student.
export const GOOGLE_CALENDAR_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]);
export const GOOGLE_LIMITS = Object.freeze({ pageItems: 100, responseBytes: 1000000, timeoutMs: 10000 });

export class CalendarProviderError extends Error {
  constructor(code, { retryable = false, retryAfterSeconds = null } = {}) {
    super(code);
    this.name = 'CalendarProviderError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
const invalid = () => new CalendarProviderError('calendar_provider_invalid_response');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max, optional = false) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw invalid();
  return value;
}
function input(value, max) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new CalendarProviderError('calendar_provider_invalid_input');
  }
  return value;
}
function retryAfter(response) {
  const raw = response.headers.get('retry-after');
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  // Longer delays are not shortened: caller must stop/back off for the full value.
  return Number(raw);
}
function point(value) {
  if (!plain(value)) throw invalid();
  const result = {};
  if (value.date !== undefined) {
    if (value.dateTime !== undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw invalid();
    const date = new Date(value.date);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.date) throw invalid();
    result.date = value.date;
  } else {
    const dateTime = text(value.dateTime, 100);
    // Preserve source zone/offset; do not silently convert date-only deadlines.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(dateTime)) throw invalid();
    const date = dateTime.slice(0, 10);
    const parsedDate = new Date(date);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || Number(dateTime.slice(11, 13)) > 23 || Number(dateTime.slice(14, 16)) > 59 || Number(dateTime.slice(17, 19)) > 59) throw invalid();
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateTime);
    if (!hasOffset && value.timeZone === undefined || hasOffset && !Number.isFinite(Date.parse(dateTime))) throw invalid();
    result.dateTime = dateTime;
  }
  if (value.timeZone !== undefined) {
    result.timeZone = text(value.timeZone, 100);
    try { new Intl.DateTimeFormat('en-US', { timeZone: result.timeZone }); } catch { throw invalid(); }
  }
  return result;
}
function event(value) {
  if (!plain(value)) throw invalid();
  const result = { id: text(value.id, 1024), status: value.status };
  if (!['confirmed', 'tentative', 'cancelled'].includes(result.status)) throw invalid();
  // Deleted entries can contain only id + status. Recurring cancellations must
  // retain the parent and original occurrence, even when start/end are absent.
  for (const [key, max] of [['summary', 4000], ['description', 32000], ['location', 4000], ['recurringEventId', 1024], ['updated', 100]]) {
    if (value[key] !== undefined && value[key] !== '') result[key] = text(value[key], max);
  }
  for (const key of ['start', 'end', 'originalStartTime']) if (value[key] !== undefined) result[key] = point(value[key]);
  if (result.status !== 'cancelled' && (!result.start || !result.end)) throw invalid();
  if (result.start && result.end) {
    if (Boolean(result.start.date) !== Boolean(result.end.date)) throw invalid();
    const start = result.start.date ?? result.start.dateTime, end = result.end.date ?? result.end.dateTime;
    // Offsets allow absolute ordering. Local-zone times remain source facts for
    // a zone-aware projector; Date.parse must not apply the server's local zone.
    if (result.start.date && end <= start || /(?:Z|[+-]\d{2}:\d{2})$/.test(start) && /(?:Z|[+-]\d{2}:\d{2})$/.test(end) && Date.parse(end) < Date.parse(start)) throw invalid();
  }
  if (value.recurrence !== undefined) {
    if (!Array.isArray(value.recurrence) || value.recurrence.length > 20) throw invalid();
    result.recurrence = value.recurrence.map(line => text(line, 4000));
  }
  return result;
}
function calendar(value) {
  if (!plain(value)) throw invalid();
  const result = { id: text(value.id, 1024), accessRole: value.accessRole };
  if (!['none', 'freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner'].includes(result.accessRole)) throw invalid();
  for (const key of ['summary', 'timeZone']) if (value[key] !== undefined && value[key] !== '') result[key] = text(value[key], key === 'summary' ? 4000 : 100);
  if (value.primary !== undefined) {
    if (typeof value.primary !== 'boolean') throw invalid();
    result.primary = value.primary;
  }
  return result;
}

/** One bounded page per call. Durable callers own pacing, retries and commits. */
export function createGoogleCalendarClient({ fetcher = fetch, timeoutMs = GOOGLE_LIMITS.timeoutMs } = {}) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > GOOGLE_LIMITS.timeoutMs) {
    throw new CalendarProviderError('calendar_provider_invalid_input');
  }
  async function get(url, accessToken, hasSyncToken) {
    input(accessToken, 8192);
    const controller = new AbortController();
    let timer, reader, response;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CalendarProviderError('calendar_provider_timeout', { retryable: true })); }, timeoutMs);
    });
    try {
      response = await Promise.race([fetcher(url, {
        method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        redirect: 'manual', signal: controller.signal,
      }), timeout]);
      if (response.status === 401) throw new CalendarProviderError('calendar_authorization_required');
      if (response.status === 410 && hasSyncToken) throw new CalendarProviderError('calendar_full_sync_required');
      if (response.status === 429 || response.status >= 500) throw new CalendarProviderError('calendar_provider_unavailable', { retryable: true, retryAfterSeconds: retryAfter(response) });
      if (response.status === 404) throw new CalendarProviderError('calendar_not_accessible');
      if (response.status >= 300 && response.status < 400) throw new CalendarProviderError('calendar_provider_redirect_rejected');
      if (![200, 403].includes(response.status)) throw new CalendarProviderError('calendar_provider_request_rejected');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > GOOGLE_LIMITS.responseBytes)) throw invalid();
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw invalid();
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        size += value.byteLength;
        if (size > GOOGLE_LIMITS.responseBytes) throw invalid();
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
      if (!plain(body)) throw invalid();
      if (response.status === 403) {
        const errors = body.error?.errors;
        // Only these documented reasons are retryable. Never reflect provider
        // error strings, tokens, headers or private event content to a client.
        const limited = Array.isArray(errors) && errors.some(error => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(error?.reason));
        throw new CalendarProviderError(limited ? 'calendar_provider_unavailable' : 'calendar_not_accessible', { retryable: limited, retryAfterSeconds: limited ? retryAfter(response) : null });
      }
      return body;
    } catch (error) {
      if (error instanceof CalendarProviderError) throw error;
      throw new CalendarProviderError('calendar_provider_unavailable', { retryable: true });
    } finally {
      clearTimeout(timer);
      controller.abort();
      // A malicious/stalled stream's cancel promise must not outlive our bound.
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
  async function page(options, events) {
    if (!plain(options) || Object.keys(options).some(key => !['accessToken', 'calendarId', 'pageToken', 'syncToken'].includes(key))) throw new CalendarProviderError('calendar_provider_invalid_input');
    const { accessToken, calendarId, pageToken, syncToken } = options;
    const url = new URL(events ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input(calendarId, 1024))}/events` : 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
    if (events && ['.', '..'].includes(calendarId)) throw new CalendarProviderError('calendar_provider_invalid_input');
    url.searchParams.set('maxResults', String(GOOGLE_LIMITS.pageItems));
    if (pageToken !== undefined) url.searchParams.set('pageToken', input(pageToken, 8192));
    if (events) {
      url.searchParams.set('singleEvents', 'false');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('fields', 'timeZone,nextPageToken,nextSyncToken,items(id,status,summary,description,location,start,end,recurrence,recurringEventId,originalStartTime,updated)');
      if (syncToken !== undefined) url.searchParams.set('syncToken', input(syncToken, 8192));
    } else {
      if (syncToken !== undefined || calendarId !== undefined) throw new CalendarProviderError('calendar_provider_invalid_input');
      url.searchParams.set('minAccessRole', 'reader');
      url.searchParams.set('fields', 'nextPageToken,items(id,summary,timeZone,accessRole,primary)');
    }
    const body = await get(url.href, accessToken, syncToken !== undefined);
    if (!Array.isArray(body.items) || body.items.length > GOOGLE_LIMITS.pageItems) throw invalid();
    const nextPage = text(body.nextPageToken, 8192, true);
    const nextSync = text(body.nextSyncToken, 8192, true);
    if (events && (Boolean(nextPage) === Boolean(nextSync))) throw invalid();
    const items = body.items.map(events ? event : calendar);
    if (new Set(items.map(item => item.id)).size !== items.length) throw invalid();
    return { items, next_page_token: nextPage ?? null, next_sync_token: events ? nextSync ?? null : null,
      collection_complete: !nextPage, ...(events ? { time_zone: text(body.timeZone, 100, true) ?? null, recurrence_expanded: false } : {}) };
  }
  return Object.freeze({ calendarsPage: options => page(options, false), eventsPage: options => page(options, true) });
}
