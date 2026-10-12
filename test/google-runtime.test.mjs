// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

test('Google transport and credential encryption execute in real workerd without live Google access', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = (await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    import {createGoogleCalendarClient} from './src/google-calendar.js';
    import {sealCredential,openCredential} from './src/credential-envelope.js';
    import {base64url} from 'jose';
    export default {async fetch() {
      const binding={tenantId:'synthetic_student_a',connectionId:'google_a',generation:1,purpose:'google_tokens'};
      const secret=base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
      const sealed=await sealCredential(secret,binding,{access_token:'example-token'});
      const opened=await openCredential(secret,binding,sealed);
      let foreignRejected=false;
      try {await openCredential(secret,{...binding,tenantId:'synthetic_student_b'},sealed);} catch(e) {foreignRejected=e.code==='credential_envelope_invalid';}
      const page=await createGoogleCalendarClient().eventsPage({accessToken:opened.access_token,calendarId:'synthetic-calendar'});
      return Response.json({foreignRejected,complete:page.collection_complete,next:page.next_sync_token,events:page.items.length});
    }};
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text;
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'community-google-contract', modules: true, script,
    compatibilityDate: '2026-10-12', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, cf: false,
    unsafeDevRegistryPath: undefined, unsafeRegisterWorker: false, log: new Log(LogLevel.ERROR),
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://www.googleapis.com');
      assert.equal(url.pathname, '/calendar/v3/calendars/synthetic-calendar/events');
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.get('Authorization'), 'Bearer example-token');
      requests.push(url.pathname);
      return Response.json({ items: [], nextSyncToken: 'synthetic-next-sync', timeZone: 'UTC' });
    },
  }));
  t.after(() => mf.dispose());
  await mf.ready;
  const result = await mf.dispatchFetch('https://synthetic.invalid/');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { foreignRejected: true, complete: true, next: 'synthetic-next-sync', events: 0 });
  assert.equal(requests.length, 1);
});
