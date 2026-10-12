// Exercise browser helpers served by Wrangler's actual deployment artifact.
// The source-only harness cannot catch deployment-introduced helper references.
import assert from 'node:assert/strict';
import { createRuntime } from '../test/runtime-fixture.mjs';

const runtime = await createRuntime({ deploymentBundle: new URL('../dist/index.js', import.meta.url) });
try {
  const loadModule = async path => {
    const response = await runtime.request(path);
    assert.equal(response.status, 200);
    return import('data:text/javascript,' + encodeURIComponent(await response.text()));
  };
  const { createWriteQueue } = await loadModule('/write-intent.js');
  const { decodeTextImport } = await loadModule('/text-import.js');
  assert.equal(decodeTextImport('lecture.vtt', new TextEncoder().encode('Synthetic lecture')), 'Synthetic lecture');
  assert.throws(() => decodeTextImport('notes.txt', new Uint8Array([255])), /UTF-8/);
  const call = async (path, options) => {
    const response = await runtime.request(path, options);
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  const owner = (await call('/api/onboarding')).workspace_id;
  const items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
  const queue = createWriteQueue({ storage, owner });
  const packet = { operation_id: 'compiled-profile-save', expected_revision: 0, display_name: 'Synthetic bundle student', timezone: 'America/New_York', consent_version: 'local-demo-v1' };
  let writes = 0;
  await assert.rejects(queue.run('profile', { owner, path: '/api/onboarding', method: 'PUT' }, () => packet, async body => {
    writes++;
    await call('/api/onboarding', { method: 'PUT', body });
    throw new Error('Synthetic response loss');
  }, () => assert.fail('Lost response should remain pending')), /Synthetic response loss/);
  assert.equal(queue.count(), 1);
  const resumed = createWriteQueue({ storage, owner });
  await resumed.reconcile(() => assert.fail('Confirmed receipt must prevent a second write'), id => call('/api/receipts/' + id));
  assert.equal(resumed.count(), 0);
  assert.equal(items.size, 0);
  assert.equal(writes, 1);
  assert.equal((await call('/api/onboarding')).profile.display_name, packet.display_name);
  assert.equal((await call('/api/onboarding', { student: 'b' })).profile, null);
  console.log('Wrangler deployment artifact passed: executable browser helpers, text validation, save/receipt, response-loss resume, and separate empty student.');
} catch (error) {
  // Data-URL stack traces would dump the complete browser module into CI logs.
  console.error('Deployment artifact check failed:', error.message);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
