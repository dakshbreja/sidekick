import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from 'jose';
import { createRuntime } from './runtime-fixture.mjs';
import { verifyIdentity } from '../src/auth.js';

const packet = (operation, data, revision = 0) => ({ operation_id: operation, expected_revision: revision, ...data });
const course = (student = 'a') => ({ id: 'shared-course-id', code: 'DEMO100', title: `Synthetic ${student} course`, section: student, term_id: 'demo-term' });
const material = (student = 'a') => ({ id: 'shared-material-id', course_id: 'shared-course-id', title: `Synthetic ${student} material`, text: `Only student ${student} can read this synthetic material.`, source_kind: 'manual' });
const observation = (outcome, assistance = 'independent', evidence = 'observed_response') => ({ topic_id: `topic-${outcome}-${assistance}`, outcome, assistance, evidence, next_step: 'Synthetic next step' });
async function json(runtime, path, options, status = 200) {
  const response = await runtime.request(path, options);
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return value;
}

test('actual workerd and SQLite isolate independent signed student workspaces', async (t) => {
  const persistPath = await mkdtemp(join(tmpdir(), 'school-bridge-synthetic-runtime-'));
  let runtime = await createRuntime({ persistPath, inspectStorage: true });
  t.after(async () => { await runtime.close(); await rm(persistPath, { recursive: true, force: true }); });
  const identities = {};
  for (const student of ['a', 'b']) identities[student] = await verifyIdentity(runtime.tokens[student], runtime.authFixture.config, runtime.authFixture.keyResolver);

  await t.test('new signed accounts start empty and expose truthful connector capabilities', async () => {
    for (const student of ['a', 'b']) {
      const result = await json(runtime, '/api/onboarding', { student });
      assert.equal(result.workspace_id, identities[student].tenantId);
      assert.equal(result.profile, null);
      assert.equal(result.profile_revision, 0);
      assert.deepEqual(result.courses, []);
      assert.deepEqual(result.connections, []);
      assert.equal(result.capabilities.elc_sync, false);
      assert.equal(result.capabilities.google_calendar_oauth, false);
      const exported = await json(runtime, '/api/account/export', { student });
      assert.equal(exported.account_revision, 0);
      assert.ok(Object.values(exported.data).every((value) => value === null || value.length === 0));
    }
    assert.notEqual(identities.a.tenantId, identities.b.tenantId);
  });

  await t.test('receipt and export reads reject stale account guards before any receipt lookup', async () => {
    for (const path of ['/api/receipts/synthetic-operation','/api/account/export','/api/onboarding']) {
      const result = await json(runtime,path,{student:'b',headers:{'X-Workspace-Id':identities.a.tenantId}},403);
      assert.equal(result.error,'workspace_changed');
    }
    const exported = await json(runtime,'/api/account/export',{student:'a'});
    assert.equal(exported.workspace_id,identities.a.tenantId);
  });

  await t.test('profiles and identical course IDs remain independent', async () => {
    for (const student of ['a', 'b']) {
      await json(runtime, '/api/onboarding', { student, method: 'PUT', body: packet('profile-save-01', {
        display_name: `Synthetic ${student}`, timezone: 'America/New_York', consent_version: 'local-demo-v1',
      }) });
      await json(runtime, '/api/courses', { student, method: 'PUT', body: packet('course-save-001', course(student)) });
    }
    for (const student of ['a', 'b']) {
      const result = await json(runtime, '/api/onboarding', { student });
      assert.equal(result.profile.display_name, `Synthetic ${student}`);
      assert.equal(result.courses.length, 1);
      assert.equal(result.courses[0].section, student);
      assert.equal(result.courses[0].revision, 1);
    }
  });

  await t.test('material retrieval and metadata do not cross student boundaries', async () => {
    await json(runtime, '/api/materials', { method: 'PUT', body: packet('material-save-a', material('a')) });
    await json(runtime, '/api/materials/shared-material-id', { student: 'b' }, 404);
    await json(runtime, '/api/materials', { student: 'b', method: 'PUT', body: packet('material-save-b', material('b')) });
    for (const student of ['a', 'b']) {
      const result = await json(runtime, '/api/materials/shared-material-id', { student });
      assert.equal(result.record.text, material(student).text);
      const list = await json(runtime, '/api/materials?course_id=shared-course-id', { student });
      assert.equal(list.records.length, 1);
      assert.equal(list.records[0].title, material(student).title);
      assert.equal(Object.hasOwn(list.records[0], 'text'), false);
    }
  });

  await t.test('workspace write guard prevents stale account UI writes and remains optional for API clients', async () => {
    const a = await json(runtime, '/api/onboarding');
    const b = await json(runtime, '/api/onboarding', { student: 'b' });
    assert.notEqual(a.workspace_id, b.workspace_id);
    const profile = (student) => ({ display_name: `Synthetic ${student}`, timezone: 'America/New_York', consent_version: 'local-demo-v1' });
    const valid = await json(runtime, '/api/onboarding', { method: 'PUT', headers: { 'X-Workspace-Id': a.workspace_id },
      body: packet('workspace-match-a', profile('a'), a.profile_revision) });
    assert.equal(valid.revision, a.profile_revision + 1);
    const bBefore = await json(runtime, '/api/account/export', { student: 'b' });
    const stale = await json(runtime, '/api/onboarding', { student: 'b', method: 'PUT', headers: { 'X-Workspace-Id': a.workspace_id },
      body: packet('workspace-stale-b', { ...profile('b'), display_name: 'Stale A screen must not write B' }, b.profile_revision) }, 403);
    assert.equal(stale.error, 'workspace_changed');
    const bAfter = await json(runtime, '/api/account/export', { student: 'b' });
    assert.equal(bAfter.account_revision, bBefore.account_revision);
    assert.deepEqual(bAfter.data, bBefore.data);
    await json(runtime, '/api/receipts/workspace-stale-b', { student: 'b' }, 404);
    const absent = await json(runtime, '/api/onboarding', { student: 'b', method: 'PUT',
      body: packet('workspace-no-header-b', profile('b'), b.profile_revision) });
    assert.equal(absent.revision, b.profile_revision + 1);
    assert.equal(absent.record.display_name, 'Synthetic b');
  });

  await t.test('tenant selectors in queries, bodies and forwarded headers cannot select another student', async () => {
    for (const query of ['tenantId', 'tenant_id', 'student_id', 'owner', 'user_id']) {
      await json(runtime, `/api/courses?${query}=${identities.b.tenantId}`, {}, 400);
    }
    for (const field of ['tenantId', 'tenant_id', 'student_id', 'owner', 'user_id']) {
      await json(runtime, '/api/courses', { method: 'PUT', body: packet(`hostile-${field.replaceAll('_', '-')}`, {
        ...course('a'), [field]: identities.b.tenantId,
      }, 1) }, 400);
    }
    const result = await json(runtime, '/api/onboarding', { headers: {
      'X-Tenant-ID': identities.b.tenantId, 'X-User-ID': identities.b.subject,
      'Cf-Access-Authenticated-User-Email': 'student-b@example.invalid',
    } });
    assert.equal(result.profile.display_name, 'Synthetic a');
    const fake = await runtime.authFixture.signToken({}, {}, (await generateKeyPair('RS256')).privateKey);
    await json(runtime, '/api/onboarding', { headers: { 'Cf-Access-Jwt-Assertion': fake } }, 401);
    await json(runtime, '/api/onboarding', { student: null, headers: { 'X-Tenant-ID': identities.b.tenantId } }, 401);
    await json(runtime, '/api/onboarding', { headers: { 'Cf-Access-Jwt-Assertion': 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9.' } }, 401);
  });

  await t.test('cross-origin writes reject before changing storage', async () => {
    await json(runtime, '/api/onboarding', { method: 'PUT', headers: { origin: 'https://attacker.example.invalid' },
      body: packet('cross-origin-01', { display_name: 'Attacker', timezone: 'UTC', consent_version: 'demo' }, 1) }, 403);
    await json(runtime, '/api/onboarding', { method: 'PUT', headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: packet('cross-origin-02', { display_name: 'Attacker', timezone: 'UTC', consent_version: 'demo' }, 1) }, 403);
    assert.equal((await json(runtime, '/api/onboarding')).profile.display_name, 'Synthetic a');
  });

  await t.test('receipts and exact retries are scoped to one student and preserve original revision', async () => {
    const original = await json(runtime, '/api/receipts/material-save-a');
    await json(runtime, '/api/receipts/material-save-a', { student: 'b' }, 404);
    const retry = await json(runtime, '/api/materials', { method: 'PUT', body: packet('material-save-a', material('a')) });
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.receipt, original.receipt);
    assert.equal(retry.revision, 1);
    const conflict = await json(runtime, '/api/materials', { method: 'PUT', body: packet('material-save-a', { ...material('a'), text: 'changed payload' }) }, 409);
    assert.equal(conflict.error, 'operation_id_conflict');
    const stale = await json(runtime, '/api/materials', { method: 'PUT', body: packet('material-stale-1', material('a')) }, 409);
    assert.equal(stale.error, 'revision_conflict');
    assert.equal((await json(runtime, '/api/materials/shared-material-id')).revision, 1);
  });

  await t.test('concurrent creates and revisions are atomic in actual SQLite', async () => {
    const bodies = ['one', 'two'].map((suffix) => packet(`concurrent-${suffix}`, { ...material('a'), id: 'concurrent-material', text: suffix }));
    const results = await Promise.all(bodies.map((body) => runtime.request('/api/materials', { method: 'PUT', body })));
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    const parsed = await Promise.all(results.map((response) => response.json()));
    assert.equal(parsed.find((result) => result.ok).revision, 1);
    assert.equal(parsed.find((result) => !result.ok).error, 'revision_conflict');
    assert.equal((await json(runtime, '/api/materials/concurrent-material')).revision, 1);
    await json(runtime, '/api/materials/concurrent-material', { student: 'b' }, 404);
  });

  await t.test('reported coursework, submission checks and identical IDs remain independent', async () => {
    const common = { id: 'same-progress', course_id: 'shared-course-id', assignment_id: 'same-assignment', title: 'Synthetic task', note: 'Synthetic learner report.' };
    await json(runtime, '/api/progress', { method: 'PUT', body: packet('progress-done-a', {
      ...common, status: 'done', submitted: true, verification: 'reported',
    }) });
    await json(runtime, '/api/progress', { student: 'b', method: 'PUT', body: packet('progress-draft-b', {
      ...common, status: 'in_progress', submitted: false, verification: 'unknown',
    }) });
    assert.equal((await json(runtime, '/api/progress')).records[0].status, 'done');
    assert.equal((await json(runtime, '/api/progress', { student: 'b' })).records[0].status, 'in_progress');
    await json(runtime, '/api/progress', { method: 'PUT', body: packet('progress-invalid', {
      ...common, status: 'done', submitted: false, verification: 'reported',
    }, 1) }, 400);
    await json(runtime, '/api/progress', { method: 'PUT', body: packet('progress-verified', {
      ...common, status: 'done', submitted: true, verification: 'verified',
    }, 1) }, 400);
  });

  await t.test('fresh learning reads isolate saved handoffs and do not count wrong, partial or reported answers as independent understanding', async () => {
    await json(runtime, '/api/learning', { method: 'PUT', body: packet('learning-save-a', {
      course_id: 'shared-course-id', session_id: 'same-session', resume: 'Synthetic A should practice the incorrect topic.',
      observations: [observation('incorrect'), observation('partial'), observation('correct', 'hints'), observation('unassessed', 'independent', 'learner_report')],
    }) });
    const emptyB = await json(runtime, '/api/learning?course_id=shared-course-id', { student: 'b' });
    assert.equal(emptyB.record, null);
    await json(runtime, '/api/learning', { student: 'b', method: 'PUT', body: packet('learning-save-b', {
      course_id: 'shared-course-id', session_id: 'same-session', resume: 'Synthetic B has a different handoff.', observations: [observation('correct')],
    }) });
    const a = await json(runtime, '/api/learning?course_id=shared-course-id&session_id=same-session');
    const b = await json(runtime, '/api/learning?course_id=shared-course-id&session_id=same-session', { student: 'b' });
    assert.equal(a.course_summary.independent_observed_correct, 0);
    assert.equal(a.course_summary.assisted_observed_correct, 1);
    assert.equal(a.course_summary.observed_incorrect, 1);
    assert.equal(a.course_summary.observed_partial, 1);
    assert.equal(a.course_summary.learner_report_count, 1);
    assert.equal(b.course_summary.independent_observed_correct, 1);
    assert.match(a.record.resume, /Synthetic A/);
    assert.match(b.record.resume, /Synthetic B/);
    assert.equal(a.resume_scope, 'saved_handoffs_only');
  });

  await t.test('registered sites remain authorization-required and cannot carry tokens or credentials', async () => {
    for (const student of ['a', 'b']) {
      const result = await json(runtime, '/api/connections', { student, method: 'PUT', body: packet('connection-save', {
        id: 'same-source', provider: 'google_calendar', site_url: `https://calendar-${student}.example.invalid/`,
      }) });
      assert.equal(result.record.status, 'needs_authorization');
      assert.equal(result.record.adapter_available, false);
      assert.equal(result.record.last_successful_sync, null);
    }
    await json(runtime, '/api/connections', { method: 'PUT', body: packet('connection-secret', {
      id: 'bad-source', provider: 'other', site_url: 'https://example.invalid/?token=synthetic',
    }) }, 400);
    await json(runtime, '/api/connections', { method: 'PUT', body: packet('connection-spoof', {
      id: 'bad-source', provider: 'other', site_url: 'https://example.invalid/', status: 'connected', access_token: crypto.randomUUID(),
    }) }, 400);
    assert.equal((await json(runtime, '/api/connections')).records[0].site_url, 'https://calendar-a.example.invalid/');
  });

  await t.test('calendar ICS import is isolated, reports import-only coverage and exact retries retain their receipt', async () => {
    const start = new Date(Date.now() + 2 * 86400000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const end = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Synthetic private exam A\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const body = packet('calendar-import-a', { id: 'same-calendar', course_id: 'shared-course-id', source_id: 'same-source', ics });
    const first = await json(runtime, '/api/calendar/import', { method: 'POST', body });
    assert.equal(first.record.events.length, 1);
    assert.equal(first.record.events[0].title, 'Synthetic private exam A');
    assert.equal(first.record.live_sync, false);
    assert.equal(first.record.source_freshness, 'unknown');
    assert.equal(first.record.coverage.mode, 'imported_only');
    await new Promise((resolve) => setTimeout(resolve, 25));
    const replay = await json(runtime, '/api/calendar/import', { method: 'POST', body });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.deepEqual(replay.record, first.record);
    assert.deepEqual((await json(runtime, '/api/calendar', { student: 'b' })).records, []);
    await json(runtime, '/api/calendar/import', { student: 'b', method: 'POST', body: {
      ...body, ics: ics.replace('private exam A', 'private exam B'),
    } });
    assert.equal((await json(runtime, '/api/calendar', { student: 'b' })).records[0].events[0].title, 'Synthetic private exam B');
    await json(runtime, '/api/calendar/import', { method: 'POST', body: { ...body, tenantId: identities.b.tenantId } }, 400);
  });

  await t.test('permanent DO owner binding rejects incorrectly routed internal calls', async () => {
    const namespace = await runtime.mf.getDurableObjectNamespace('STUDENTS');
    const stub = namespace.getByName(`student-v1:${identities.a.tenantId}`);
    const result = await stub.dispatch({ tenantId: identities.b.tenantId, op: 'account.export', data: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'owner_mismatch');
    assert.equal(result.status, 403);
  });

  await t.test('SQLite records and receipts survive full workerd restart with separate ownership', async () => {
    const before = {};
    for (const student of ['a', 'b']) before[student] = (await json(runtime, '/api/account/export', { student })).data;
    const authFixture = runtime.authFixture;
    await runtime.close();
    runtime = await createRuntime({ persistPath, authFixture, inspectStorage: true });
    for (const student of ['a', 'b']) {
      assert.deepEqual((await json(runtime, '/api/account/export', { student })).data, before[student]);
      const fresh = await json(runtime, '/api/learning?course_id=shared-course-id', { student });
      assert.match(fresh.record.resume, student === 'a' ? /Synthetic A/ : /Synthetic B/);
    }
    assert.equal((await json(runtime, '/api/receipts/material-save-a')).receipt.operation_id, 'material-save-a');
    await json(runtime, '/api/receipts/material-save-a', { student: 'b' }, 404);
  });

  await t.test('account deletion removes student content and historical receipts while preserving the other account', async () => {
    const bBefore = (await json(runtime, '/api/account/export', { student: 'b' })).data;
    const aBefore = await json(runtime, '/api/account/export');
    const body = packet('delete-student-a', { confirm: 'DELETE_MY_WORKSPACE' }, aBefore.account_revision);
    const deleted = await json(runtime, '/api/account', { method: 'DELETE', body });
    assert.equal(deleted.deleted, true);
    const retry = await json(runtime, '/api/account', { method: 'DELETE', body });
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.receipt, deleted.receipt);
    const empty = await json(runtime, '/api/account/export');
    assert.equal(empty.deleted, true);
    assert.ok(Object.values(empty.data).every((value) => value === null || value.length === 0));
    await json(runtime, '/api/receipts/material-save-a', {}, 410);
    assert.deepEqual((await json(runtime, '/api/receipts/delete-student-a')).receipt, deleted.receipt);
    await json(runtime, '/api/materials', { method: 'PUT', body: packet('after-delete-new', material('a')) }, 410);
    assert.deepEqual((await json(runtime, '/api/account/export', { student: 'b' })).data, bBefore);
    const storage = await runtime.mf.unsafeGetDurableObjectStorage(runtime.workerName, 'StudentState', { name: `student-v1:${identities.a.tenantId}` });
    assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM records'))[0].n, 0);
    assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM operations'))[0].n, 1);
    assert.equal((await storage.exec('SELECT deleted FROM workspace_meta'))[0].deleted, 1);
  });

  await t.test('all intercepted Worker egress was the pinned synthetic JWKS endpoint', async () => {
    assert.ok(runtime.outboundRequests.length > 0);
    assert.ok(runtime.outboundRequests.every((request) => request.method === 'GET' && request.url === `${runtime.authFixture.config.issuer}/cdn-cgi/access/certs`));
  });
});
