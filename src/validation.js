// Copyright 2026 Daksh Breja. All rights reserved.
// Validate the same contract at the storage boundary as at the HTTP boundary.
export class ContractError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function fail(code, status = 400) { throw new ContractError(code, status); }
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail('unknown_field');
  return value;
}
export function string(value, max, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) ||
      (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('invalid_string');
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) fail('invalid_id');
  return value;
}
export function operationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) fail('invalid_operation_id');
  return value;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_revision');
  return value;
}
function enumeration(value, options) { if (!options.includes(value)) fail('invalid_value'); return value; }
function optionalString(value, max) { return value === undefined ? '' : string(value, max, { empty: true }); }
function courseId(value, optional = false) { return optional && (value === null || value === undefined) ? null : id(value); }
function timezone(value) {
  string(value, 100);
  try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { fail('invalid_timezone'); }
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('invalid_timestamp');
  const normalized = new Date(value).toISOString();
  const padded = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  if (normalized !== padded) fail('invalid_timestamp');
  return normalized;
}
function siteUrl(value) {
  string(value, 1000);
  let url;
  try { url = new URL(value); } catch { fail('invalid_site_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.hostname === 'localhost' || !url.hostname.includes('.') || url.port) fail('unsafe_site_url');
  return url.href;
}
export const WRITES = new Set(['profile.put', 'courses.put', 'materials.put', 'progress.put', 'learning.put', 'connections.put', 'calendar.put', 'google_selection.put', 'account.delete']);
// Used by both the pre-parse replay lookup and the final calendar save. No
// time-dependent parsing belongs here: exact original bytes establish identity.
export function validateCalendarFingerprint(data) {
  object(data, ['id', 'course_id', 'source_id', 'ics']);
  const ics = string(data.ics, 250000, { multiline: true });
  if (new TextEncoder().encode(ics).byteLength > 250000) fail('calendar_too_large', 413);
  return { id: id(data.id), course_id: courseId(data.course_id, true), source_id: id(data.source_id), ics };
}
export function validateWrite(op, data) {
  switch (op) {
    case 'profile.put': {
      object(data, ['display_name', 'timezone', 'consent_version', 'institution', 'school_email', 'study_goals', 'learning_preferences']);
      const value = { display_name: string(data.display_name, 100), timezone: timezone(data.timezone), consent_version: string(data.consent_version, 50) };
      // Preserve the original fingerprint for queued v1 saves: absent additions
      // stay absent. These self-reported fields never grant school access.
      if (data.institution !== undefined) value.institution = string(data.institution, 200, { empty: true });
      if (data.school_email !== undefined) {
        value.school_email = string(data.school_email, 320, { empty: true });
        if (value.school_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.school_email)) fail('invalid_school_email');
      }
      for (const field of ['study_goals', 'learning_preferences']) {
        if (data[field] !== undefined) value[field] = string(data[field], 2000, { empty: true, multiline: true });
      }
      return { kind: 'profile', id: 'profile', value };
    }
    case 'courses.put': {
      object(data, ['id', 'code', 'title', 'section', 'term_id']);
      const value = { id: id(data.id), code: string(data.code, 50), title: string(data.title, 200), section: optionalString(data.section, 80), term_id: id(data.term_id) };
      return { kind: 'courses', id: value.id, value };
    }
    case 'materials.put': {
      object(data, ['id', 'course_id', 'title', 'text', 'source_kind', 'material_kind', 'source_label']);
      const value = { id: id(data.id), course_id: courseId(data.course_id), title: string(data.title, 200), text: string(data.text, 100000, { multiline: true }), source_kind: enumeration(data.source_kind, ['manual', 'text_import']) };
      if (data.material_kind !== undefined) value.material_kind = enumeration(data.material_kind, ['course_text', 'notes', 'transcript']);
      if (data.source_label !== undefined) value.source_label = string(data.source_label, 200, { empty: true });
      return { kind: 'materials', id: value.id, value };
    }
    case 'progress.put': {
      object(data, ['id', 'course_id', 'assignment_id', 'title', 'status', 'submitted', 'verification', 'note']);
      const submitted = data.submitted === undefined ? null : data.submitted;
      if (![true, false, null].includes(submitted)) fail('invalid_submission');
      const status = enumeration(data.status, ['not_started', 'in_progress', 'blocked', 'done']);
      const verification = enumeration(data.verification, ['reported', 'unknown']);
      if (status === 'done' && (submitted !== true || verification !== 'reported')) fail('done_requires_reported_submission');
      if (submitted === true && status !== 'done') fail('inconsistent_submission');
      const value = { id: id(data.id), course_id: courseId(data.course_id), assignment_id: id(data.assignment_id), title: string(data.title, 200), status, submitted, verification, note: string(data.note ?? '', 2000, { empty: true, multiline: true }) };
      return { kind: 'progress', id: value.id, value };
    }
    case 'learning.put': {
      object(data, ['course_id', 'session_id', 'observations', 'resume']);
      if (!Array.isArray(data.observations) || data.observations.length > 50) fail('invalid_observations');
      const observations = data.observations.map((observation) => {
        object(observation, ['topic_id', 'outcome', 'assistance', 'evidence', 'next_step']);
        const value = { topic_id: id(observation.topic_id), outcome: enumeration(observation.outcome, ['correct', 'partial', 'incorrect', 'unassessed']), assistance: enumeration(observation.assistance, ['independent', 'hints', 'explanation']), evidence: enumeration(observation.evidence, ['observed_response', 'learner_report', 'discussion_only']), next_step: string(observation.next_step ?? '', 2000, { empty: true, multiline: true }) };
        if (value.outcome !== 'unassessed' && (value.evidence !== 'observed_response' || value.assistance === 'explanation')) fail('assessment_requires_observed_response');
        if (value.assistance === 'explanation' && value.evidence !== 'discussion_only') fail('explanation_is_not_observed_understanding');
        return value;
      });
      if (new Set(observations.map((observation) => observation.topic_id)).size !== observations.length) fail('duplicate_topic');
      const value = { course_id: courseId(data.course_id), session_id: id(data.session_id), observations, resume: string(data.resume ?? '', 8000, { empty: true, multiline: true }) };
      return { kind: 'learning', id: `${value.course_id}:${value.session_id}`, value };
    }
    case 'connections.put': {
      object(data, ['id', 'provider', 'site_url']);
      const value = { id: id(data.id), provider: enumeration(data.provider, ['elc', 'google_calendar', 'google_drive', 'manual', 'other']), site_url: siteUrl(data.site_url) };
      return { kind: 'connections', id: value.id, value };
    }
    case 'google_selection.put': {
      object(data, ['id', 'connection_generation', 'calendar_ids']);
      const generation = revision(data.connection_generation);
      if (generation < 1 || !Array.isArray(data.calendar_ids) || data.calendar_ids.length > 20) fail('invalid_calendar_selection');
      const calendar_ids = data.calendar_ids.map(value => {
        string(value, 1024);
        if (/[\u0000-\u0020\u007f]/.test(value) || ['.', '..'].includes(value)) fail('invalid_calendar_selection');
        return value;
      });
      if (new Set(calendar_ids).size !== calendar_ids.length) fail('duplicate_calendar_selection');
      const value = { id: id(data.id), connection_generation: generation, calendar_ids: calendar_ids.sort() };
      return { kind: 'google_selection', id: value.id, value };
    }
    case 'calendar.put': {
      object(data, ['id', 'course_id', 'source_id', 'events', 'coverage']);
      if (!Array.isArray(data.events) || data.events.length > 500) fail('invalid_events');
      // The Worker parser's exact event contract is independently checked here.
      const events = data.events.map((event) => {
        object(event, ['uid', 'title', 'start', 'end', 'all_day', 'timezone', 'description', 'location']);
        if (typeof event.all_day !== 'boolean') fail('invalid_event');
        const start = timestamp(event.start);
        const end = event.end === null || event.end === undefined ? null : timestamp(event.end);
        if (end && end < start) fail('invalid_event_range');
        return { uid: string(event.uid, 200), title: string(event.title, 200), start, end, all_day: event.all_day, ...(event.timezone === undefined ? {} : { timezone: timezone(event.timezone) }), ...(event.description === undefined ? {} : { description: string(event.description, 2000, { empty: true, multiline: true }) }), ...(event.location === undefined ? {} : { location: string(event.location, 300, { empty: true }) }) };
      });
      if (new Set(events.map((event) => `${event.uid}\u0000${event.start}`)).size !== events.length) fail('duplicate_event');
      object(data.coverage, ['mode', 'window_start', 'window_end', 'complete', 'warnings']);
      if (data.coverage.mode !== 'imported_only' || typeof data.coverage.complete !== 'boolean' || !Array.isArray(data.coverage.warnings) || data.coverage.warnings.length > 20) fail('invalid_coverage');
      const warnings = data.coverage.warnings.map((warning) => {
        object(warning, ['code', 'count']);
        const code = string(warning.code, 80);
        if (!Number.isSafeInteger(warning.count) || warning.count < 1 || warning.count > 10000) fail('invalid_coverage');
        return { code, count: warning.count };
      });
      if (data.coverage.complete && warnings.length) fail('inconsistent_coverage');
      const window_start = timestamp(data.coverage.window_start);
      const window_end = timestamp(data.coverage.window_end);
      if (window_end <= window_start) fail('invalid_coverage');
      const value = { id: id(data.id), course_id: courseId(data.course_id, true), source_id: id(data.source_id), events, coverage: { mode: 'imported_only', window_start, window_end, complete: data.coverage.complete, warnings } };
      return { kind: 'calendar', id: value.id, value };
    }
    case 'account.delete':
      object(data, ['confirm']);
      if (data.confirm !== 'DELETE_MY_WORKSPACE') fail('confirmation_required');
      return { kind: 'account', id: 'account', value: { confirm: data.confirm } };
    default: fail('unknown_operation', 404);
  }
}
export function validateRead(op, data) {
  const fields = {
    'profile.get': [], 'courses.list': ['term_id', 'limit', 'cursor'],
    'materials.list': ['course_id', 'limit', 'cursor'], 'materials.get': ['id'],
    'progress.list': ['course_id', 'status', 'limit', 'cursor'],
    'learning.get': ['course_id', 'session_id'],
    'connections.list': ['provider', 'limit', 'cursor'],
    'calendar.list': ['course_id', 'source_id', 'limit', 'cursor'],
    'google_selection.get': ['id'],
    'receipt.get': ['operation_id'], 'account.export': [],
  }[op];
  if (!fields) fail('unknown_operation', 404);
  object(data, fields);
  for (const key of ['id', 'course_id', 'session_id', 'term_id', 'source_id']) if (data[key] !== undefined) id(data[key]);
  if (['materials.get', 'google_selection.get'].includes(op) && data.id === undefined) fail('invalid_id');
  if (op === 'learning.get' && data.course_id === undefined) fail('invalid_id');
  if (op === 'receipt.get') operationId(data.operation_id);
  if (data.status !== undefined) enumeration(data.status, ['not_started', 'in_progress', 'blocked', 'done']);
  if (data.provider !== undefined) enumeration(data.provider, ['elc', 'google_calendar', 'google_drive', 'manual', 'other']);
  if (data.limit !== undefined && (!Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 100)) fail('invalid_limit');
  if (data.cursor !== undefined) id(data.cursor);
  return data;
}
