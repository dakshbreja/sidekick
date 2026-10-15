// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url} from 'jose';
import {StudentStore} from '../src/store.js';
import {GoogleConnectionState} from '../src/google-connection-state.js';
import {GoogleRevocationState,revocationBarrier,revocationStatus,expireRevocations,REVOCATION_LIMITS} from '../src/google-revocation.js';
import {createRevocationClient} from '../src/google-revoke-client.js';
import {GoogleScheduler} from '../src/google-scheduler.js';
import {GOOGLE_CALENDAR_SCOPES} from '../src/google-calendar.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
const A='synthetic_student_alpha',B='synthetic_student_bravo';
const random=()=>base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
async function setup(t){
 const f=sqliteFixture();t.after(()=>f.close());let now=Date.parse('2026-10-12T12:00:00Z');const key=random(),browser=random(),store=new StudentStore(f.storage),auth=new GoogleConnectionState(store,{key,clock:()=>now}),state=new GoogleRevocationState(store,{key,clock:()=>now});let n=0;
 const write=(op,data,expectedRevision=0)=>store.dispatch({tenantId:A,op,data,expectedRevision,operationId:'synthetic_write_'+(++n)});
 await write('profile.put',{display_name:'Synthetic Student',timezone:'UTC',consent_version:'test-v1'});
 const register=async id=>write('connections.put',{id,provider:'google_calendar',site_url:'https://calendar.google.com/'});await register('google_a');
 const begin=(connectionId='google_a',expectedRevision=0)=>auth.beginAuthorization(A,{connectionId,expectedRevision,attemptId:'synthetic_consent_'+(++n),browserBinding:browser,redirectUri:'https://community.example.invalid/api/google/callback'});
 const intent=await begin();const claim=await auth.consumeAuthorization(A,{connectionId:'google_a',state:intent.state,browserBinding:browser});await auth.finishAuthorization(A,{connectionId:'google_a',generation:claim.generation,lease:claim.lease,credentials:{access_token:'example-access',refresh_token:'example-refresh',expires_at:now+3600000,scopes:[...GOOGLE_CALENDAR_SCOPES]}});
 const request={connectionId:'google_a',expectedRevision:auth.status(A,'google_a').revision,attemptId:'synthetic_removal'};
 return {store,auth,state,write,begin,register,browser,request,now:()=>now,advance:ms=>now+=ms,start:()=>state.start(A,request)};
}
test('revocation transport confines credentials to fixed POST body and requires HTTP 200',async()=>{
 let calls=0;const client=createRevocationClient({fetcher:async(url,options)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(new URLSearchParams(options.body).get('token'),'example-refresh');return new Response('unused private provider response',{status:200});}});
 assert.deepEqual(await client.revoke('example-refresh'),{confirmed:true,retryable:false});assert.equal(calls,1);
 for(const status of [400,302,429,503]){const result=await createRevocationClient({fetcher:async()=>new Response('example-secret',{status,headers:{'Retry-After':'120'}})}).revoke('example-refresh');assert.equal(result.confirmed,false);assert.equal(result.retryable,status>=429);assert.equal(result.retryAfterSeconds,120);assert.doesNotMatch(JSON.stringify(result),/example-secret|example-refresh/);}
 const timed=await createRevocationClient({timeoutMs:5,fetcher:()=>new Promise(()=>{})}).revoke('example-refresh');assert.equal(timed.error,'revocation_unavailable');
});
test('start is durable, exact replay is safe, secrets stay private, and success permits reconnect',async t=>{
 const f=await setup(t);assert.equal(f.start().state,'pending');assert.deepEqual(f.start(),revocationStatus(f.store,'google_a'));assert.equal(f.auth.status(A,'google_a').authorized,false);assert.equal(f.store.googleConnection('google_a').tokens,undefined);
 assert.throws(()=>f.state.start(A,{...f.request,expectedRevision:0}),e=>e.code==='revocation_attempt_conflict');assert.throws(()=>f.state.claim(B,'google_a'),e=>e.status===403);
 await assert.rejects(f.begin('google_a',f.auth.status(A,'google_a').revision),e=>e.code==='google_revocation_pending');
 const exported=await f.store.dispatch({tenantId:A,op:'account.export'});assert.doesNotMatch(JSON.stringify(exported),/credential|example-refresh|google_tokens|synthetic_removal/);
 f.advance(1001);const claim=f.state.claim(A,'google_a');assert.equal(await f.state.token(A,claim),'example-refresh');assert.equal(f.state.claim(A,'google_a'),null);
 assert.equal(f.state.finish(A,claim,{confirmed:true}).state,'confirmed');assert.equal(revocationBarrier(f.store,f.now()),false);assert.equal(f.store.row('SELECT body FROM google_revocations').body.includes('ciphertext'),false);
 assert.equal((await f.begin('google_a',f.auth.status(A,'google_a').revision)).status,'authorizing');
});
test('retry delay and crash attempts are bounded, and collection pause does not block revocation',async t=>{
 const f=await setup(t);f.start();f.advance(1001);let claim=f.state.claim(A,'google_a');f.state.finish(A,claim,{confirmed:false,retryable:true,error:'revocation_unavailable',retryAfterSeconds:180});assert.equal(f.state.claim(A,'google_a'),null);
 const scheduler=new GoogleScheduler(f.store,{clock:f.now,includeCollections:false,includeRevocations:true});scheduler.save({...scheduler.state(),paused:true});assert.equal(scheduler.nextTime(),f.now()+180000);
 f.advance(180000);for(let i=1;i<REVOCATION_LIMITS.attempts;i++){claim=f.state.claim(A,'google_a');assert.ok(claim);f.advance(REVOCATION_LIMITS.leaseMs+1);}
 assert.equal(f.state.claim(A,'google_a'),null);assert.equal(revocationStatus(f.store,'google_a').state,'unconfirmed');assert.equal(scheduler.nextTime(),null);
});
test('local erasure fences an in-flight removal and keeps reauthorization blocked only through its lease',async t=>{
 const f=await setup(t);f.start();f.advance(1001);const claim=f.state.claim(A,'google_a');f.auth.disconnect(A,{connectionId:'google_a',expectedRevision:f.auth.status(A,'google_a').revision});
 assert.throws(()=>f.state.finish(A,claim,{confirmed:true}),e=>e.code==='google_revocation_stale');assert.equal(revocationStatus(f.store,'google_a').state,'unconfirmed');assert.equal(revocationBarrier(f.store,f.now()),true);
 f.advance(REVOCATION_LIMITS.leaseMs+1);assert.equal(revocationBarrier(f.store,f.now()),false);
});
test('expiry and account deletion erase retained removal credentials and reject late callbacks',async t=>{
 const f=await setup(t);f.start();f.advance(REVOCATION_LIMITS.retentionMs);f.store.storage.transactionSync(()=>expireRevocations(f.store,f.now()));assert.equal(revocationStatus(f.store,'google_a').error,'cleanup_expired');assert.equal(revocationBarrier(f.store,f.now()),false);
 const snapshot=await f.store.dispatch({tenantId:A,op:'account.export'});const deleted=await f.write('account.delete',{confirm:'DELETE_MY_WORKSPACE'},snapshot.account_revision);assert.equal(deleted.ok,true);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM google_revocations').n,0);assert.throws(()=>f.start(),e=>e.code==='account_deleted');
});
test('removal cancels unfinished consents on other connections before Google project-wide revocation',async t=>{
 const f=await setup(t);await f.register('google_b');const intent=await f.begin('google_b');f.start();await assert.rejects(f.auth.consumeAuthorization(A,{connectionId:'google_b',state:intent.state,browserBinding:f.browser}),e=>e.code==='authorization_callback_rejected');
});
