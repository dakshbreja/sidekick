import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanRepository } from '../scripts/privacy-scan.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bridge-privacy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('copyright, synthetic labels, public JWK and example secrets are acceptable', () => {
  const text = 'Copyright 2026 Daksh Breja. All rights reserved.\nStudent A, SYN101, synthetic.\n' + JSON.stringify({ kty: 'RSA', n: 'test-public-modulus', e: 'AQAB', client_secret: '<your-secret>' });
  assert.deepEqual(scanText(text), []);
});

test('provider keys, private key blocks, OAuth values and encoded identity tokens fail', () => {
  const samples = [
    ['sk-' + 'a'.repeat(32), 'provider-secret'],
    ['-----BEGIN ' + 'PRIVATE KEY-----', 'private-key'],
    [JSON.stringify({ ['refresh' + '_token']: 'synthetic-but-not-a-placeholder' }), 'secret-assignment'],
    ['PROVIDER_SECRET=' + 'synthetic-secret-value', 'secret-assignment'],
    ['Bearer ' + 'z'.repeat(32), 'bearer-credential'],
    ['1234567890-' + 'a'.repeat(24) + '.apps.googleusercontent.com', 'personal-oauth-client'],
    ['eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20), 'encoded-identity-token'],
  ];
  for (const [value, rule] of samples) assert.ok(scanText(value).includes(rule));
});

test('personal paths, cloud hosts and source identifiers fail without using real accounts', () => {
  const samples = [
    ['/Users' + '/SyntheticPerson/project', 'personal-filesystem-path'],
    ['https://synthetic-app.synthetic-owner.' + 'workers.dev', 'live-worker-host'],
    ['g-' + 'a'.repeat(32), 'personal-gpt-id'],
    ['https://drive.google.com/drive/folders/' + 'a'.repeat(24), 'personal-google-source'],
  ];
  for (const [value, rule] of samples) assert.ok(scanText(value).includes(rule));
});

test('external private-reference denylist catches identifiers and does not return values', () => {
  const secret = ['private', 'synthetic', 'source', 'identifier'].join('-');
  const result = scanText('reference=' + secret, [secret]);
  assert.deepEqual(result, ['private-reference']);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('clean candidates, lockfile and generated environment declarations pass', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  await writeFile(join(root, 'worker-configuration.d.ts'), 'interface Env { STUDENTS: DurableObjectNamespace; }');
  await writeFile(join(root, '.dev.vars.example'), 'AUTH_AUDIENCE=replace-me\n');
  const report = await scanRepository(root);
  assert.equal(report.ok, true);
  assert.equal(report.scanned_files, 3);
});

test('private config, logs and binaries fail and never emit their content', async t => {
  const root = await fixture(t);
  const sensitive = ['synthetic', 'private', 'content'].join('-');
  await writeFile(join(root, '.env'), sensitive);
  await writeFile(join(root, 'debug.log'), sensitive);
  await writeFile(join(root, 'course.pdf'), sensitive);
  await writeFile(join(root, 'unknown.bin'), Buffer.from([0xff, 0x00]));
  const report = await scanRepository(root);
  assert.equal(report.ok, false);
  assert.equal(report.findings.length, 4);
  assert.ok(!JSON.stringify(report).includes(sensitive));
});

test('symlinks fail without reading or following their targets', async t => {
  const root = await fixture(t);
  await symlink(join(root, 'missing-target'), join(root, 'linked.txt'));
  const report = await scanRepository(root);
  assert.deepEqual(report.findings, [{ file: 'linked.txt', rules: ['symlink-not-exportable'] }]);
});

test('ignored generated dependencies are skipped unless tracked by Git', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'debug.log'), 'synthetic generated log');
  assert.equal((await scanRepository(root)).ok, true);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'dist/debug.log']);
  const report = await scanRepository(root);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0].file, 'dist/debug.log');
});

test('private identifiers in filenames are redacted in diagnostics', async t => {
  const root = await fixture(t);
  const filename = 'g-' + 'b'.repeat(32) + '.txt';
  await writeFile(join(root, filename), 'synthetic');
  const report = await scanRepository(root);
  assert.equal(report.findings[0].file, '[redacted filename]');
  assert.ok(!JSON.stringify(report).includes(filename));
});

test('privacy rules do not let an acceptable placeholder suppress another secret', () => {
  const text = JSON.stringify({ client_secret: '<your-secret>', ['access' + '_token']: 'synthetic-actual-value' });
  assert.deepEqual(scanText(text), ['secret-assignment']);
});

test('CLI refuses a denylist inside the scanned repository regardless of option order', async t => {
  const root = await fixture(t);
  const file = join(root, 'private-references.json');
  await writeFile(file, JSON.stringify(['synthetic-private-reference']));
  const scanner = fileURLToPath(new URL('../scripts/privacy-scan.mjs', import.meta.url));
  for (const options of [['--root', root, '--denylist', file], ['--denylist', file, '--root', root]]) {
    const result = spawnSync(process.execPath, [scanner, ...options], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.ok(!result.stdout.includes('synthetic-private-reference'));
    assert.ok(!result.stderr.includes(file));
  }
});
