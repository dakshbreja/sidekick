import test from 'node:test';
import assert from 'node:assert/strict';
import {feedURL,parseSchoolFeed,fetchSchoolFeed,itemId} from '../src/school-feed.js';
import {SchoolFeedState} from '../src/school-feed-state.js';
import {StudentStore} from '../src/store.js';
import {GoogleScheduler} from '../src/google-scheduler.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
const OWNER='synthetic_student_owner',NOW=Date.parse('2026-10-13T15:00:00Z'),KEY='A'.repeat(43);
const URL='https://uga.view.usg.edu/d2l/le/calendar/feed/user/feed.ics?token=synthetic_token_only';
const ics=(date='20261012T150000Z',title='Exercise due')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nDTSTART:${date}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const rss=(title='Exam moved',body='The exam is now due next week.')=>`<rss version="2.0"><channel><item><guid>44-123</guid><title>${title}</title><description><![CDATA[${body}]]></description><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate><link>https://uga.view.usg.edu/d2l/lms/news/main.d2l?ou=123</link></item></channel></rss>`;
async function setup(t){const f=sqliteFixture();t.after(f.close);let now=NOW;const store=new StudentStore(f.storage,{clock:()=>new Date(now).toISOString()}),state=new SchoolFeedState(store,{key:KEY,clock:()=>now});const commit=fn=>f.storage.transactionSync(fn);const dispatch=(op,data={},expectedRevision=0)=>store.dispatch({tenantId:OWNER,op,data,...(op.endsWith('.put')||op==='account.delete'?{expectedRevision,operationId:crypto.randomUUID()}: {})});assert.equal((await dispatch('courses.put',{id:'course_a',code:'SYN 101',title:'Synthetic course',section:'001',term_id:'synthetic-term'})).ok,true);const packet={id:'feed_a',course_id:'course_a',kind:'calendar',feed_url:URL,consent:true,expected_revision:0,operation_id:crypto.randomUUID()};return {store,state,commit,dispatch,packet,advance:ms=>now+=ms,now:()=>now};}
test('feed transport admits only fixed UGA endpoints and refuses redirects and oversized streams',async()=>{
 assert.equal(feedURL(URL,'calendar').org,null);
 for(const url of ['http://uga.view.usg.edu/d2l/le/calendar/feed/user/feed.ics?token=synthetic','https://evil.invalid/x?token=synthetic',URL+'#secret',URL.replace('uga.view.usg.edu','uga.view.usg.edu.evil.invalid'),URL.replace('/feed/user/feed.ics','/other'),URL.replace('?token=','?password=')])assert.throws(()=>feedURL(url,'calendar'));
 assert.throws(()=>feedURL('https://uga.view.usg.edu/d2l/le/news/rss/123/course?ou=124&token=synthetic','announcements'));
 let options;await assert.rejects(fetchSchoolFeed(URL,async(_url,o)=>{options=o;return new Response(null,{status:302,headers:{location:'https://evil.invalid'}});}));assert.equal(options.redirect,'manual');
 await assert.rejects(fetchSchoolFeed(URL,async()=>new Response('x'.repeat(250001))),e=>e.code==='school_feed_too_large');
});
test('calendar occurrence identities survive moved single dates and separate recurring occurrences and courses',async()=>{
 const feed={id:'feed_a',kind:'calendar'},a=await parseSchoolFeed(ics(),feed,{now:NOW}),b=await parseSchoolFeed(ics('20261015T150000Z'),feed,{now:NOW});assert.equal(a.events[0].id,b.events[0].id);assert.equal(a.events[0].category,'deadline');
 assert.notEqual(await itemId('feed_a','same',''),await itemId('feed_b','same',''));
 const repeating=await parseSchoolFeed(ics().replace('SUMMARY:','RRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:'),feed,{now:NOW});assert.equal(new Set(repeating.events.map(e=>e.id)).size,3);
 for(const title of ['Exam','Assignment opens','Assignment closes','Assignment available until deadline'])assert.equal((await parseSchoolFeed(ics(undefined,title),feed,{now:NOW})).events[0].category,'event');
});
test('RSS is bounded, plain text, course checked, date-change flagged and explicitly partial',async()=>{
 const result=await parseSchoolFeed(rss('Exam moved','<b>New date</b><script>alert(1)</script> exam postponed.'),{id:'feed_rss',kind:'announcements',org:'123'},{now:NOW});assert.equal(result.coverage.complete,false);assert.equal(result.announcements[0].review_date_change,true);assert.doesNotMatch(result.announcements[0].text,/<|alert/);
 for(const raw of [rss().replace('44-123','44-999'),'<!DOCTYPE rss [<!ENTITY a "evil">]>'+rss(),'<html>Login</html>',rss().replace('uga.view.usg.edu','evil.invalid')])await assert.rejects(parseSchoolFeed(raw,{id:'f',kind:'announcements',org:'123'}));
});
test('private URLs never enter receipts, exports or dashboard; exact retry survives lost response',async t=>{
 const f=await setup(t),first=await f.state.put(OWNER,f.packet,f.commit);assert.equal(first.ok,true);assert.equal((await f.state.put(OWNER,f.packet,f.commit)).replayed,true);
 const state=f.state.get('feed_a');assert.ok(state.envelope.ciphertext);assert.doesNotMatch(JSON.stringify(state),/synthetic_token_only/);
 await f.state.collect(OWNER,'feed_a',{fetcher:async()=>new Response(ics())});
 for(const result of [first,await f.dispatch('account.export'),await f.dispatch('daily.get'),f.store.sql.exec('SELECT body FROM operations').toArray()])assert.doesNotMatch(JSON.stringify(result),/synthetic_token_only|ciphertext|feed_url/);
 await assert.rejects(f.state.put('synthetic_other_owner',{...f.packet,operation_id:crypto.randomUUID()},f.commit),e=>e.code==='owner_mismatch');
 await assert.rejects(f.state.put(OWNER,{...f.packet,feed_url:URL+'x'},f.commit),e=>e.code==='operation_id_conflict');
});
test('reported submitted work leaves overdue, fresh resume retains it, and partial work remains overdue',async t=>{
 const f=await setup(t);await f.state.put(OWNER,f.packet,f.commit);await f.state.collect(OWNER,'feed_a',{fetcher:async()=>new Response(ics())});let daily=await f.dispatch('daily.get');assert.equal(daily.counts.overdue,1);const item=daily.groups.overdue[0],data={id:'daily_'+item.id,assignment_id:item.id,course_id:'course_a',title:item.title,status:'done',submitted:false,verification:'reported',note:'Synthetic'};
 assert.equal((await f.dispatch('progress.put',data)).error,'done_requires_reported_submission');assert.equal((await f.dispatch('progress.put',{...data,status:'in_progress'})).ok,true);assert.equal((await f.dispatch('daily.get')).counts.overdue,1);
 assert.equal((await f.dispatch('progress.put',{...data,submitted:true},1)).ok,true);daily=await f.dispatch('daily.get');assert.equal(daily.counts.overdue,0);assert.equal(daily.counts.completed,1);
 const resumed=new StudentStore(f.store.storage,{clock:()=>new Date(NOW).toISOString()});assert.equal((await resumed.dispatch({tenantId:OWNER,op:'daily.get'})).counts.completed,1);
 assert.equal((await f.dispatch('progress.put',{...data,id:'daily_forged',assignment_id:'forged',submitted:true})).error,'assignment_changed');
});
test('a missing deadline remains reviewable, failed collection keeps last good data and backs off',async t=>{
 const f=await setup(t);await f.state.put(OWNER,f.packet,f.commit);await f.state.collect(OWNER,'feed_a',{fetcher:async()=>new Response(ics())});await f.state.collect(OWNER,'feed_a',{fetcher:async()=>new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR')});assert.equal((await f.dispatch('daily.get')).counts.review,1);
 const before=f.state.get('feed_a').last_successful_sync;f.advance(2000000);await f.state.collect(OWNER,'feed_a',{fetcher:async()=>new Response('Login',{status:403})});const row=f.state.get('feed_a');assert.equal(row.last_successful_sync,before);assert.equal(row.status,'needs_attention');assert.ok(row.next_due>f.now());const daily=await f.dispatch('daily.get');assert.equal(daily.sources[0].freshness,'stale');assert.equal(daily.counts.review,1);
});
test('removal and account deletion fence in-flight results and encrypted access, without resurrection',async t=>{
 const f=await setup(t);await f.state.put(OWNER,f.packet,f.commit);let release,entered;const waiting=new Promise(r=>entered=r);const work=f.state.collect(OWNER,'feed_a',{fetcher:async()=>{entered();return new Promise(r=>release=()=>r(new Response(ics())));}});await waiting;
 const packet={id:'feed_a',expected_revision:1,operation_id:crypto.randomUUID()};await f.state.remove(OWNER,packet,f.commit);release();assert.equal((await work).kind,'stopped');assert.equal(f.state.get('feed_a').envelope,null);assert.equal(f.state.get('feed_a').snapshot,null);assert.equal((await f.state.remove(OWNER,packet,f.commit)).replayed,true);
 const meta=await f.dispatch('account.export');await f.dispatch('account.delete',{confirm:'DELETE_MY_WORKSPACE'},meta.account_revision);assert.equal(f.store.row('SELECT COUNT(*) AS n FROM school_feeds').n,0);await assert.rejects(f.state.put(OWNER,f.packet,f.commit),e=>e.code==='account_deleted');
});
test('feed scheduling shares persisted budget and lease, excludes removed sources and respects disabled flag',async t=>{
 const f=await setup(t);await f.state.put(OWNER,f.packet,f.commit);const s=new GoogleScheduler(f.store,{clock:f.now,includeFeeds:true,includeCollections:false});const plan=s.reserve();assert.equal(plan.operation,'school_feed');assert.equal(s.reserve().kind,'wait');const resumed=new GoogleScheduler(f.store,{clock:f.now,includeFeeds:true,includeCollections:false});assert.equal(resumed.reserve().kind,'wait');f.advance(60001);assert.equal(resumed.reserve().operation,'school_feed');assert.equal(new GoogleScheduler(f.store,{clock:f.now,includeCollections:false}).candidates().length,0);
 await f.state.remove(OWNER,{id:'feed_a',expected_revision:1,operation_id:crypto.randomUUID()},f.commit);assert.equal(s.nextTime(),null);
});
test('daily deadlines respect profile timezone, separate calendar events and declare bounded display',async t=>{
 const f=await setup(t);await f.dispatch('profile.put',{display_name:'Synthetic',timezone:'America/New_York',consent_version:'test'});
 await f.dispatch('assignments.put',{id:'deadline_a',course_id:'course_a',title:'Synthetic task',due_at:'2026-10-14T02:00:00Z',all_day:false});const daily=await f.dispatch('daily.get');assert.equal(daily.counts.due_today,1);assert.equal(daily.today,'2026-10-13');assert.equal(daily.display_complete,true);
});
