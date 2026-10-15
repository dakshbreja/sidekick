// Copyright 2026 Daksh Breja. All rights reserved.
// Test-only internal RPC harness: it deliberately exposes synthetic fixtures.
// None of this routing is imported by the website Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64url } from 'jose';

const root = fileURLToPath(new URL('../', import.meta.url));
const syntheticWorker = `
  import {DurableObject} from 'cloudflare:workers';
  import {StudentStore} from './src/store.js';
  import {GoogleConnectionState} from './src/google-connection-state.js';
  import {GOOGLE_CALENDAR_SCOPES} from './src/google-calendar.js';
  export class SyntheticState extends DurableObject {
    constructor(ctx,env) {
      super(ctx,env);
      ctx.blockConcurrencyWhile(async()=>{
        this.store=new StudentStore(ctx.storage);
        this.google=new GoogleConnectionState(this.store,{key:env.SYNTHETIC_KEY});
      });
    }
    async run(message) {
      const tenant='synthetic_student_alpha';
      const write=(op,data,expectedRevision,operationId)=>this.store.dispatch({tenantId:tenant,op,data,expectedRevision,operationId});
      try {
        switch(message.op) {
          case 'setup':
            await write('profile.put',{display_name:'Synthetic Student',timezone:'UTC',consent_version:'test-v1'},0,'synthetic_profile_1');
            return write('connections.put',{id:'google_a',provider:'google_calendar',site_url:'https://calendar.google.com/'},0,'synthetic_connection_1');
          case 'begin': return await this.google.beginAuthorization(tenant,message.input);
          case 'consume': return await this.google.consumeAuthorization(tenant,message.input);
          case 'finish': return await this.google.finishAuthorization(tenant,{...message.input,credentials:{access_token:'example-access-token',refresh_token:'example-refresh-token',expires_at:Date.now()+3600000,scopes:[...GOOGLE_CALENDAR_SCOPES]}});
          case 'status': return this.google.status(tenant,'google_a');
          case 'delete': {
            const exported=await this.store.dispatch({tenantId:tenant,op:'account.export'});
            return write('account.delete',{confirm:'DELETE_MY_WORKSPACE'},exported.account_revision,'synthetic_delete_1');
          }
          case 'privateCount': return {count:this.store.row('SELECT COUNT(*) AS n FROM google_connections').n};
          default: throw new Error('unknown synthetic operation');
        }
      } catch(error) {return {ok:false,error:error.code??'synthetic_failure'};}
    }
  }
  export default {async fetch(request,env) {return Response.json(await env.STUDENTS.getByName('synthetic-a').run(await request.json()));}};
`;

test('real workerd/SQLite preserves single-use OAuth across runtime restart and deletes credentials', async t => {
  const persistPath = await mkdtemp(join(tmpdir(), 'community-google-state-runtime-'));
  const script = (await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: syntheticWorker }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'], logLevel: 'silent' })).outputFiles[0].text;
  const key = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  const browser = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  let mf;
  t.after(async () => { await mf?.dispose(); await rm(persistPath, { recursive: true, force: true }); });
  const start = async () => {
    mf = new Miniflare(convertV4MiniflareOptions({ name: 'community-google-state-runtime', modules: true, script,
      scriptPath: `${root}test/google-state-worker.mjs`, compatibilityDate: '2026-10-12', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, cf: false,
      unsafeDevRegistryPath: undefined, unsafeRegisterWorker: false, log: new Log(LogLevel.ERROR),
      bindings: { SYNTHETIC_KEY: key }, durableObjects: { STUDENTS: { className: 'SyntheticState', useSQLite: true } }, resourcePersistencePath: persistPath,
      outboundService: () => { throw new Error('Synthetic state test forbids all external requests'); },
    }));
    await mf.ready;
  };
  const request = async (op, input) => (await mf.dispatchFetch('https://synthetic.invalid/', { method: 'POST', body: JSON.stringify({ op, input }) })).json();
  await start(); assert.equal((await request('setup')).ok, true);
  const input = { connectionId: 'google_a', expectedRevision: 0, attemptId: 'synthetic_attempt_1', browserBinding: browser, redirectUri: 'https://synthetic.example/callback' };
  const intent = await request('begin', input); assert.equal(intent.status, 'authorizing');
  await mf.dispose(); await start();
  assert.deepEqual(await request('begin', input), intent);
  const consume = { connectionId: 'google_a', state: intent.state, browserBinding: browser };
  const claim = await request('consume', consume); assert.equal(claim.generation, 1);
  await mf.dispose(); await start();
  assert.equal((await request('consume', consume)).error, 'authorization_callback_rejected');
  const exchange = { connectionId: 'google_a', generation: claim.generation, lease: claim.lease };
  const finished = await request('finish', exchange); assert.equal(finished.status, 'authorized_not_synced');
  assert.equal(finished.last_successful_sync, null);
  await mf.dispose(); await start();
  assert.deepEqual(await request('status'), { ...finished, revocation: null, authorization_blocked: false });
  assert.equal((await request('delete')).ok, true);
  assert.equal((await request('privateCount')).count, 0);
  await mf.dispose(); await start();
  assert.equal((await request('begin', input)).error, 'account_deleted');
  assert.equal((await request('finish', exchange)).error, 'account_deleted');
  assert.equal((await request('privateCount')).count, 0);
});
