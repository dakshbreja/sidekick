// Copyright 2026 Daksh Breja. All rights reserved.
// Local synthetic checks only. This command never targets a hosted service.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if (process.argv.length !== 2) throw new Error('Pilot smoke accepts no host, credentials or additional arguments.');
const suites = [
  'test/runtime.test.mjs',
  'test/recovery-runtime.test.mjs',
  'test/connector-oauth.test.mjs',
  'test/outbox.test.mjs',
  'test/google-state-runtime.test.mjs',
  'test/google-collection-runtime.test.mjs',
  'test/google-revocation.test.mjs',
  'test/school-feed-runtime.test.mjs',
  'test/tutor.test.mjs',
];
console.log('Two-student pilot smoke: generated identities, disposable SQLite, intercepted provider responses. No live AI/provider calls.');
const child = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...suites], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', env: process.env,
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
console.log(JSON.stringify({
  synthetic_smoke: child.status === 0 ? 'passed' : 'failed',
  suites: suites.length,
  external_gates_verified: false,
  student_admission_authorized: false,
  checklist: 'docs/PILOT-CHECKLIST.md',
}, null, 2));
