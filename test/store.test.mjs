// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StudentStore, STORE_LIMITS } from '../src/store.js';
import { calendarImport } from '../src/calendar-import.js';
import { sqliteFixture } from './sqlite-fixture.mjs';

const ALICE = 'synthetic_student_alpha';
const BOB = 'synthetic_student_bravo';
const NOW = '2026-10-12T12:00:00.000Z';
const course = (id = 'course_a') => ({ id, code: 'TEST101', title: 'Synthetic Test Course', section: 'A', term_id: 'test_term_1' });
const material = (id = 'material_a', course_id = 'course_a') => ({ id, course_id, title: 'Synthetic source', text: 'A synthetic lesson.', source_kind: 'manual' });
const profile = { display_name: 'Synthetic Student', timezone: 'America/New_York', consent_version: 'pilot-v1' };
const observation = (overrides = {}) => ({ topic_id: 'topic_a', outcome: 'correct', assistance: 'independent', evidence: 'observed_response', next_step: 'Practice another synthetic example.', ...overrides });
const learning = (overrides = {}) => ({ course_id: 'course_a', session_id: 'session_a', observations: [observation()], resume: 'Continue with a synthetic example.', ...overrides });
const calendar = (overrides = {}) => ({ id: 'calendar_a', course_id: 'course_a', source_id: 'import_a', events: [{ uid: 'event_a', title: 'Synthetic event', start: '2026-10-13T12:00:00Z', end: null, all_day: false }], coverage: { mode: 'imported_only', window_start: '2026-09-12T12:00:00Z', window_end: '2027-04-12T12:00:00Z', complete: true, warnings: [] }, ...overrides });
const connection = (id = 'import_a') => ({ id, provider: 'manual', site_url: 'https://learning.example.edu/' });
function setup(t, options = {}) {
  const fixture = sqliteFixture(options);
  const store = new StudentStore(fixture.storage, { clock: () => NOW });
  t.after(() => fixture.close());
  let sequence = 0;
  const read = (op, data = {}, tenantId = ALICE) => store.dispatch({ tenantId, op, data });
  const write = (op, data, expectedRevision = 0, operation = `operation_${++sequence}`, extra = {}) => store.dispatch({ tenantId: ALICE, op, data, expectedRevision, operationId: operation, ...extra });
  return { ...fixture, store, read, write };
}

test('new workspace starts empty, with no tenant/auth internals in export', async (t) => {
  const { read } = setup(t);
  assert.deepEqual(await read('profile.get'), { ok: true, account_revision: 0, record: null, revision: 0 });
  for (const op of ['courses.list', 'materials.list', 'progress.list', 'connections.list', 'calendar.list']) {
    const result = await read(op);
    assert.equal(result.ok, true); assert.deepEqual(result.records, []); assert.equal(result.complete, true);
  }
  const result = await read('account.export');
  assert.equal(result.deleted, false); assert.equal(JSON.stringify(result).includes(ALICE), false);
  assert.deepEqual(result.data.learning, []);
});

test('separate SQLite tenants can reuse IDs and operation IDs without mixing data', async (t) => {
  const a = setup(t), b = setup(t);
  await a.write('courses.put', course());
  await b.write('courses.put', course(), 0, 'operation_1', { tenantId: BOB });
  await a.write('materials.put', { ...material(), text: 'Only Alpha can read this.' });
  await b.write('materials.put', { ...material(), text: 'Only Bravo can read this.' }, 0, 'operation_2', { tenantId: BOB });
  assert.equal((await a.read('materials.get', { id: 'material_a' })).record.text, 'Only Alpha can read this.');
  assert.equal((await b.read('materials.get', { id: 'material_a' }, BOB)).record.text, 'Only Bravo can read this.');
  assert.equal(JSON.stringify(await a.read('account.export')).includes('Only Bravo'), false);
});

test('bound owner mismatch fails closed after reinitializing the store', async (t) => {
  const { storage, write } = setup(t);
  await write('profile.put', profile);
  const restored = new StudentStore(storage);
  assert.deepEqual(await restored.dispatch({ tenantId: BOB, op: 'profile.get', data: {} }), { ok: false, error: 'owner_mismatch', status: 403 });
});

test('invalid owner and arbitrary dispatch envelope fields are rejected', async (t) => {
  const { store } = setup(t);
  assert.equal((await store.dispatch({ tenantId: 'short', op: 'profile.get' })).error, 'invalid_owner');
  assert.equal((await store.dispatch({ tenantId: ALICE, op: 'profile.get', owner: BOB })).error, 'unknown_field');
});

test('guessed foreign material and receipt IDs reveal no data', async (t) => {
  const a = setup(t), b = setup(t);
  await a.write('courses.put', course());
  await a.write('materials.put', material(), 0, 'alpha_save_1');
  assert.equal((await b.read('materials.get', { id: 'material_a' }, BOB)).status, 404);
  assert.equal((await b.read('receipt.get', { operation_id: 'alpha_save_1' }, BOB)).status, 404);
  assert.deepEqual((await b.read('materials.list', { course_id: 'course_a' }, BOB)).records, []);
});

test('strict unknown-field rejection covers every read and write owner selector', async (t) => {
  const { read, write } = setup(t);
  for (const data of [{ ...profile, tenant_id: BOB }, { ...profile, user_id: BOB }, { ...profile, owner: BOB }]) assert.equal((await write('profile.put', data)).error, 'unknown_field');
  for (const op of ['profile.get', 'courses.list', 'materials.list', 'progress.list', 'connections.list', 'calendar.list', 'account.export']) assert.equal((await read(op, { tenant_id: BOB })).error, 'unknown_field');
  assert.equal((await write('learning.put', learning({ observations: [observation({ tenant_id: BOB })] }))).error, 'unknown_field');
});

test('same logical save returns original receipt and record on exact replay', async (t) => {
  const { write, read } = setup(t);
  const first = await write('profile.put', profile, 0, 'profile_save_1');
  assert.equal(first.ok, true); assert.equal(first.revision, 1);
  const again = await write('profile.put', { consent_version: profile.consent_version, timezone: profile.timezone, display_name: profile.display_name }, 0, 'profile_save_1');
  assert.deepEqual(again, { ...first, replayed: true });
  assert.deepEqual((await read('receipt.get', { operation_id: 'profile_save_1' })).receipt, first.receipt);
  assert.equal((await read('profile.get')).account_revision, 1);
});

test('operation ID reuse with changed content, operation or revision conflicts', async (t) => {
  const { write } = setup(t);
  await write('profile.put', profile, 0, 'fixed_save_1');
  assert.equal((await write('profile.put', { ...profile, display_name: 'Changed' }, 0, 'fixed_save_1')).error, 'operation_id_conflict');
  assert.equal((await write('profile.put', profile, 1, 'fixed_save_1')).error, 'operation_id_conflict');
  assert.equal((await write('courses.put', course(), 0, 'fixed_save_1')).error, 'operation_id_conflict');
});

test('stale revisions and simultaneous writers cannot overwrite committed data', async (t) => {
  const { write, read } = setup(t);
  const results = await Promise.all([write('profile.put', { ...profile, display_name: 'First' }, 0, 'first_save_1'), write('profile.put', { ...profile, display_name: 'Second' }, 0, 'second_save_1')]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).error, 'revision_conflict');
  assert.equal((await read('profile.get')).account_revision, 1);
});

test('receipt and record writes roll back atomically when storage fails between them', async (t) => {
  let enabled = true;
  const { write, read, database } = setup(t, { beforeExec: (query) => { if (enabled && query.startsWith('INSERT INTO records')) throw new Error('synthetic storage failure'); } });
  assert.equal((await write('profile.put', profile, 0, 'atomic_save_1')).error, 'storage_unavailable');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 0);
  assert.equal((await read('profile.get')).account_revision, 0);
  enabled = false;
  assert.equal((await write('profile.put', profile, 0, 'atomic_save_1')).ok, true);
});

test('state, receipts and revision survive constructing a fresh store', async (t) => {
  const { storage, write } = setup(t);
  const result = await write('profile.put', profile, 0, 'restart_save_1');
  const fresh = new StudentStore(storage);
  assert.equal((await fresh.dispatch({ tenantId: ALICE, op: 'profile.get' })).record.display_name, profile.display_name);
  assert.deepEqual((await fresh.dispatch({ tenantId: ALICE, op: 'receipt.get', data: { operation_id: 'restart_save_1' } })).receipt, result.receipt);
});

test('courses are arbitrary per-student configuration and identity cannot be silently retagged', async (t) => {
  const { write, read } = setup(t);
  assert.equal((await write('courses.put', { ...course('arbitrary_42'), code: 'ART998', term_id: 'future_term' })).ok, true);
  assert.equal((await write('courses.put', { ...course('arbitrary_42'), code: 'ART998', term_id: 'different_term' }, 1)).error, 'immutable_identity');
  assert.equal((await read('courses.list', { term_id: 'future_term' })).records.length, 1);
  assert.equal((await read('courses.list', { term_id: 'other_term' })).records.length, 0);
});

test('materials, progress, learning and course-linked calendars require a local course', async (t) => {
  const { write } = setup(t);
  const packets = [['materials.put', material()], ['progress.put', { id: 'progress_a', course_id: 'course_a', assignment_id: 'assignment_a', title: 'Synthetic task', status: 'in_progress', submitted: false, verification: 'unknown' }], ['learning.put', learning()], ['calendar.put', calendar()]];
  for (const [op, data] of packets) assert.equal((await write(op, data)).error, 'course_not_found');
});

test('material list contains metadata; individual read returns exact text', async (t) => {
  const { write, read } = setup(t);
  await write('courses.put', course());
  await write('materials.put', material());
  const listed = await read('materials.list');
  assert.equal(listed.records[0].text, undefined); assert.equal(listed.records[0].text_length, material().text.length);
  assert.equal((await read('materials.get', { id: 'material_a' })).record.text, material().text);
  assert.equal((await write('materials.put', { ...material(), source_kind: 'verified_elc' }, 1)).ok, false);
});

test('record identities cannot be reassigned to a different course or assignment', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course()); await write('courses.put', course('course_b'));
  await write('materials.put', material());
  assert.equal((await write('materials.put', material('material_a', 'course_b'), 1)).error, 'immutable_identity');
  const data = { id: 'progress_a', course_id: 'course_a', assignment_id: 'assignment_a', title: 'Task', status: 'in_progress', submitted: false, verification: 'unknown' };
  await write('progress.put', data);
  assert.equal((await write('progress.put', { ...data, assignment_id: 'assignment_b' }, 1)).error, 'immutable_identity');
});

test('progress never permits source verification or done without reported submission', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course());
  const data = { id: 'progress_a', course_id: 'course_a', assignment_id: 'assignment_a', title: 'Task', status: 'done', submitted: true, verification: 'reported' };
  for (const changes of [{ verification: 'verified' }, { submitted: false }, { submitted: null }, { verification: 'unknown' }, { status: 'in_progress' }]) assert.equal((await write('progress.put', { ...data, ...changes })).ok, false);
  const result = await write('progress.put', data);
  assert.equal(result.ok, true); assert.equal(result.record.provenance, 'student_report_only');
});

test('wrong, partial, discussed and reported answers do not count as observed correct', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course());
  const observations = [observation({ topic_id: 'a', outcome: 'incorrect' }), observation({ topic_id: 'b', outcome: 'partial' }), observation({ topic_id: 'c', outcome: 'unassessed', evidence: 'discussion_only' }), observation({ topic_id: 'd', outcome: 'unassessed', evidence: 'learner_report' }), observation({ topic_id: 'e', assistance: 'hints' }), observation({ topic_id: 'f' })];
  const result = await write('learning.put', learning({ observations }));
  assert.deepEqual(result.record.assessment, { independent_observed_correct: 1, assisted_observed_correct: 1, observed_partial: 1, observed_incorrect: 1, observed_unassessed: 0, learner_report_count: 1, discussion_only_count: 1 });
});

test('updating a saved learning session replaces observations without double counting and resumes freshly', async (t) => {
  const { write, storage } = setup(t);
  await write('courses.put', course());
  await write('learning.put', learning());
  await write('learning.put', learning({ observations: [observation({ outcome: 'incorrect' })], resume: 'Review the mistake before new work.' }), 1);
  const fresh = new StudentStore(storage);
  const result = await fresh.dispatch({ tenantId: ALICE, op: 'learning.get', data: { course_id: 'course_a' } });
  assert.equal(result.record.resume, 'Review the mistake before new work.');
  assert.equal(result.revision, 2); assert.equal(result.course_summary.independent_observed_correct, 0); assert.equal(result.course_summary.observed_incorrect, 1);
  assert.equal(result.resume_scope, 'saved_handoffs_only');
});

test('unknown local session returns an empty handoff without reaching another course', async (t) => {
  const { write, read } = setup(t);
  await write('courses.put', course()); await write('courses.put', course('course_b'));
  await write('learning.put', learning());
  assert.equal((await read('learning.get', { course_id: 'course_b', session_id: 'session_a' })).record, null);
  assert.equal((await read('learning.get', { course_id: 'guessed_foreign' })).status, 404);
});

test('connection metadata does not grant authorization or claim a successful sync', async (t) => {
  const { write } = setup(t);
  const result = await write('connections.put', { id: 'source_a', provider: 'elc', site_url: 'https://learning.example.edu/' });
  assert.equal(result.record.status, 'needs_authorization'); assert.equal(result.record.adapter_available, false); assert.equal(result.record.last_successful_sync, null);
  assert.equal((await write('connections.put', { id: 'source_b', provider: 'manual', site_url: 'https://learning.example.edu/' })).record.status, 'manual_import');
  assert.equal((await write('connections.put', { id: 'source_c', provider: 'elc', site_url: 'https://learning.example.edu/', status: 'connected' })).error, 'unknown_field');
});

test('connection URLs reject embedded credentials, query secrets and unsafe schemes', async (t) => {
  const { write } = setup(t);
  for (const site_url of ['https://user:password@example.edu/', 'https://example.edu/?token=secret', 'https://example.edu/#token', 'http://example.edu/', 'file:///tmp/source', 'https://localhost/']) assert.equal((await write('connections.put', { id: 'source_a', provider: 'other', site_url })).ok, false);
});

test('calendar imports report only imported coverage and unknown source freshness', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course());
  await write('connections.put', connection());
  const result = await write('calendar.put', calendar());
  assert.equal(result.ok, true); assert.equal(result.record.live_sync, false); assert.equal(result.record.source_freshness, 'unknown');
  assert.equal(result.record.imported_at, NOW); assert.equal(result.record.coverage.meaning, 'parsed_import_window_only');
  assert.equal((await write('calendar.put', calendar({ coverage: { ...calendar().coverage, mode: 'live_verified' } }), 1)).error, 'invalid_coverage');
});

test('calendar exact raw import retry survives changed server-derived coverage window', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course());
  await write('connections.put', connection());
  const fingerprintData = { id: 'calendar_a', course_id: 'course_a', source_id: 'import_a', ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR' };
  const first = await write('calendar.put', calendar(), 0, 'calendar_save_1', { fingerprintData });
  const changedWindow = calendar({ coverage: { ...calendar().coverage, window_start: '2026-10-01T12:00:00Z' } });
  const replay = await write('calendar.put', changedWindow, 0, 'calendar_save_1', { fingerprintData });
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal((await write('calendar.put', changedWindow, 0, 'calendar_save_1', { fingerprintData: { ...fingerprintData, ics: 'DIFFERENT' } })).error, 'operation_id_conflict');
});

test('pre-parse calendar replay survives a clock shift that now exceeds the import event limit', async (t) => {
  const { write, store, read } = setup(t);
  await write('courses.put', course()); await write('connections.put', connection());
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${Array.from({ length: 501 }, (_, index) => `BEGIN:VEVENT\r\nUID:future-${index}\r\nDTSTART:20270420T120000Z\r\nSUMMARY:Synthetic future event ${index}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
  const raw = { id: 'calendar_a', course_id: 'course_a', source_id: 'import_a', ics };
  const initial = calendarImport(raw, { now: new Date('2026-10-12T12:00:00Z') });
  assert.equal(initial.events.length, 0);
  const saved = await write('calendar.put', initial, 0, 'future_import_1', { fingerprintData: raw });
  assert.equal(saved.ok, true);
  assert.throws(() => calendarImport(raw, { now: new Date('2026-11-05T12:00:00Z') }), { code: 'calendar_event_limit' });
  const replay = await store.dispatch({ tenantId: ALICE, op: 'calendar.replay', data: raw, operationId: 'future_import_1', expectedRevision: 0 });
  assert.deepEqual(replay, { ok: true, found: true, result: { ...saved, replayed: true } });
  assert.equal((await read('account.export')).account_revision, saved.account_revision);
});

test('pre-parse calendar replay validates full input, revision and ownership instead of trusting an operation ID', async (t) => {
  const { write, store, read } = setup(t);
  await write('courses.put', course()); await write('connections.put', connection());
  const raw = { id: 'calendar_a', course_id: 'course_a', source_id: 'import_a', ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR' };
  const saved = await write('calendar.put', calendar(), 0, 'raw_import_1', { fingerprintData: raw });
  const lookup = (data = raw, extra = {}) => store.dispatch({ tenantId: ALICE, op: 'calendar.replay', data, operationId: 'raw_import_1', expectedRevision: 0, ...extra });
  for (const changed of [{ ...raw, id: 'other_calendar' }, { ...raw, source_id: 'other_source' }, { ...raw, course_id: 'other_course' }, { ...raw, ics: raw.ics + '\n' }]) assert.equal((await lookup(changed)).error, 'operation_id_conflict');
  assert.equal((await lookup(raw, { expectedRevision: 1 })).error, 'operation_id_conflict');
  assert.equal((await lookup({ ...raw, tenant_id: BOB })).error, 'unknown_field');
  assert.equal((await lookup(raw, { fingerprintData: raw })).error, 'unexpected_fingerprint');
  assert.equal((await lookup({ ...raw, ics: '界'.repeat(100000) })).error, 'calendar_too_large');
  assert.equal((await lookup(raw, { tenantId: BOB })).error, 'owner_mismatch');
  assert.deepEqual(await lookup(raw, { operationId: 'unknown_import' }), { ok: true, found: false });
  const other = setup(t);
  assert.deepEqual(await other.store.dispatch({ tenantId: BOB, op: 'calendar.replay', data: raw, operationId: 'raw_import_1', expectedRevision: 0 }), { ok: true, found: false });
  assert.equal((await read('account.export')).account_revision, saved.account_revision);
  await write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, saved.account_revision);
  assert.equal((await lookup()).error, 'account_deleted');
});

test('fingerprint overrides are limited to matching calendar imports', async (t) => {
  const { write } = setup(t);
  assert.equal((await write('profile.put', profile, 0, 'profile_save_1', { fingerprintData: {} })).error, 'unexpected_fingerprint');
  assert.equal((await write('calendar.put', calendar(), 0, 'calendar_save_1', { fingerprintData: { id: 'other', course_id: 'course_a', source_id: 'import_a', ics: 'ICS' } })).error, 'fingerprint_identity_mismatch');
});

test('calendar rejects duplicate UIDs, extra freshness fields and backwards ranges', async (t) => {
  const { write } = setup(t);
  assert.equal((await write('calendar.put', calendar({ events: [calendar().events[0], calendar().events[0]] }))).error, 'duplicate_event');
  assert.equal((await write('calendar.put', calendar({ live_sync: true }))).error, 'unknown_field');
  assert.equal((await write('calendar.put', calendar({ events: [{ ...calendar().events[0], end: '2026-01-01T00:00:00Z' }] }))).error, 'invalid_event_range');
});

test('recurring calendar events may share a UID at distinct start times', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course()); await write('connections.put', connection());
  const result = await write('calendar.put', calendar({ events: [calendar().events[0], { ...calendar().events[0], start: '2026-10-20T12:00:00Z' }] }));
  assert.equal(result.ok, true); assert.equal(result.record.events.length, 2);
});

test('calendar source registration is scoped and repeated imports must update the same resource', async (t) => {
  const { write, read } = setup(t);
  await write('courses.put', course());
  assert.equal((await write('calendar.put', calendar())).error, 'connection_not_found');
  await write('connections.put', connection());
  assert.equal((await write('calendar.put', calendar())).ok, true);
  assert.equal((await write('calendar.put', calendar({ id: 'calendar_duplicate' }))).error, 'calendar_source_already_imported');
  assert.equal((await write('calendar.put', calendar({ events: [] }), 1)).ok, true);
  assert.equal((await read('calendar.list')).records.length, 1);
});

test('explanation and self-report cannot be upgraded to measured understanding', async (t) => {
  const { write } = setup(t);
  await write('courses.put', course());
  for (const changes of [{ assistance: 'explanation' }, { evidence: 'learner_report' }, { evidence: 'discussion_only' }]) {
    assert.equal((await write('learning.put', learning({ observations: [observation(changes)] }))).error, 'assessment_requires_observed_response');
  }
  assert.equal((await write('learning.put', learning({ observations: [observation({ outcome: 'unassessed', assistance: 'explanation' })] }))).error, 'explanation_is_not_observed_understanding');
  const result = await write('learning.put', learning({ observations: [observation({ outcome: 'unassessed', assistance: 'explanation', evidence: 'discussion_only' })] }));
  assert.equal(result.ok, true); assert.equal(result.record.assessment.discussion_only_count, 1); assert.equal(result.record.assessment.independent_observed_correct, 0);
});

test('duplicated topics within a session cannot inflate understanding counts', async (t) => {
  const { write } = setup(t);
  assert.equal((await write('learning.put', learning({ observations: [observation(), observation()] }))).error, 'duplicate_topic');
});

test('calendar dates and completeness cannot silently normalize inaccurate source facts', async (t) => {
  const { write } = setup(t);
  for (const start of ['2026-02-31T12:00:00Z', '2026-10-12T24:00:00Z']) assert.equal((await write('calendar.put', calendar({ events: [{ ...calendar().events[0], start }] }))).error, 'invalid_timestamp');
  assert.equal((await write('calendar.put', calendar({ coverage: { ...calendar().coverage, warnings: [{ code: 'unsupported_recurrence', count: 1 }] } }))).error, 'inconsistent_coverage');
});

test('a registered source cannot be relabeled as a different site', async (t) => {
  const { write } = setup(t);
  await write('connections.put', connection());
  assert.equal((await write('connections.put', { ...connection(), site_url: 'https://different.example.edu/' }, 1)).error, 'immutable_identity');
});

test('list filters and explicit continuation never silently drop records', async (t) => {
  const { write, read } = setup(t);
  for (const id of ['course_a', 'course_b', 'course_c']) await write('courses.put', course(id));
  const first = await read('courses.list', { limit: 2 });
  assert.equal(first.complete, false); assert.equal(first.next_cursor, 'course_b');
  const second = await read('courses.list', { limit: 2, cursor: first.next_cursor });
  assert.equal(second.complete, true); assert.equal(second.records[0].id, 'course_c');
});

test('bounded counts, UTF-8 bytes and invalid revisions fail without receipts', async (t) => {
  const { write, read } = setup(t);
  await write('courses.put', course());
  assert.equal((await write('materials.put', { ...material(), text: '🔬'.repeat(40000) }, 0, 'oversize_save_1')).error, 'record_too_large');
  assert.equal((await read('receipt.get', { operation_id: 'oversize_save_1' })).status, 404);
  assert.equal((await write('learning.put', learning({ observations: Array.from({ length: 51 }, () => observation()) }))).error, 'invalid_observations');
  assert.equal((await write('profile.put', profile, -1)).error, 'invalid_revision');
  assert.equal((await write('profile.put', profile, 0, 'tiny')).error, 'invalid_operation_id');
});

test('record quota rejects additional inserts while allowing revision-safe updates', async (t) => {
  const { write } = setup(t);
  for (let i = 0; i < STORE_LIMITS.recordsPerKind; i++) assert.equal((await write('courses.put', course(`course_${i}`))).ok, true);
  assert.equal((await write('courses.put', course('course_over_limit'))).error, 'record_limit_reached');
  assert.equal((await write('courses.put', { ...course('course_0'), title: 'Renamed safely' }, 1)).ok, true);
});

test('profile validates timezone and requires explicit consent version', async (t) => {
  const { write } = setup(t);
  assert.equal((await write('profile.put', { ...profile, timezone: 'Not/AZone' })).error, 'invalid_timezone');
  assert.equal((await write('profile.put', { ...profile, consent_version: '' })).ok, false);
});

test('deletion requires fresh account revision and removes all latest and historical student data', async (t) => {
  const { write, read, database, storage } = setup(t);
  await write('profile.put', profile, 0, 'profile_save_1');
  await write('courses.put', course());
  await write('materials.put', { ...material(), text: 'Secret synthetic draft one.' }, 0, 'material_save_1');
  await write('materials.put', { ...material(), text: 'Secret synthetic draft two.' }, 1, 'material_save_2');
  assert.equal((await write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, 0, 'delete_save_1')).error, 'revision_conflict');
  assert.equal((await write('account.delete', { confirm: 'wrong' }, 4, 'delete_save_1')).error, 'confirmation_required');
  const deletion = await write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, 4, 'delete_save_1');
  assert.equal(deletion.ok, true); assert.equal(deletion.account_revision, 5);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 1);
  assert.equal(JSON.stringify(database.prepare('SELECT * FROM operations').all()).includes('Secret synthetic'), false);
  assert.equal((await read('materials.get', { id: 'material_a' })).status, 410);
  assert.equal((await read('receipt.get', { operation_id: 'material_save_1' })).status, 410);
  assert.equal((await write('profile.put', profile, 0, 'new_profile_1')).status, 410);
  assert.deepEqual((await read('account.export')).data, { profile: null, courses: [], materials: [], progress: [], learning: [], connections: [], calendar: [], google_selection: [] });
  const fresh = new StudentStore(storage);
  const retry = await fresh.dispatch({ tenantId: ALICE, op: 'account.delete', data: { confirm: 'DELETE_MY_WORKSPACE' }, expectedRevision: 4, operationId: 'delete_save_1' });
  assert.deepEqual(retry, { ...deletion, replayed: true });
  assert.deepEqual((await read('receipt.get', { operation_id: 'delete_save_1' })).receipt, deletion.receipt);
});

test('deleting one student does not affect another student workspace', async (t) => {
  const a = setup(t), b = setup(t);
  await a.write('profile.put', profile);
  await b.write('profile.put', { ...profile, display_name: 'Another synthetic student' }, 0, 'other_save_1', { tenantId: BOB });
  await a.write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, 1, 'delete_save_1');
  assert.equal((await b.read('profile.get', {}, BOB)).record.display_name, 'Another synthetic student');
});

test('deletion itself is atomic under storage failure, retaining a recoverable original workspace', async (t) => {
  let failDeletion = false;
  const { write, read } = setup(t, { beforeExec: (query) => { if (failDeletion && query.startsWith('UPDATE workspace_meta SET deleted')) throw new Error('synthetic deletion failure'); } });
  await write('profile.put', profile, 0, 'profile_save_1');
  failDeletion = true;
  assert.equal((await write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, 1, 'delete_save_1')).error, 'storage_unavailable');
  assert.equal((await read('profile.get')).record.display_name, profile.display_name);
  assert.equal((await read('receipt.get', { operation_id: 'profile_save_1' })).ok, true);
  failDeletion = false;
  assert.equal((await write('account.delete', { confirm: 'DELETE_MY_WORKSPACE' }, 1, 'delete_save_1')).ok, true);
});
