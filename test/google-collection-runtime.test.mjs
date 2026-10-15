// Copyright 2026 Daksh Breja. All rights reserved.
// Internal test-only RPC and generated credentials; no website routes added.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {base64url} from 'jose';
const root=fileURLToPath(new URL('../',import.meta.url)),NOW=Date.parse('2026-10-12T12:00:00Z');
const source=`
 import {DurableObject} from 'cloudflare:workers';
 import {StudentStore} from './src/store.js';
 import {GoogleConnectionState} from './src/google-connection-state.js';
 import {GoogleCollectionState} from './src/google-collection-state.js';
 import {collectGooglePage} from './src/google-collector.js';
 import {GOOGLE_CALENDAR_SCOPES} from './src/google-calendar.js';
 export class SyntheticState extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.now=${NOW};ctx.blockConcurrencyWhile(async()=>{this.store=new StudentStore(ctx.storage,{clock:()=>new Date(this.now).toISOString()});this.auth=new GoogleConnectionState(this.store,{key:env.SYNTHETIC_KEY,clock:()=>this.now});this.collection=new GoogleCollectionState(this.store,{clock:()=>this.now});});}
  async run({op,input={},now}){if(now!==undefined)this.now=now;const tenant='synthetic_student_alpha',where={connectionId:'google_a',calendarId:'example-calendar'};const write=(op,data,expectedRevision,operationId)=>this.store.dispatch({tenantId:tenant,op,data,expectedRevision,operationId});try{
   if(op==='setup'){
    await write('profile.put',{display_name:'Synthetic',timezone:'UTC',consent_version:'test-v1'},0,'synthetic_profile');
    await write('connections.put',{id:'google_a',provider:'google_calendar',site_url:'https://calendar.google.com/'},0,'synthetic_connection');
    const browser=this.env.SYNTHETIC_BROWSER;
    const intent=await this.auth.beginAuthorization(tenant,{connectionId:'google_a',expectedRevision:0,attemptId:'synthetic_begin',browserBinding:browser,redirectUri:'https://synthetic.example/callback'});
    const claim=await this.auth.consumeAuthorization(tenant,{connectionId:'google_a',state:intent.state,browserBinding:browser});
    await this.auth.finishAuthorization(tenant,{connectionId:'google_a',generation:claim.generation,lease:claim.lease,credentials:{access_token:'example-access',refresh_token:'example-refresh',expires_at:this.now+3600000,scopes:[...GOOGLE_CALENDAR_SCOPES]}});
    this.store.cacheGoogleChoices(tenant,'google_a',1,[{id:'example-calendar',summary:'Synthetic Calendar',accessRole:'owner'}]);
    return write('google_selection.put',{id:'google_a',connection_generation:1,calendar_ids:['example-calendar']},0,'synthetic_selection');
   }
   if(op==='step')return await collectGooglePage({tenantId:tenant,...where,collection:this.collection,state:this.auth,config:{}});
   if(op==='claim')return this.collection.claim(tenant,where);
   if(op==='snapshot')return this.collection.snapshot(input.foreign?'synthetic_student_bravo':tenant,{...where,...input});
   if(op==='disconnect')return this.auth.disconnect(tenant,{connectionId:'google_a',expectedRevision:this.auth.status(tenant,'google_a').revision});
   if(op==='export')return this.store.dispatch({tenantId:tenant,op:'account.export'});
   if(op==='delete'){const exported=await this.store.dispatch({tenantId:tenant,op:'account.export'});return write('account.delete',{confirm:'DELETE_MY_WORKSPACE'},exported.account_revision,'synthetic_delete');}
   if(op==='counts')return Object.fromEntries(['google_collection','google_events','google_event_stage','google_page_history'].map(table=>[table,this.store.row('SELECT COUNT(*) AS n FROM '+table).n]));
   throw new Error('Unknown fixture operation');
  }catch(error){return {ok:false,error:error.code??'synthetic_failure'};}}
 }
 export default {async fetch(request,env){return Response.json(await env.STUDENTS.getByName('synthetic-a').run(await request.json()));}};
`;
async function setup(t,provider) {
 const directory=await mkdtemp(join(tmpdir(),'community-collection-runtime-'));
 const script=(await build({absWorkingDir:root,stdin:{resolveDir:root,contents:source},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*','node:*'],logLevel:'silent'})).outputFiles[0].text;
 const bindings={SYNTHETIC_KEY:base64url.encode(crypto.getRandomValues(new Uint8Array(32))),SYNTHETIC_BROWSER:base64url.encode(crypto.getRandomValues(new Uint8Array(32)))};let mf,now=NOW;
 const start=async()=>{mf=new Miniflare(convertV4MiniflareOptions({name:'community-collection-test',modules:true,script,scriptPath:root+'test/collection-worker.mjs',compatibilityDate:'2026-10-12',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,cf:false,unsafeDevRegistryPath:undefined,unsafeRegisterWorker:false,log:new Log(LogLevel.ERROR),bindings,durableObjects:{STUDENTS:{className:'SyntheticState',useSQLite:true}},resourcePersistencePath:directory,outboundService:async request=>{const url=new URL(request.url);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(url.pathname,'/calendar/v3/calendars/example-calendar/events');assert.equal(request.headers.get('Authorization'),'Bearer example-access');return provider(url);}}));await mf.ready;};
 t.after(async()=>{await mf?.dispose();await rm(directory,{recursive:true,force:true});});await start();
 const request=async(op,input)=>(await mf.dispatchFetch('https://synthetic.invalid/',{method:'POST',body:JSON.stringify({op,input,now})})).json();assert.equal((await request('setup')).ok,true);
 return {request,advance:ms=>now+=ms,restart:async()=>{await mf.dispose();await start();}};
}
const event=(id,summary=id)=>({id,status:'confirmed',summary,start:{date:'2026-10-12'},end:{date:'2026-10-13'}});
test('real workerd resumes staged pages and expired leases, then publishes only a complete provider snapshot',async t=>{
 const calls=[];const f=await setup(t,url=>{calls.push(Object.fromEntries(url.searchParams));const second=url.searchParams.get('pageToken');return Response.json({items:[event(second?'b':'a')],timeZone:'UTC',...(second?{nextSyncToken:'example-sync-v1'}:{nextPageToken:'example-page-2'})});});
 assert.equal((await f.request('step')).published,false);assert.deepEqual((await f.request('snapshot')).events,[]);await f.restart();assert.deepEqual((await f.request('export')).data.google_calendar_snapshots,[]);
 f.advance(1000);const abandoned=await f.request('claim');assert.equal(abandoned.pageToken,'example-page-2');await f.restart();assert.equal((await f.request('step')).kind,'wait');f.advance(60000);
 const result=await f.request('step');assert.equal(result.published,true);assert.deepEqual((await f.request('snapshot')).events.map(e=>e.id),['a','b']);assert.equal(calls.length,2);assert.equal(calls[1].pageToken,'example-page-2');assert.equal(calls[1].syncToken,undefined);
 await f.restart();const exported=await f.request('export');assert.equal(exported.data.google_calendar_snapshots[0].events.length,2);assert.doesNotMatch(JSON.stringify(exported),/example-sync|example-page|lease|ciphertext/);
 assert.equal((await f.request('snapshot',{foreign:true})).error,'owner_mismatch');
 await f.request('delete');assert.deepEqual(await f.request('counts'),{google_collection:0,google_events:0,google_event_stage:0,google_page_history:0});assert.equal((await f.request('step')).kind,'stopped');
});
test('real provider throttle resumes its stable incremental cursor, and 410 resets all old source data',async t=>{
 let count=0;const cursors=[];const f=await setup(t,url=>{count++;cursors.push(url.searchParams.get('syncToken'));if(count===2)return new Response(null,{status:429,headers:{'Retry-After':'600'}});if(count===3)return new Response(null,{status:410});return Response.json({items:[event(count===1?'old':'new')],timeZone:'UTC',nextSyncToken:'example-sync-'+count});});
 assert.equal((await f.request('step')).published,true);f.advance(900000);const backoff=await f.request('step');assert.equal(backoff.status,'backoff');await f.restart();assert.equal((await f.request('step')).kind,'wait');assert.equal(count,2);
 f.advance(600000);const reset=await f.request('step');assert.equal(reset.status,'queued');assert.deepEqual((await f.request('snapshot')).events,[]);assert.deepEqual(cursors,[null,'example-sync-1','example-sync-1']);
 await f.restart();f.advance(1000);assert.equal((await f.request('step')).published,true);assert.equal(cursors[3],null);assert.equal((await f.request('snapshot')).events[0].id,'new');
});
test('disconnect during an actual provider request discards its late result and clears staged data',async t=>{
 let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);t.after(()=>release());
 const f=await setup(t,async()=>{entered();await gate;return Response.json({items:[event('late')],timeZone:'UTC',nextSyncToken:'example-sync'});});
 const pending=f.request('step');await reached;await f.request('disconnect');release();assert.equal((await pending).kind,'stopped');assert.deepEqual(await f.request('counts'),{google_collection:0,google_events:0,google_event_stage:0,google_page_history:0});
});
