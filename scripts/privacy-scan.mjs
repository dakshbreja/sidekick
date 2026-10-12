#!/usr/bin/env node
// Conservative source-export gate. Findings contain rule names, never matches.
import { readdir, readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED = new Set(['.git', 'node_modules', '.wrangler', '.miniflare', 'coverage', 'dist']);
const BINARY_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.xlsm', '.zip', '.gz', '.tar', '.mp3', '.mp4', '.mov', '.m4a', '.wav', '.png', '.jpg', '.jpeg', '.webp', '.sqlite', '.sqlite3', '.db', '.pem', '.p12', '.pfx']);
const PRIVATE_NAMES = /(?:^|\/)(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|credentials[^/]*|token\.json|tokens\.json|\.manifest\.json|\.pending-[^/]+|.*\.log|.*\.jsonl|.*\.har|.*\.crdownload)$/i;
const EXAMPLE_NAMES = new Set(['.env.example', '.dev.vars.example']);
const PERSONAL_PATH = /(?:\/Users\/[^\s/'"<>]+|\/home\/[^\s/'"<>]+|[A-Za-z]:\\Users\\[^\s\\'"<>]+)/;
const CLOUD_HOST = /\b(?:[a-z0-9-]+\.)+workers\.dev\b/i;
const GPT_ID = /\bg-[a-f0-9]{32}\b/i;
const GOOGLE_SOURCE = /https?:\/\/(?:drive|docs)\.google\.com\/(?:[^\s"'<>]*\/)?(?:folders|d)\/[A-Za-z0-9_-]{16,}/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/;
const KNOWN_SECRET = /\b(?:sk-(?:proj-|ant-api\d*-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|ya29\.[A-Za-z0-9_-]{20,})\b/;
const BEARER_LITERAL = /\bBearer\s+[A-Za-z0-9_.~+\/-]{16,}/;
const OAUTH_CLIENT = /\b\d{8,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com\b/i;
const JWT = /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/;
const SECRET_ASSIGNMENT = /(?:["']?(?:access_token|refresh_token|client_secret|api_key|private_key)["']?)\s*[:=]\s*["']([^"'\r\n]+)["']/gi;
const ENV_SECRET = /^(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*=\s*([^\r\n]+)$/gm;
const PLACEHOLDER = /^(?:|change[-_ ]?me|replace[-_ ].*|your[-_ ].*|example(?:[-_ ].*)?|placeholder|not[-_ ]configured|<[^>]+>|\$\{[^}]+\})$/i;

export function scanText(text, denylist = []) {
  const rules = new Set();
  for (const [name, pattern] of [['personal-filesystem-path', PERSONAL_PATH], ['live-worker-host', CLOUD_HOST], ['personal-gpt-id', GPT_ID], ['personal-google-source', GOOGLE_SOURCE], ['private-key', PRIVATE_KEY], ['provider-secret', KNOWN_SECRET], ['bearer-credential', BEARER_LITERAL], ['personal-oauth-client', OAUTH_CLIENT], ['encoded-identity-token', JWT]]) {
    if (pattern.test(text)) rules.add(name);
  }
  for (const pattern of [SECRET_ASSIGNMENT, ENV_SECRET]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (!PLACEHOLDER.test(value)) rules.add('secret-assignment');
    }
  }
  if (denylist.some(value => text.includes(value))) rules.add('private-reference');
  return [...rules].sort();
}

function safeRelative(root, path) {
  const result = relative(root, path);
  if (!result || result === '..' || result.startsWith('..' + sep) || isAbsolute(result)) throw new Error('candidate_outside_root');
  return result.split(sep).join('/');
}

async function walk(root, directory, files) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory() && GENERATED.has(item.name)) continue;
    if (item.isDirectory()) await walk(root, path, files);
    else files.add(safeRelative(root, path));
  }
}

function trackedFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch { return []; } // A clean pre-Git directory is also a valid scan target.
}

export async function scanRepository(root, { denylist = [] } = {}) {
  root = resolve(root);
  const files = new Set();
  await walk(root, root, files);
  for (const file of trackedFiles(root)) files.add(safeRelative(root, resolve(root, file)));
  const findings = [];
  let scanned = 0;
  for (const file of [...files].sort()) {
    const fileRules = new Set(scanText(file, denylist));
    // Filenames can themselves contain private IDs. Do not echo those values.
    const label = fileRules.size ? '[redacted filename]' : file;
    const path = resolve(root, file);
    let info;
    try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) fileRules.add('symlink-not-exportable');
    else if (!info.isFile()) fileRules.add('non-regular-file');
    else {
      scanned++;
      if (PRIVATE_NAMES.test(file) && !EXAMPLE_NAMES.has(basename(file))) fileRules.add('private-artifact-name');
      if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) fileRules.add('binary-or-source-artifact');
      if (info.size > 8 * 1024 * 1024) fileRules.add('oversize-unreviewed-file');
      else {
        const bytes = await readFile(path);
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (text.includes('\0')) fileRules.add('binary-content');
          for (const rule of scanText(text, denylist)) fileRules.add(rule);
        } catch { fileRules.add('binary-content'); }
      }
    }
    if (fileRules.size) findings.push({ file: label, rules: [...fileRules].sort() });
  }
  return { ok: findings.length === 0, scanned_files: scanned, findings };
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let denylist = [];
  let denylistPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = args[++i];
    else if (args[i] === '--denylist' && args[i + 1]) denylistPath = resolve(args[++i]);
    else throw new Error('usage: privacy-scan.mjs [--root directory] [--denylist external-json-file]');
  }
  if (denylistPath) {
    // Validate after all arguments, so changing option order cannot admit a
    // private reference list inside the target source tree.
    const rel = relative(resolve(root), denylistPath);
    if (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) throw new Error('denylist_must_be_outside_repository');
    denylist = JSON.parse(await readFile(denylistPath, 'utf8'));
    if (!Array.isArray(denylist) || denylist.some(value => typeof value !== 'string' || value.length < 6)) throw new Error('invalid_denylist');
  }
  const report = await scanRepository(root, { denylist });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Privacy scan failed; no matched values are printed.\n'); process.exitCode = 2; });
}
