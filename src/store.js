import {initializeTutor,tutorExport,clearTutor,TutorState} from './tutor.js';
import {readStudy,prepareStudy} from './study.js';
import {initializeSchoolFeeds,feedRows,publicFeed} from './school-feed-state.js';
import {dailyDashboard,schoolItems} from './daily-dashboard.js';
// Copyright 2026 Daksh Breja. All rights reserved.
import { initializeRevocations } from './google-revocation.js';
import { initializeGoogleSchedule } from './google-scheduler.js';
import { initializeGoogleCollection, clearGoogleCollection, reconcileGoogleSelection, exportGoogleSnapshots } from './google-collection-state.js';
import { ContractError, WRITES, fail, object, operationId, revision, validateCalendarFingerprint, validateRead, validateWrite } from './validation.js';

const KINDS = ['profile', 'courses', 'materials', 'progress', 'learning', 'connections', 'calendar', 'google_selection', 'assignments'];
export const STORE_LIMITS = Object.freeze({ recordBytes: 128000, totalRecordBytes: 10000000, totalReceiptBytes: 20000000, receipts: 5000, recordsPerKind: 100, calendars: 20 });
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function assessment(observations) {
  const summary = { independent_observed_correct: 0, assisted_observed_correct: 0, observed_partial: 0, observed_incorrect: 0, observed_unassessed: 0, learner_report_count: 0, discussion_only_count: 0 };
  for (const observation of observations) {
    if (observation.evidence !== 'observed_response') { summary[`${observation.evidence}_count`] += 1; continue; }
    if (observation.outcome === 'correct') summary[observation.assistance === 'independent' ? 'independent_observed_correct' : 'assisted_observed_correct'] += 1;
    else summary[`observed_${observation.outcome}`] += 1;
  }
  return summary;
}

/** One store per student Durable Object. No global student registry or data cache. */
export class StudentStore {
  constructor(storage, { clock = () => new Date().toISOString() } = {}) {
    this.storage = storage;
    this.sql = storage.sql;
    this.clock = clock;
    this.storage.transactionSync(() => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS workspace_meta (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT NOT NULL, account_revision INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, course_id TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, byte_count INTEGER NOT NULL, PRIMARY KEY(kind, id))');
      this.sql.exec('CREATE INDEX IF NOT EXISTS records_by_course ON records(kind, course_id, id)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS operations (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, body TEXT NOT NULL, byte_count INTEGER NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS connector_grants (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)');
      // Private connector state never enters records, operation receipts or exports.
      // Keeping it in this database makes deletion and its tombstone atomic.
      this.sql.exec('CREATE TABLE IF NOT EXISTS google_connections (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS google_choices (connection_id TEXT NOT NULL, generation INTEGER NOT NULL, calendar_id TEXT NOT NULL, observed_at INTEGER NOT NULL, body TEXT NOT NULL, byte_count INTEGER NOT NULL, PRIMARY KEY(connection_id, calendar_id))');
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)');
      initializeGoogleCollection(this);
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (4)');
      initializeGoogleSchedule(this);
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (5)');
      initializeRevocations(this);
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (6)');
      initializeTutor(this);
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (8)');
      initializeSchoolFeeds(this);
      this.sql.exec('INSERT OR IGNORE INTO schema_migrations (version) VALUES (7)');
    });
  }
  row(query, ...args) { return this.sql.exec(query, ...args).toArray()[0]; }
  getRecord(kind, id) {
    const row = this.row('SELECT body FROM records WHERE kind = ? AND id = ?', kind, id);
    return row ? JSON.parse(row.body) : null;
  }
  bind(tenantId) {
    let meta = this.row('SELECT * FROM workspace_meta WHERE singleton = 1');
    if (!meta) {
      this.sql.exec('INSERT INTO workspace_meta (singleton, owner) VALUES (1, ?)', tenantId);
      meta = this.row('SELECT * FROM workspace_meta WHERE singleton = 1');
    }
    if (meta.owner !== tenantId) fail('owner_mismatch', 403);
    return meta;
  }
  async dispatch(message, {commit=callback=>this.storage.transactionSync(callback)}={}) {
    try {
      object(message, ['tenantId', 'op', 'data', 'operationId', 'expectedRevision', 'fingerprintData']);
      if (typeof message.tenantId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(message.tenantId)) fail('invalid_owner', 403);
      if (typeof message.op !== 'string') fail('unknown_operation', 404);
      const writing = WRITES.has(message.op);
      const calendarReplay = message.op === 'calendar.replay';
      const data = message.data ?? {};
      let validated;
      let requestHash;
      if (writing || calendarReplay) {
        operationId(message.operationId);
        revision(message.expectedRevision);
        validated = calendarReplay ? { value: validateCalendarFingerprint(data) } : validateWrite(message.op, data);
        let fingerprint = validated.value;
        if (message.fingerprintData !== undefined) {
          if (message.op !== 'calendar.put') fail('unexpected_fingerprint');
          // Trusted Worker-only override: fingerprint original ICS, not the
          // current parser window or timestamps, for exact delayed retries.
          const raw = validateCalendarFingerprint(message.fingerprintData);
          if (raw.id !== validated.value.id || raw.course_id !== validated.value.course_id || raw.source_id !== validated.value.source_id) fail('fingerprint_identity_mismatch');
          fingerprint = raw;
        }
        if (!calendarReplay && bytes(JSON.stringify(validated.value)) > STORE_LIMITS.recordBytes) fail('record_too_large', 413);
        const request = canonical({ op: calendarReplay ? 'calendar.put' : message.op, data: fingerprint, expectedRevision: message.expectedRevision });
        if (bytes(request) > 300000) fail('record_too_large', 413);
        requestHash = await sha256(request);
      } else {
        if (message.operationId !== undefined || message.expectedRevision !== undefined || message.fingerprintData !== undefined) fail('unexpected_write_metadata');
        validated = validateRead(message.op, data);
      }
      return await commit(() => {
        const meta = this.bind(message.tenantId);
        if (meta.deleted) return this.deletedResponse(meta, message, requestHash);
        if (calendarReplay) {
          const saved = this.row('SELECT request_hash, body FROM operations WHERE operation_id = ?', message.operationId);
          if (!saved) return { ok: true, found: false };
          if (saved.request_hash !== requestHash) fail('operation_id_conflict', 409);
          return { ok: true, found: true, result: { ...JSON.parse(saved.body), replayed: true } };
        }
        return writing ? this.write(meta, message, validated, requestHash) : this.read(meta, message.op, validated);
      });
    } catch (error) {
      if (error instanceof ContractError) return { ok: false, error: error.code, status: error.status };
      // Never echo SQL, inputs, student content, or stack traces to the client.
      return { ok: false, error: 'storage_unavailable', status: 503 };
    }
  }
  deletedResponse(meta, message, requestHash) {
    if (message.op === 'account.export') return { ok: true, deleted: true, account_revision: meta.account_revision, data: this.emptyExport() };
    if (message.op === 'receipt.get') {
      const saved = this.row('SELECT body FROM operations WHERE operation_id = ?', message.data.operation_id);
      if (saved) return { ok: true, receipt: JSON.parse(saved.body).receipt, account_revision: meta.account_revision };
    }
    if (message.op === 'account.delete') {
      const saved = this.row('SELECT request_hash, body FROM operations WHERE operation_id = ?', message.operationId);
      if (saved) {
        if (saved.request_hash !== requestHash) fail('operation_id_conflict', 409);
        return { ...JSON.parse(saved.body), replayed: true };
      }
    }
    fail('account_deleted', 410);
  }
  requireCourse(course_id) {
    if (course_id && !this.getRecord('courses', course_id)) fail('course_not_found', 404);
  }
  googleConnection(connectionId) {
    const row = this.row('SELECT body FROM google_connections WHERE id = ?', connectionId);
    return row ? JSON.parse(row.body) : null;
  }
  activeGoogleConnection(connectionId, generation) {
    const connection = this.googleConnection(connectionId);
    return connection?.status === 'authorized_not_synced' && Boolean(connection.tokens) && connection.generation === generation && !(connection.refresh_expires_at && connection.refresh_expires_at <= Date.parse(this.clock()));
  }
  // Only normalized calendar metadata from the trusted provider adapter reaches
  // this method. The browser cannot register its own selectable calendar IDs.
  cacheGoogleChoices(tenantId, connectionId, generation, items) {
    if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(tenantId) || !Array.isArray(items) || items.length > 100) fail('invalid_calendar_choices');
    return this.storage.transactionSync(() => {
      const meta = this.bind(tenantId); if (meta.deleted) fail('account_deleted', 410);
      if (!this.activeGoogleConnection(connectionId, generation)) fail('google_access_changed', 409);
      const now = Date.parse(this.clock());
      this.sql.exec('DELETE FROM google_choices WHERE observed_at < ? OR (connection_id = ? AND generation != ?)', now - 86400000, connectionId, generation);
      for (const item of items) {
        object(item, ['id', 'summary', 'timeZone', 'accessRole', 'primary']);
        if (typeof item.id !== 'string' || !item.id.length || item.id.length > 1024 || /[\u0000-\u0020\u007f]/.test(item.id) || !['reader', 'writerWithoutPrivateAccess', 'writer', 'owner'].includes(item.accessRole)) fail('invalid_calendar_choices');
        const body = JSON.stringify(item); if (bytes(body) > 8000) fail('invalid_calendar_choices');
        this.sql.exec('INSERT INTO google_choices (connection_id, generation, calendar_id, observed_at, body, byte_count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connection_id, calendar_id) DO UPDATE SET generation = excluded.generation, observed_at = excluded.observed_at, body = excluded.body, byte_count = excluded.byte_count', connectionId, generation, item.id, now, body, bytes(body));
      }
      const size = this.row('SELECT COUNT(*) AS n, COALESCE(SUM(byte_count), 0) AS bytes FROM google_choices');
      if (size.n > 1000 || size.bytes > 1000000) fail('calendar_choices_limit', 409);
    });
  }
  read(meta, op, data) {
    const common = { ok: true, account_revision: meta.account_revision };
    if(op.startsWith('study.'))return readStudy(this,meta,op,data);
    if (op === 'daily.get') return {...dailyDashboard(this,{now:Date.parse(this.clock())}),account_revision:meta.account_revision};
    if (op === 'account.export') {
      const exported = this.emptyExport();
      for (const row of this.sql.exec('SELECT kind, body FROM records ORDER BY kind, id').toArray()) {
        const record = JSON.parse(row.body);
        if (row.kind === 'profile') exported.profile = record;
        else exported[row.kind].push(record);
      }
      exported.tutor_sessions=tutorExport(this);
      exported.google_calendar_snapshots = exportGoogleSnapshots(this);
      exported.school_feeds=feedRows(this).map(row=>({...publicFeed(row),snapshot:row.snapshot||null}));
      return { ...common, exported_at: this.clock(), deleted: false, data: exported };
    }
    if (op === 'receipt.get') {
      const saved = this.row('SELECT body FROM operations WHERE operation_id = ?', data.operation_id);
      if (!saved) fail('receipt_not_found', 404);
      return { ...common, receipt: JSON.parse(saved.body).receipt };
    }
    if (op === 'profile.get') {
      const record = this.getRecord('profile', 'profile');
      return { ...common, record, revision: record?.revision ?? 0 };
    }
    if (op === 'google_selection.get') {
      const record = this.getRecord('google_selection', data.id);
      if (this.getRecord('connections', data.id)?.provider !== 'google_calendar') fail('google_connection_not_found', 404);
      return { ...common, record, revision: record?.revision ?? 0, active: Boolean(record && this.activeGoogleConnection(data.id, record.connection_generation)), collection_status: 'not_synced' };
    }
    if (op === 'materials.get') {
      const record = this.getRecord('materials', data.id);
      if (!record) fail('material_not_found', 404);
      return { ...common, record, revision: record.revision };
    }
    if (op === 'learning.get') {
      this.requireCourse(data.course_id);
      const rows = this.sql.exec('SELECT body FROM records WHERE kind = ? AND course_id = ? ORDER BY updated_at DESC, id DESC', 'learning', data.course_id).toArray();
      const records = rows.map((row) => JSON.parse(row.body));
      const record = data.session_id ? records.find((entry) => entry.session_id === data.session_id) ?? null : records[0] ?? null;
      const summary = assessment(records.flatMap((entry) => entry.observations));
      const tutor=new TutorState(this).session(data.course_id);
      return { ...common, tutor_resume:tutor.revision?{revision:tutor.revision,updated_at:tutor.updated_at,summary:tutor.summary,pending_question:tutor.check?.question||null}:null, record, revision: record?.revision ?? 0, course_summary: summary, resume_scope: 'saved_handoffs_only', completeness: 'only_explicitly_saved_observations' };
    }
    const kind = op.split('.')[0];
    if (!KINDS.includes(kind)) fail('unknown_operation', 404);
    const rows = this.sql.exec('SELECT id, body FROM records WHERE kind = ? ORDER BY id', kind).toArray();
    const filtered = rows.filter((row) => data.cursor === undefined || row.id > data.cursor).map((row) => JSON.parse(row.body)).filter((record) =>
      ['course_id', 'term_id', 'status', 'provider', 'source_id'].every((key) => data[key] === undefined || record[key] === data[key]));
    const limit = data.limit ?? 100;
    const records = filtered.slice(0, limit).map((record) => {
      if (kind !== 'materials') return record;
      const { text, ...metadata } = record;
      return { ...metadata, text_length: text.length };
    });
    return { ...common, records, complete: filtered.length <= limit, next_cursor: filtered.length > limit ? records.at(-1).id : null };
  }
  emptyExport() { return { profile: null, courses: [], materials: [], progress: [], learning: [], connections: [], calendar: [], google_selection: [], google_calendar_snapshots: [], assignments: [], school_feeds: [], tutor_sessions: [], study_sessions: [] }; }
  write(meta, message, input, requestHash) {
    const saved = this.row('SELECT request_hash, body FROM operations WHERE operation_id = ?', message.operationId);
    if (saved) {
      if (saved.request_hash !== requestHash) fail('operation_id_conflict', 409);
      return { ...JSON.parse(saved.body), replayed: true };
    }
    if (message.op === 'account.delete') return this.deleteAccount(meta, message, requestHash);
    const old = this.getRecord(input.kind, input.id);
    if (input.kind === 'google_selection') {
      const selected = input.value;
      let reason = message.expectedRevision !== (old?.revision ?? 0) ? 'revision_conflict' : null;
      if (!reason && (this.getRecord('connections', input.id)?.provider !== 'google_calendar' || !this.activeGoogleConnection(input.id, selected.connection_generation))) reason = 'google_access_changed';
      for (const calendarId of selected.calendar_ids) {
        if (reason) break;
        const choice = this.row('SELECT generation, observed_at FROM google_choices WHERE connection_id = ? AND calendar_id = ?', input.id, calendarId);
        const retained = old?.connection_generation === selected.connection_generation && old.calendar_ids.includes(calendarId);
        if (!retained && (!choice || choice.generation !== selected.connection_generation || choice.observed_at <= Date.parse(this.clock()) - 3600000)) reason = 'calendar_choice_not_verified';
      }
      // Persist a terminal outcome in the same transaction used by successful
      // saves. A later retry cannot revive an obsolete packet after reconnect.
      if (reason) {
        const accountRevision = meta.account_revision + 1;
        const receipt = { operation_id: message.operationId, operation: message.op, resource_id: input.id, expected_revision: message.expectedRevision, account_revision: accountRevision, resolved_at: this.clock(), request_hash: requestHash, outcome: 'rejected', reason };
        const result = { ok: false, error: reason, status: 409, receipt };
        this.saveReceipt(message.operationId, requestHash, result);
        this.sql.exec('UPDATE workspace_meta SET account_revision = ? WHERE singleton = 1', accountRevision);
        return result;
      }
    }
    if (message.expectedRevision !== (old?.revision ?? 0)) fail('revision_conflict', 409);
    this.requireCourse(input.value.course_id);
    if(input.kind==='study_sessions')input={...input,value:prepareStudy(this,input.value,old)};
    if(input.kind==='progress' && input.id.startsWith('daily_')){
      const item=schoolItems(this).find(item=>item.id===input.value.assignment_id);
      if(!item || item.category!=='deadline' || input.id!=='daily_'+item.id || item.course_id!==input.value.course_id || item.title!==input.value.title)fail('assignment_changed',409);
    }
    if (input.kind === 'calendar') {
      if (!this.getRecord('connections', input.value.source_id)) fail('connection_not_found', 404);
      const calendars = this.sql.exec('SELECT id, body FROM records WHERE kind = ?', 'calendar').toArray();
      if (calendars.some((row) => row.id !== input.id && (() => {
        const existing = JSON.parse(row.body);
        return existing.course_id === input.value.course_id && existing.source_id === input.value.source_id;
      })())) fail('calendar_source_already_imported', 409);
    }
    if (old) {
      const immutable = input.kind === 'study_sessions' ? ['course_id','session_id','test_only'] : input.kind === 'courses' ? ['code', 'section', 'term_id'] : input.kind === 'connections' ? ['provider', 'site_url'] : ['course_id', 'assignment_id', 'source_id', 'provider'];
      if (immutable.some((key) => old[key] !== input.value[key])) fail('immutable_identity', 409);
    }
    const now = this.clock();
    const record = { ...input.value, revision: (old?.revision ?? 0) + 1, created_at: old?.created_at ?? now, updated_at: now };
    if (input.kind === 'connections') Object.assign(record, { status: record.provider === 'manual' ? 'manual_import' : 'needs_authorization', adapter_available: false, last_successful_sync: null });
    if (input.kind === 'google_selection') Object.assign(record, { collection_status: 'not_synced', last_successful_sync: null,
      calendars: record.calendar_ids.map(calendarId => {
        const choice = this.row('SELECT generation, body, observed_at FROM google_choices WHERE connection_id = ? AND calendar_id = ?', input.id, calendarId);
        if (choice?.generation === record.connection_generation) {
          const source = JSON.parse(choice.body);
          return { id: calendarId, summary: source.summary ?? '', time_zone: source.timeZone ?? null, source_observed_at: choice.observed_at };
        }
        return old.calendars.find(calendar => calendar.id === calendarId);
      }) });
    if (input.kind === 'learning') record.assessment = assessment(record.observations);
    if (input.kind === 'calendar') Object.assign(record, { imported_at: now, live_sync: false, source_freshness: 'unknown', coverage: { ...record.coverage, meaning: 'parsed_import_window_only' } });
    if (input.kind === 'progress') record.provenance = 'student_report_only';
    if (input.kind === 'google_selection') reconcileGoogleSelection(this, record);
    const body = JSON.stringify(record);
    const count = bytes(body);
    if (count > STORE_LIMITS.recordBytes) fail('record_too_large', 413);
    if (!old && this.row('SELECT COUNT(*) AS n FROM records WHERE kind = ?', input.kind).n >= (input.kind === 'calendar' ? STORE_LIMITS.calendars : STORE_LIMITS.recordsPerKind)) fail('record_limit_reached', 409);
    const total = this.row('SELECT COALESCE(SUM(byte_count), 0) AS n FROM records').n;
    const oldBytes = this.row('SELECT byte_count FROM records WHERE kind = ? AND id = ?', input.kind, input.id)?.byte_count ?? 0;
    if (total - oldBytes + count > STORE_LIMITS.totalRecordBytes) fail('workspace_storage_limit', 409);
    const accountRevision = meta.account_revision + 1;
    const receipt = { operation_id: message.operationId, operation: message.op, resource_id: input.id, revision: record.revision, account_revision: accountRevision, saved_at: now, request_hash: requestHash };
    const result = { ok: true, record, revision: record.revision, account_revision: accountRevision, receipt };
    this.saveReceipt(message.operationId, requestHash, result);
    this.sql.exec('INSERT INTO records (kind, id, course_id, revision, updated_at, body, byte_count) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET course_id = excluded.course_id, revision = excluded.revision, updated_at = excluded.updated_at, body = excluded.body, byte_count = excluded.byte_count', input.kind, input.id, record.course_id ?? null, record.revision, now, body, count);
    this.sql.exec('UPDATE workspace_meta SET account_revision = ? WHERE singleton = 1', accountRevision);
    return result;
  }
  saveReceipt(operation, requestHash, result) {
    const body = JSON.stringify(result);
    const count = bytes(body);
    const current = this.row('SELECT COUNT(*) AS n, COALESCE(SUM(byte_count), 0) AS bytes FROM operations');
    if (current.n >= STORE_LIMITS.receipts || current.bytes + count > STORE_LIMITS.totalReceiptBytes) fail('receipt_storage_limit', 409);
    this.sql.exec('INSERT INTO operations (operation_id, request_hash, body, byte_count) VALUES (?, ?, ?, ?)', operation, requestHash, body, count);
  }
  deleteAccount(meta, message, requestHash) {
    if (message.expectedRevision !== meta.account_revision) fail('revision_conflict', 409);
    const now = this.clock();
    const accountRevision = meta.account_revision + 1;
    const receipt = { operation_id: message.operationId, operation: 'account.delete', resource_id: 'account', revision: accountRevision, account_revision: accountRevision, saved_at: now, request_hash: requestHash, deleted: true };
    const result = { ok: true, deleted: true, revision: accountRevision, account_revision: accountRevision, receipt };
    this.sql.exec('DELETE FROM records');
    this.sql.exec('DELETE FROM operations');
    this.sql.exec('DELETE FROM connector_grants');
    this.sql.exec('DELETE FROM google_connections');
    this.sql.exec('DELETE FROM google_choices');
    clearGoogleCollection(this);
    this.sql.exec('DELETE FROM google_schedule');
    this.sql.exec('DELETE FROM google_revocations');
    this.sql.exec('DELETE FROM school_feeds');
    clearTutor(this);
    this.sql.exec('UPDATE workspace_meta SET deleted = 1, deleted_at = ?, account_revision = ? WHERE singleton = 1', now, accountRevision);
    this.saveReceipt(message.operationId, requestHash, result);
    return result;
  }
}
