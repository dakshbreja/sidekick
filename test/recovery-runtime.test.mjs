// Copyright 2026 Daksh Breja. All rights reserved.
// Synthetic, quiesced local snapshots only; never accepts a real store or key.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntime} from './runtime-fixture.mjs';

test('clean-directory recovery preserves two owners and exposes the old-backup deletion hazard', async t => {
  const root = await mkdtemp(join(tmpdir(), 'community-synthetic-restore-'));
  const original = join(root, 'original'), oldBackup = join(root, 'before-deletion');
  const safeBackup = join(root, 'after-deletion'), restored = join(root, 'restored');
  let runtime = await createRuntime({persistPath: original});
  const authFixture = runtime.authFixture;
  t.after(async () => { await runtime.close(); await rm(root, {recursive:true, force:true}); });
  const request = async (path, options = {}, status = 200) => {
    const response = await runtime.request(path, options), body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
  const owners = {}, receipts = {}, packets = {};
  await t.test('create two empty signed owners with identical resource and operation IDs', async () => {
    for (const student of ['a', 'b']) {
      const empty = await request('/api/account/export', {student});
      assert.equal(empty.data.profile, null);
      assert.deepEqual(empty.data.courses, []);
      owners[student] = empty.workspace_id;
      await request('/api/courses', {student, method:'PUT', body:{
        operation_id:'restore-course', expected_revision:0, id:'shared-course',
        code:'SYN 101', title:'Synthetic recovery course', section:student, term_id:'synthetic-term',
      }});
      packets[student] = {operation_id:'restore-material', expected_revision:0, id:'shared-material',
        course_id:'shared-course', title:'Synthetic recovery '+student, text:'Only synthetic owner '+student,
        source_kind:'manual'};
      receipts[student] = (await request('/api/materials', {student, method:'PUT', body:packets[student]})).receipt;
    }
    assert.notEqual(owners.a, owners.b);
    assert.notEqual(receipts.a.request_hash, receipts.b.request_hash);
  });
  await runtime.close();
  // Copy only after workerd is disposed, never an inconsistent live SQLite/WAL.
  await cp(original, oldBackup, {recursive:true, errorOnExist:true, force:false});
  runtime = await createRuntime({persistPath:original, authFixture});
  const aBefore = await request('/api/account/export');
  const deletionPacket = {operation_id:'restore-delete-a', expected_revision:aBefore.account_revision, confirm:'DELETE_MY_WORKSPACE'};
  const deleted = await request('/api/account', {method:'DELETE', body:deletionPacket});
  const bBefore = await request('/api/account/export', {student:'b'});
  await runtime.close();
  await cp(original, safeBackup, {recursive:true, errorOnExist:true, force:false});
  await assert.rejects(access(restored), {code:'ENOENT'});
  await cp(safeBackup, restored, {recursive:true, errorOnExist:true, force:false});
  runtime = await createRuntime({persistPath:restored, authFixture});
  await t.test('restore into a new directory keeps deleted A retired and B records and receipts intact', async () => {
    const a = await request('/api/account/export');
    assert.equal(a.workspace_id, owners.a);
    assert.equal(a.deleted, true);
    assert.ok(Object.values(a.data).every(v => v === null || v.length === 0));
    const replay = await request('/api/account', {method:'DELETE', body:deletionPacket});
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, deleted.receipt);
    await request('/api/materials/shared-material', {}, 410);
    await request('/api/receipts/restore-material', {}, 410);
    await request('/api/materials', {method:'PUT', body:packets.a}, 410);
    const b = await request('/api/account/export', {student:'b'});
    assert.equal(b.workspace_id, owners.b);
    assert.equal(b.account_revision, bBefore.account_revision);
    assert.deepEqual(b.data, bBefore.data);
    const retry = await request('/api/materials', {student:'b', method:'PUT', body:packets.b});
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.receipt, receipts.b);
    assert.deepEqual((await request('/api/account/export', {student:'b'})).data, bBefore.data);
    await request('/api/receipts/restore-delete-a', {student:'b'}, 404);
    await request('/api/materials/shared-material', {student:'b', headers:{'X-Workspace-Id':owners.a}}, 403);
    assert.ok(runtime.outboundRequests.every(r => r.url === authFixture.config.issuer+'/cdn-cgi/access/certs'));
  });
  await runtime.close();
  const unsafeRestore = join(root, 'isolated-old-snapshot');
  await cp(oldBackup, unsafeRestore, {recursive:true, errorOnExist:true, force:false});
  runtime = await createRuntime({persistPath:unsafeRestore, authFixture});
  await t.test('negative control: a pre-deletion snapshot alone resurrects content and must never reopen to users', async () => {
    const old = await request('/api/account/export');
    assert.notEqual(old.deleted, true);
    assert.equal(old.data.materials[0].text, packets.a.text);
    await request('/api/receipts/restore-delete-a', {}, 404);
    // Stop here: production recovery must fence later deletions from an
    // independently retained ledger before serving any restored workspace.
  });
});
