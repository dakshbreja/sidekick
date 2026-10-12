// Synthetic regression for an import whose parsing window changes on retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime-fixture.mjs';
import { verifyIdentity } from '../src/auth.js';
import { calendarImport } from '../src/calendar-import.js';

test('actual calendar HTTP retries verify the original request before time-dependent parsing', async (t) => {
  const runtime = await createRuntime();
  t.after(() => runtime.close());
  const packet = (operation_id, data, expected_revision = 0) => ({ operation_id, expected_revision, ...data });
  const request = async (path, body, status = 200, student = 'a', method = 'POST') => {
    const response = await runtime.request(path, { student, method, ...(body === undefined ? {} : { body }) });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  await request('/api/courses', packet('replay_course_1', { id: 'course_a', code: 'SYN101', title: 'Synthetic Course', section: 'A', term_id: 'synthetic_term' }), 200, 'a', 'PUT');
  await request('/api/connections', packet('replay_source_1', { id: 'source_a', provider: 'manual', site_url: 'https://calendar.example.invalid/' }), 200, 'a', 'PUT');

  // Seed a real stored receipt from an earlier parse window, then use the
  // production HTTP route with the current clock. No production clock hook.
  const now = new Date();
  const eventDate = new Date(+now + 170 * 86400000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const raw = { id: 'calendar_a', course_id: 'course_a', source_id: 'source_a',
    ics: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${Array.from({ length: 501 }, (_, index) => `BEGIN:VEVENT\r\nUID:future-${index}\r\nDTSTART:${eventDate}\r\nSUMMARY:Synthetic future event ${index}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n` };
  const earlier = calendarImport(raw, { now: new Date(+now - 90 * 86400000) });
  assert.equal(earlier.events.length, 0);
  assert.throws(() => calendarImport(raw, { now }), { code: 'calendar_event_limit' });
  const identity = await verifyIdentity(runtime.tokens.a, runtime.authFixture.config, runtime.authFixture.keyResolver);
  const namespace = await runtime.mf.getDurableObjectNamespace('STUDENTS');
  const stub = namespace.getByName('student-v1:' + identity.tenantId);
  const saved = await stub.dispatch({ tenantId: identity.tenantId, op: 'calendar.put', data: earlier, operationId: 'future_import_1', expectedRevision: 0, fingerprintData: raw });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const body = packet('future_import_1', raw);

  const replay = await request('/api/calendar/import', body);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, saved.record);
  assert.deepEqual(replay.receipt, saved.receipt);
  assert.equal(replay.account_revision, saved.account_revision);

  const conflict = await request('/api/calendar/import', { ...body, ics: raw.ics.replace('event 0', 'event changed') }, 409);
  assert.equal(conflict.error, 'operation_id_conflict');
  assert.equal((await request('/api/calendar/import', { ...body, expected_revision: 1 }, 409)).error, 'operation_id_conflict');
  assert.equal((await request('/api/calendar/import', { ...body, tenant_id: 'guessed_other_student' }, 400)).error, 'unknown_field');
  assert.equal((await request('/api/calendar/import', { ...body, operation_id: 'future_import_2' }, 413)).error, 'calendar_event_limit');
  assert.equal((await request('/api/calendar/import', body, 413, 'b')).error, 'calendar_event_limit');
  const unchanged = await request('/api/account/export', undefined, 200, 'a', 'GET');
  assert.equal(unchanged.account_revision, saved.account_revision);
  assert.deepEqual(unchanged.data.calendar, [saved.record]);
  assert.deepEqual((await request('/api/calendar', undefined, 200, 'b', 'GET')).records, []);
});
