// Rendered synthetic QA. Browser profiles, exports and screenshots stay outside Git.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, realpath, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../',import.meta.url));
const evidence=resolve(process.env.BROWSER_EVIDENCE_DIR || await mkdtemp(join(tmpdir(),'school-bridge-browser-evidence-')));
await mkdir(evidence,{recursive:true});
const location=relative(await realpath(repository),await realpath(evidence));
if(!isAbsolute(location) && location!=='..' && !location.startsWith('..'+sep))throw new Error('Browser evidence must be outside the repository.');
const profile=await mkdtemp(join(tmpdir(),'school-bridge-synthetic-browser-'));
const port=process.env.DEMO_PORT || '8767';const root=`http://127.0.0.1:${port}`;
const demo=spawn('npm',['run','demo'],{cwd:repository,env:{...process.env,DEMO_PORT:port,DEMO_DEPLOYMENT_BUNDLE:'1',DEMO_SCHOOL_FEEDS:'1',DEMO_TUTOR:'1'},stdio:['ignore','pipe','pipe'],detached:true});
let demoLog='';demo.stdout.on('data',b=>demoLog+=b);demo.stderr.on('data',b=>demoLog+=b);
let context,page,preferredPath=null;const errors=[];const passed=[];
const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('ready') || document.querySelector('#notice').textContent.includes('This workspace was deleted.'));if(preferredPath)await go(preferredPath);};
async function go(path){preferredPath=path;if(new URL(page.url()).pathname===path)return;if(path==='/onboarding/courses'&&!await page.locator('#onboarding-nav').isVisible())await page.locator('.workspace-nav a[href="/onboarding/profile"]').click();await page.locator('nav a[href="'+path+'"]').first().click();await page.waitForURL(root+path);}
const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('form:not(#tutor-form) button')].some(b=>b.disabled));
const snapshot=()=>page.evaluate(async()=>{const data=await (await fetch('/api/account/export')).json();delete data.exported_at;return data;});
const stored=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('school-bridge-outbox-v1:')).map(k=>JSON.parse(localStorage.getItem(k))));
async function launch(){context=await chromium.launchPersistentContext(profile,{executablePath:process.env.BROWSER_EXECUTABLE || '/usr/bin/chromium',headless:true,acceptDownloads:true,args:['--no-sandbox']});page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await page.goto(root);await ready();}
async function submit(id,values){await go({'#profile-form':'/onboarding/profile','#course-form':'/onboarding/courses','#connection-form':'/onboarding/connections','#material-form':'/notes'}[id]);for(const [key,value] of Object.entries(values))await page.locator(`${id} [name="${key}"]`).fill(value);await page.locator(id).evaluate(form=>{form.requestSubmit();form.requestSubmit();});await settled();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Saved and verified'));}
async function reconcile(){await page.locator('#reconcile').click();await page.waitForFunction(()=>!document.querySelector('#reconcile').disabled && document.querySelector('#recovery').hidden);}
try{
 for(let attempt=0;attempt<100;attempt++){if(demo.exitCode!==null)throw new Error(demoLog);try{if(demoLog.includes('Synthetic-only School Bridge: '+root) && (await fetch(root+'/health')).ok)break;}catch{}if(attempt===99)throw new Error('Synthetic demo startup timed out');await new Promise(r=>setTimeout(r,100));}
 await launch();assert.equal((await snapshot()).account_revision,0);
 for(const target of ['#calendar-today-status','#calendar-setup-status']){assert.match(await page.locator(target).innerText(),/Google Calendar setup pending/);assert.equal(await page.locator(target+' [data-calendar-stage=setup_pending]').count(),1);}
 await page.screenshot({path:join(evidence,'calendar-operator-setup-pending.png'),fullPage:true});
 passed.push('calendar setup remains visible in Today and Sources with disabled Google and empty workspace');
 assert.equal(new URL(page.url()).pathname,'/onboarding/profile');assert.equal(await page.locator('#daily').isVisible(),false);assert.equal(await page.locator('#material-form').isVisible(),false);
 const beforeDemo=await snapshot();await page.getByRole('link',{name:'Try the sample walkthrough',exact:true}).click();
 for(const title of ['1 · Your profile','2 · Your courses','3 · Your connections']){assert.equal(await page.locator('#demo-title').innerText(),title);await page.locator('#demo-next').click();}
 assert.deepEqual(await snapshot(),beforeDemo);await page.screenshot({path:join(evidence,'onboarding-demo.png'),fullPage:true});
 await go('/notes');assert.equal(await page.locator('#materials').isVisible(),true);assert.equal(await page.locator('#setup').isVisible(),false);
 await page.goBack();assert.equal(new URL(page.url()).pathname,'/onboarding/demo');await page.goForward();assert.equal(new URL(page.url()).pathname,'/notes');
 await page.reload();await ready();assert.equal(new URL(page.url()).pathname,'/notes');assert.equal(await page.locator('#materials').isVisible(),true);
 await page.goto(root+'/?calendar=connected');preferredPath=null;await ready();assert.equal(new URL(page.url()).pathname,'/onboarding/connections');
 await page.goto(root+'/#daily');await ready();assert.equal(new URL(page.url()).pathname,'/dashboard');
 await go('/learning');assert.equal(await page.locator('#learning-page').isVisible(),true);await go('/tutor');assert.match(await page.locator('#tutor-page').innerText(),/Free website tutor/);
 await go('/onboarding/profile');
 passed.push('separate page routes, first-run onboarding, inert sample walkthrough, browser back/forward, deep-link reload, legacy links and Google return route');
 await page.locator('#profile-form [name=consent]').check();await submit('#profile-form',{display_name:'Synthetic Student A',timezone:'America/New_York'});
 await submit('#course-form',{code:'SYN 101',title:'Synthetic course',section:'A',term_id:'fall-2026'});
 await submit('#connection-form',{site_url:'https://school.example.invalid'});
 assert.match(await page.locator('#connections').innerText(),/Needs authorization/);
 const course=await page.locator('#material-form [name=course_id] option').nth(1).getAttribute('value');
 const source=await page.locator('#source-select option').nth(1).getAttribute('value');
 const seeded=await page.evaluate(async course=>{const owner=(await(await fetch('/api/onboarding')).json()).workspace_id;return (await fetch('/api/learning',{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Id':owner},body:JSON.stringify({operation_id:'synthetic_learning_page',expected_revision:0,course_id:course,session_id:'synthetic_session',resume:'Review the missed inventory question before continuing.',observations:[{topic_id:'inventory',outcome:'incorrect',assistance:'independent',evidence:'observed_response',next_step:'Try a simpler practice question.'}]})})).status;},course);assert.equal(seeded,200);
 await go('/learning');await page.locator('#learning-course').selectOption(course);await page.locator('#learning-load').click();await page.waitForFunction(()=>document.querySelector('#learning-handoff').textContent.includes('missed inventory question'));assert.match(await page.locator('#learning-handoff').innerText(),/0 independently correct/);assert.match(await page.locator('#learning-handoff').innerText(),/1 incorrect/);
 await page.screenshot({path:join(evidence,'learning-page.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await go('/dashboard');assert.equal(await page.locator('#setup').isVisible(),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(evidence,'dashboard-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});
 passed.push('Learning reads actual saved evidence without upgrading incorrect answers; mobile dashboard hides setup and fits the viewport');
 await go('/onboarding/connections');
 // Actual synthetic backend: course feed consent, alarm collection, submission and fresh-chat-style reload.
 await page.locator('#school-feed-form [name=course_id]').selectOption(course);
 await page.locator('#school-feed-form [name=feed_url]').fill('https://uga.view.usg.edu/d2l/le/calendar/feed/user/feed.ics?token=synthetic_browser_feed');
 await page.locator('#school-feed-form [name=consent]').check();await page.locator('#school-feed-form button').click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Course feed saved'));
 for(let n=0;n<50;n++){const ready=await page.evaluate(async()=>{const data=await(await fetch('/api/daily')).json();return data.counts.overdue===1;});if(ready)break;if(n===49)throw new Error('Synthetic feed was not collected');await new Promise(r=>setTimeout(r,200));}
 await go('/dashboard');await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#daily-groups').textContent.includes('Synthetic feed exercise due'));
 await page.getByRole('button',{name:'Save as submitted',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Confirm that you submitted'));
 assert.equal((await snapshot()).data.progress.length,0);
 await page.getByRole('checkbox',{name:'I submitted this requirement.',exact:true}).check();await page.getByRole('button',{name:'Save as submitted',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Progress saved and verified'));
 await page.reload();await ready();assert.match(await page.locator('#daily-groups').innerText(),/Completed · reported submitted \(1\)/);assert.match(await page.locator('#daily-groups').innerText(),/Overdue \(0\)/);
 assert.doesNotMatch(JSON.stringify(await stored()),/synthetic_browser_feed|feed_url/);assert.doesNotMatch(JSON.stringify(await snapshot()),/synthetic_browser_feed|ciphertext|feed_url/);
 await page.screenshot({path:join(evidence,'daily-school-dashboard.png'),fullPage:true});
 passed.push('actual feed UI: explicit consent, server alarm collection, submitted-work confirmation, private URL exclusion and completed status after reload');
 await go('/onboarding/connections');
 // Render the opt-in consent UI with synthetic route responses. Backend
 // callback/credential behavior is separately tested against actual workerd.
 let googleState={connection_id:source,revision:0,status:'needs_authorization',authorized:false,generation:1,live_sync:false,last_successful_sync:null};
 let consentPacket,disconnectPacket,googleNavigations=0;
 let googleSelection={ok:true,record:null,revision:0,active:false},selectionWrites=0;const selectionReceipts=new Map();
 await page.route('**/api/onboarding',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();const body=await response.json();body.capabilities.google_calendar_oauth=true;body.capabilities.google_calendar_selection=true;body.capabilities.google_calendar_collection=Boolean(googleState.collection?.automatic_enabled);await route.fulfill({response,json:body});});
 await page.route('**/api/google/status?*',route=>route.fulfill({json:{ok:true,connection:googleState}}));
 await page.route('**/api/google/selection?*',route=>route.fulfill({json:{...googleSelection,active:Boolean(googleSelection.record && googleState.authorized)}}));
 let interruptedSelection;
 await page.route('**/api/google/selection',async route=>{
  const packet=route.request().postDataJSON();selectionWrites++;assert.equal(packet.connection_generation,1);assert.equal(packet.expected_revision,googleSelection.revision);
  if(selectionWrites===3){interruptedSelection=packet;return route.abort('failed');}
  if(!googleState.authorized){
   assert.deepEqual(packet,interruptedSelection);
   const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
   const request={op:'google_selection.put',data:{id:packet.id,connection_generation:packet.connection_generation,calendar_ids:[...packet.calendar_ids].sort()},expectedRevision:packet.expected_revision};
   const receipt={operation_id:packet.operation_id,operation:'google_selection.put',resource_id:source,expected_revision:packet.expected_revision,request_hash:createHash('sha256').update(canonical(request)).digest('hex'),outcome:'rejected',reason:'google_access_changed'};
   selectionReceipts.set(packet.operation_id,receipt);return route.fulfill({status:409,json:{ok:false,error:'google_access_changed',receipt}});
  }
  const revision=googleSelection.revision+1;const receipt={operation_id:packet.operation_id,operation:'google_selection.put',resource_id:source,revision,request_hash:'synthetic-selection-hash-'+revision};selectionReceipts.set(packet.operation_id,receipt);
  googleSelection={ok:true,active:true,revision,record:{calendar_ids:packet.calendar_ids,calendars:packet.calendar_ids.map(id=>({id,summary:'<script>Synthetic literal calendar</script>'}))}};
  if(selectionWrites===1)return route.abort('failed');return route.fulfill({json:{ok:true,receipt}});
 });
 await page.route('**/api/receipts/*',route=>{const receipt=selectionReceipts.get(new URL(route.request().url()).pathname.split('/').at(-1));return receipt?route.fulfill({json:{ok:true,receipt}}):route.continue();});
 await page.route('**/api/google/prepare',route=>route.fulfill({json:{ok:true}}));
 await page.route('**/api/google/begin',route=>{consentPacket=route.request().postDataJSON();return route.fulfill({json:{ok:true,authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=example-synthetic-state'}});});
 await page.route('**/api/google/disconnect',route=>{disconnectPacket=route.request().postDataJSON();googleState={...googleState,status:'disconnected',authorized:false,revision:4};return route.fulfill({json:{ok:true,connection:googleState}});});
 await page.route('https://accounts.google.com/**',route=>{googleNavigations++;return route.fulfill({contentType:'text/html',body:'Synthetic consent navigation captured; no provider contacted.'});});
 await page.reload();await ready();
 assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=consent_pending]').count(),1);
 // A connector outage must not stop unrelated profile/course/material readback.
 await page.route('**/api/google/status?*',route=>route.fulfill({status:503,json:{ok:false,error:'google_connection_unavailable'}}));
 await page.reload();await ready();assert.match(await page.locator('#courses').innerText(),/SYN 101/);assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=unavailable]').count(),1);assert.equal(await page.getByRole('button',{name:'Authorize Google Calendar',exact:true}).count(),0);
 await page.unroute('**/api/google/status?*');await page.route('**/api/google/status?*',route=>route.fulfill({status:403,json:{ok:false,error:'workspace_changed'}}));await page.reload();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('sign-in changed'));assert.equal(await page.locator('#courses .row').count(),0);assert.equal(await page.locator('#calendar-today-status .row').count(),0);
 await page.unroute('**/api/google/status?*');await page.route('**/api/google/status?*',route=>route.fulfill({json:{ok:true,connection:googleState}}));
 await page.reload();await ready();
 passed.push('calendar status outage preserves workspace readback and offers no unsafe consent action; identity errors still fail closed');
 await page.getByRole('button',{name:'Authorize Google Calendar',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Review and check'));assert.equal(googleNavigations,0);
 await page.getByRole('checkbox',{name:/Allow read-only access/}).check();
 await page.screenshot({path:join(evidence,'google-consent-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'Authorize Google Calendar',exact:true}).click();await page.waitForURL('https://accounts.google.com/**');assert.equal(googleNavigations,1);
 assert.equal(consentPacket.connection_id,source);assert.equal(consentPacket.expected_revision,0);assert.equal(typeof consentPacket.attempt_id,'string');
 googleState={...googleState,status:'authorized_not_synced',authorized:true,revision:3};
 await page.goto(root);await ready();assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=unselected]').count(),1);assert.match(await page.locator('#connections').innerText(),/Authorized; choose calendars below. No events synced yet/);
 let calendarPages=0;
 await page.route('**/api/google/calendars?*',route=>{calendarPages++;return route.fulfill({json:{ok:true,live_sync:false,page:{items:[{id:'synthetic_calendar_'+calendarPages,summary:calendarPages===1?'<script>Synthetic literal calendar</script>':'Synthetic second calendar',timeZone:'UTC',accessRole:'owner'}],next_page_token:calendarPages===1?'synthetic_page_2':null,collection_complete:calendarPages===2}}});});
 await page.getByRole('button',{name:'Show Google calendars',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Calendar list is incomplete'));
 assert.match(await page.locator('#connections').innerText(),/<script>Synthetic literal calendar<\/script>/);
 assert.match(await page.locator('#connections').innerText(),/Available calendar choice/);
 await page.getByRole('button',{name:'Load next calendars',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Calendar choices loaded'));
 assert.equal(calendarPages,2);assert.equal(await page.getByRole('button',{name:'Calendars listed',exact:true}).isDisabled(),true);
 await page.screenshot({path:join(evidence,'google-calendar-choices.png'),fullPage:true});
 await page.getByRole('checkbox',{name:'Select <script>Synthetic literal calendar</script>',exact:true}).check();
 await page.getByRole('button',{name:'Save calendar selection',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#recovery').hidden);assert.equal(selectionWrites,1);
 assert.deepEqual(googleSelection.record.calendar_ids,['synthetic_calendar_1']);
 await page.reload();await ready();assert.match(await page.locator('#connections').innerText(),/1 selected/);assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=setup_pending]').count(),1);
 await reconcile();assert.equal(selectionWrites,1);assert.equal((await stored()).length,0);
 await page.screenshot({path:join(evidence,'google-calendar-selection.png'),fullPage:true});
 await page.route('**/api/google/upcoming?*',route=>route.fulfill({json:{ok:true,snapshot_complete:true,last_successful_sync:new Date().toISOString(),freshness:'stale',coverage:{complete:false,warnings:[{code:'unsupported_recurrence',count:1}]},events:[{source_event_id:'synthetic_event',occurrence_id:'synthetic_occurrence',title:'<script>Synthetic all-day class</script>',start:'2026-11-02',end:'2026-11-04',all_day:true,status:'confirmed'}]}}));
 googleState={...googleState,status:'authorized',collection:{automatic_enabled:true,scheduler:{status:'scheduled',next_run_at:Date.now()+60000,error:null},calendars:[{calendar_id:'synthetic_calendar_1',name:'<script>Synthetic literal calendar</script>',status:'idle',snapshot_complete:true,freshness:'recent',last_successful_sync:new Date().toISOString()}]}};
 await page.reload();await ready();assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=partial]').count(),1);const collectionText=await page.locator('.google-collection-status').innerText();assert.match(collectionText,/Latest download complete/);assert.match(collectionText,/Recently checked/);assert.match(collectionText,/<script>Synthetic literal calendar<\/script>/);assert.doesNotMatch(await page.locator('#connections').innerText(),/no events synced yet/i);assert.match(await page.locator('#google-events').innerText(),/<script>Synthetic all-day class<\/script>/);assert.match(await page.locator('#google-events').innerText(),/2026-11-02 · All day through 2026-11-03/);assert.match(await page.locator('#google-source-coverage').innerText(),/Some events or recurring dates could not be shown/);assert.match(await page.locator('#google-source-coverage').innerText(),/out of date/);
 await page.unroute('**/api/google/upcoming?*');await page.route('**/api/google/upcoming?*',route=>route.fulfill({json:{ok:true,snapshot_complete:true,last_successful_sync:new Date().toISOString(),freshness:'recent',coverage:{complete:true},events:[]}}));
 await page.reload();await ready();assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=ready]').count(),1);
 googleState.collection.calendars[0].freshness='stale';await page.reload();await ready();assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=stale]').count(),1);
 googleState.collection.calendars[0].snapshot_complete=false;googleState.collection.calendars[0].last_successful_sync=null;await page.reload();await ready();assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=syncing]').count(),1);
 googleState.collection.calendars[0].snapshot_complete=true;googleState.collection.calendars[0].last_successful_sync=new Date().toISOString();
 passed.push('calendar milestone: consent, choice, collection setup, initial sync, ready, stale and limited coverage reflect server evidence');
 googleState.collection.calendars[0].status='backoff';googleState.collection.calendars[0].freshness='stale';googleState.collection.scheduler.error='collection_global_limit';await page.reload();await ready();assert.match(await page.locator('.google-collection-status').innerText(),/Saved snapshot may be out of date/);assert.match(await page.locator('.google-collection-status').innerText(),/resume automatically/);
 googleState.collection.scheduler={status:'paused',next_run_at:null,error:'collection_unavailable'};googleState.collection.calendars[0].status='paused';await page.reload();await ready();assert.match(await page.locator('.google-collection-status').innerText(),/Checks paused after repeated failures/);
 await page.screenshot({path:join(evidence,'google-collection-status.png'),fullPage:true});passed.push('synthetic collection UI: literal names/events, all-day exclusive ends, incomplete recurrence, complete-check date, stale snapshot, request-limit wait and paused scheduler');
 delete googleState.collection;googleState.status='authorized_not_synced';await page.reload();await ready();
 const kept=page.getByRole('checkbox',{name:'Keep <script>Synthetic literal calendar</script>',exact:true});await kept.uncheck();await kept.check();
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();assert.equal(await kept.isChecked(),false);
 assert.deepEqual(googleSelection.record.calendar_ids,['synthetic_calendar_1']);
 await page.getByRole('button',{name:'Save calendar selection',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Calendar selection saved and verified'));
 assert.deepEqual(googleSelection.record.calendar_ids,[]);assert.equal(selectionWrites,2);
 passed.push('synthetic calendar selection: explicit choice, reload, lost-response receipt recovery without resending, draft-only clear and confirmed empty save');
 await page.getByRole('button',{name:'Save calendar selection',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#recovery').hidden);assert.equal(selectionWrites,3);
 await page.unroute('**/api/google/calendars?*');
 await page.getByRole('button',{name:'Remove saved Google access',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Saved Google access removed locally'));
 assert.equal(disconnectPacket.expected_revision,3);assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=disconnected]').count(),1);assert.match(await page.locator('#connections').innerText(),/Saved access removed/);
 await page.reload();await ready();await reconcile();assert.equal(selectionWrites,4);assert.equal((await stored()).length,0);
 assert.match(await page.locator('#notice').innerText(),/A pending calendar selection was not saved/);
 assert.equal(googleSelection.revision,2);
 await page.screenshot({path:join(evidence,'google-rejected-selection.png'),fullPage:true});
 passed.push('interrupted selection followed by disconnect: exact replay, terminal rejection receipt and explicit not-applied message');
 googleState={...googleState,status:'authorized',authorized:true,revision:5};
 googleSelection={...googleSelection,record:{calendar_ids:['synthetic_calendar_1','synthetic_calendar_2'],calendars:[{id:'synthetic_calendar_1',summary:'Saved first calendar'},{id:'synthetic_calendar_2',summary:'Saved second calendar'}]}};
 await page.reload();await ready();await page.getByRole('checkbox',{name:'Keep Saved first calendar',exact:true}).uncheck();await page.getByRole('button',{name:'Save calendar selection',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Calendar selection saved and verified'));assert.deepEqual(googleSelection.record.calendar_ids,['synthetic_calendar_2']);
 passed.push('saved calendar choice can be removed individually after reload without another provider discovery');

 await page.route('**/api/google/revoke',route=>{const packet=route.request().postDataJSON();assert.equal(packet.connection_id,source);assert.equal(packet.expected_revision,5);assert.ok(packet.attempt_id);googleState={...googleState,status:'revoking',authorized:false,authorization_blocked:true,revocation:{state:'pending'}};return route.fulfill({json:{ok:true,revocation:googleState.revocation}});});
 await page.reload();await ready();assert.match(await page.locator('#connections').innerText(),/including its other connections/);
 await page.getByRole('button',{name:'Revoke Google permission and disconnect',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Google permission removal requested'));
 assert.match(await page.locator('#connections').innerText(),/queued or retrying automatically/);assert.equal(await page.locator('#calendar-today-status [data-calendar-stage=removing]').count(),1);assert.equal(await page.getByRole('button',{name:'Authorize Google Calendar',exact:true}).count(),0);
 googleState={...googleState,status:'disconnected',authorization_blocked:false,revocation:{state:'confirmed'}};await page.reload();await ready();assert.match(await page.locator('#connections').innerText(),/Google confirmed the permission removal/);
 googleState.revocation={state:'unconfirmed'};await page.reload();await ready();assert.match(await page.locator('#connections').innerText(),/permission removal is unconfirmed/);assert.equal(await page.getByRole('link',{name:'Review Google Account connections'}).getAttribute('href'),'https://myaccount.google.com/connections');
 await page.screenshot({path:join(evidence,'google-removal-status.png'),fullPage:true});await page.unroute('**/api/google/revoke');
 passed.push('Google removal: scope warning, explicit request, pending reconnect block, confirmed versus unconfirmed status and manual cleanup link');
 for(const pattern of ['**/api/receipts/*','**/api/google/selection','**/api/google/selection?*','**/api/onboarding','**/api/google/status?*','**/api/google/upcoming?*','**/api/google/prepare','**/api/google/begin','**/api/google/disconnect','https://accounts.google.com/**'])await page.unroute(pattern);
 await page.reload();await ready();
 passed.push('synthetic consent UI: explicit permission, bounded Google destination, unsynced status, paged literal calendar names and local-disconnect wording');
 const calendarDate=offset=>new Date(Date.now()+7*86400000+offset).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z');
 const ics=title=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nDTSTART:${calendarDate(0)}\r\nDTEND:${calendarDate(3600000)}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
 for(const title of ['Synthetic first event','Synthetic replacement event']){
  await go('/onboarding/connections');await page.locator('#calendar-form [name=course_id]').selectOption(course);await page.locator('#source-select').selectOption(source);
  await page.locator('#calendar-form [name=ics]').setInputFiles({name:'synthetic.ics',mimeType:'text/calendar',buffer:Buffer.from(ics(title))});
  await page.locator('#calendar-form button').click();await settled();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Saved and verified'));
 }
 assert.match(await page.locator('#events').innerText(),/Synthetic replacement event/);assert.doesNotMatch(await page.locator('#events').innerText(),/Synthetic first event/);
 passed.push('empty onboarding, profile/course saves and simultaneous-submit protection, source honesty, calendar replacement');
 // Server committed; deliberately drop the response, then close the whole browser.
 let committedPacket;
 await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT'){committedPacket=route.request().postDataJSON();await route.fetch();await route.abort('failed');}else await route.continue();});
 await go('/notes');await page.locator('#material-form [name=course_id]').selectOption(course);
 await page.locator('#material-form [name=title]').fill('Synthetic notes');await page.locator('#material-form [name=text]').fill('Disposable synthetic material A.');
 await page.locator('#material-form button').click();await settled();assert.equal((await stored()).length,1);
 await context.close();await launch();assert.equal((await stored())[0].intents[0].packet.operation_id,committedPacket.operation_id);
 await page.screenshot({path:join(evidence,'recovery-after-restart.png'),fullPage:true});
 let replayed=0;await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT')replayed++;await route.continue();});
 await reconcile();assert.equal(replayed,0);assert.equal((await stored()).length,0);assert.equal((await snapshot()).data.materials.length,1);
 passed.push('response loss + browser restart: receipt reconciliation without duplicate send');
 // Tutor exercises use the actual Worker/store with a fixture-only model binding.
 await go('/tutor');await page.locator('#tutor-load').click();await page.waitForFunction(()=>document.querySelector('#tutor-status').textContent.includes('remaining today'));
 await page.locator('#tutor-materials input').check();await page.locator('#tutor-message').fill('Teach me from these synthetic notes.');await page.locator('#tutor-consent').check();
 let tutorPacket;await page.route('**/api/tutor',async route=>{if(route.request().method()==='POST'){tutorPacket=route.request().postDataJSON();await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('#tutor-send').click();await page.waitForFunction(()=>document.querySelector('#tutor-status').textContent.includes('Result not confirmed'));
 await page.unroute('**/api/tutor');await page.locator('#tutor-recover').click();await page.waitForFunction(()=>document.querySelector('#tutor-status').textContent.includes('Recovered your saved session'));
 assert.match(await page.locator('#tutor-check').innerText(),/Which material is selected/);assert.match(await page.locator('#tutor-thread').innerText(),/0 independently correct/);
 await page.getByRole('button',{name:'An unrelated website',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tutor-status').textContent.includes('Saved to your private tutor session'));assert.match(await page.locator('#tutor-thread').innerText(),/1 incorrect/);
 await page.reload();await ready();await page.locator('#tutor-load').click();await page.waitForFunction(()=>document.querySelector('#tutor-thread').textContent.includes('1 incorrect'));assert.match(await page.locator('#tutor-thread').innerText(),/0 independently correct/);
 await page.locator('#tutor-consent').check();await page.locator('#tutor-message').fill('Continue with the next concept.');await page.locator('#tutor-send').click();await page.waitForFunction(()=>document.querySelector('#tutor-check').textContent.includes('Which material'));
 await page.getByRole('button',{name:'Show a source hint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tutor-thread').textContent.includes('Source hint'));
 await page.getByRole('button',{name:'Synthetic material A',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tutor-thread').textContent.includes('1 correct with help'));
 await page.getByText('Use another AI assistant',{exact:true}).click();await page.locator('#tutor-handoff').click();await page.waitForFunction(()=>!document.querySelector('#tutor-handoff-text').hidden);assert.match(await page.locator('#tutor-handoff-text').inputValue(),/Disposable synthetic material A/);
 await page.screenshot({path:join(evidence,'tutor-session.png'),fullPage:true});
 passed.push('actual tutor: selected sources, durable response-loss recovery, wrong-answer exclusion, assisted checks, reload resume and manual provider handoff');

 // Request never reached storage. Preserve the packet across identity changes.
 await page.unroute('**/api/materials');let originalPacket;
 await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT'){originalPacket=route.request().postDataJSON();await route.abort('failed');}else await route.continue();});
 await go('/notes');await page.locator('#material-form [name=course_id]').selectOption(course);await page.locator('#material-form [name=title]').fill('Reconnect notes');await page.locator('#material-form [name=text]').fill('Synthetic pending content.');
 await page.locator('#material-form button').click();await settled();const pendingA=await stored();assert.equal(pendingA.length,1);
 await page.getByRole('link',{name:'Student B',exact:true}).click();await ready();assert.equal((await snapshot()).account_revision,0);assert.equal(await page.locator('#material-list .row').count(),0);assert.equal(await page.locator('#recovery').isVisible(),false);assert.deepEqual(await stored(),pendingA);
 await submit('#course-form',{code:'SYN 202',title:'Student B only',section:'B',term_id:'fall-2026'});const bSaved=await snapshot();
 await page.screenshot({path:join(evidence,'student-b.png'),fullPage:true});
 await page.getByRole('link',{name:'Student A',exact:true}).click();await ready();assert.equal(await page.locator('#recovery').isVisible(),true);
 await context.setOffline(true);await context.setOffline(false);await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Connection restored'));
 await page.unroute('**/api/materials');let retries=0;await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT'){retries++;assert.deepEqual(route.request().postDataJSON(),originalPacket);}await route.continue();});
 await reconcile();assert.equal(retries,1);assert.equal((await snapshot()).data.materials.length,2);assert.equal((await stored()).length,0);
 passed.push('A/B separation, hidden foreign outbox, explicit reconnect and exact missing-receipt replay');
 // Another tab changes the identity cookie. The stale A tab must not write to B.
 const other=await context.newPage();await other.goto(root+'/__demo/student/b');
 await go('/onboarding/courses');await page.locator('#course-form [name=code]').fill('STALE');await page.locator('#course-form [name=title]').fill('Must not save');await page.locator('#course-form [name=section]').fill('A');await page.locator('#course-form [name=term_id]').fill('fall-2026');
 await page.locator('#course-form button').click();await settled();assert.match(await page.locator('#notice').innerText(),/sign-in changed/);assert.deepEqual(await snapshot(),bSaved);
 await other.goto(root+'/__demo/student/a');await other.close();await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Workspace refreshed.');
 passed.push('stale account tab rejected by server workspace guard');
 // A delayed A read must not overwrite a newer, fully rendered B refresh.
 await page.unroute('**/api/materials');
 await page.evaluate(()=>{const fetchOriginal=window.fetch;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);const read=response.json.bind(response);response.json=async()=>{const data=await read();if(data.qa_delayed_refresh)window.qaOldRefreshConsumed=true;return data;};return response;};});
 let releaseRead,readHeld;const readGate=new Promise(r=>releaseRead=r);const readStarted=new Promise(r=>readHeld=r);let holdRead=true;
 await page.route('**/api/materials',async route=>{if(route.request().method()==='GET' && holdRead){holdRead=false;const response=await route.fetch();const data=await response.json();data.qa_delayed_refresh=true;readHeld();await readGate;await route.fulfill({response,json:data});}else await route.continue();});
 await page.locator('#refresh').click();await readStarted;
 const switching=await context.newPage();await switching.goto(root+'/__demo/student/b');
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#courses').textContent.includes('Student B only') && document.querySelector('#notice').textContent==='Workspace refreshed.');
 releaseRead();await page.waitForFunction(()=>window.qaOldRefreshConsumed===true);
 assert.equal(await page.locator('#material-list .row').count(),0);assert.match(await page.locator('#courses').innerText(),/Student B only/);
 passed.push('delayed A refresh cannot overwrite newer B screen');
 await page.unroute('**/api/materials');await switching.goto(root+'/__demo/student/a');await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#welcome').textContent==='Welcome, Synthetic Student A' && document.querySelector('#notice').textContent==='Workspace refreshed.');
 // Capture calendar identity before every asynchronous file/read preparation step.
 await page.evaluate(()=>{const text=File.prototype.text;File.prototype.text=async function(){window.qaFileWaiting=true;await new Promise(r=>window.qaReleaseFile=r);return text.call(this);};});
 await go('/onboarding/connections');await page.locator('#calendar-form [name=course_id]').selectOption(course);await page.locator('#source-select').selectOption(source);
 await page.locator('#calendar-form [name=ics]').setInputFiles({name:'synthetic.ics',mimeType:'text/calendar',buffer:Buffer.from(ics('Must not reach B'))});
 const calendarAttempts=[];await page.route('**/api/calendar/import',async route=>{calendarAttempts.push(route.request().postDataJSON());await route.continue();});
 await page.locator('#calendar-form button').click();await page.waitForFunction(()=>window.qaFileWaiting===true);
 await switching.goto(root+'/__demo/student/b');await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#courses').textContent.includes('Student B only') && document.querySelector('#notice').textContent==='Workspace refreshed.');
 await page.evaluate(()=>window.qaReleaseFile());await settled();assert.equal(calendarAttempts.length,0);assert.match(await page.locator('#notice').innerText(),/sign-in changed/);assert.deepEqual(await snapshot(),bSaved);
 passed.push('identity change during file preparation prevents calendar request and foreign outbox');
 await page.unroute('**/api/calendar/import');await switching.goto(root+'/__demo/student/a');await switching.close();
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#welcome').textContent==='Welcome, Synthetic Student A' && document.querySelector('#notice').textContent==='Workspace refreshed.');

 await page.screenshot({path:join(evidence,'student-a.png'),fullPage:true});
 await go('/settings');const exportPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await exportPromise;await download.saveAs(join(evidence,'synthetic-export.json'));const exported=JSON.parse(await readFile(join(evidence,'synthetic-export.json'),'utf8'));assert.equal(exported.data.materials.length,2);
 passed.push('rendered export downloads current workspace');
 // An export response for A must not download after the current tab refreshes B.
 let releaseExport,exportHeld;const exportGate=new Promise(r=>releaseExport=r);const exportStarted=new Promise(r=>exportHeld=r);let holdExport=true;const unexpectedDownloads=[];
 const trackDownload=download=>unexpectedDownloads.push(download);page.on('download',trackDownload);
 await page.route('**/api/account/export',async route=>{if(holdExport){holdExport=false;const response=await route.fetch();exportHeld();await exportGate;await route.fulfill({response});}else await route.continue();});
 await page.locator('#export').click();await exportStarted;const exportSwitch=await context.newPage();await exportSwitch.goto(root+'/__demo/student/b');
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#courses').textContent.includes('Student B only') && document.querySelector('#notice').textContent==='Workspace refreshed.');
 releaseExport();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('sign-in changed'));assert.equal(unexpectedDownloads.length,0);assert.deepEqual(await snapshot(),bSaved);
 passed.push('delayed A export is not downloaded after B becomes the current workspace');
 page.off('download',trackDownload);await page.unroute('**/api/account/export');await exportSwitch.goto(root+'/__demo/student/a');await exportSwitch.close();
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#welcome').textContent==='Welcome, Synthetic Student A' && document.querySelector('#notice').textContent==='Workspace refreshed.');

 // Delete succeeds server-side, but its response is lost. Restart and recover.
 await page.route('**/api/account',async route=>{if(route.request().method()==='DELETE'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await go('/settings');await page.locator('#privacy summary').click();await page.locator('#delete-confirm').fill('DELETE_MY_WORKSPACE');await page.locator('#delete').click();await page.waitForFunction(()=>!document.querySelector('#delete').disabled);assert.equal((await stored()).length,1);
 await context.close();await launch();await reconcile();assert.equal((await snapshot()).deleted,true);assert.equal((await stored()).length,0);
 await page.getByRole('link',{name:'Student B',exact:true}).click();await ready();assert.deepEqual(await snapshot(),bSaved);
 passed.push('lost deletion response + browser restart: deletion receipt recovery, local cleanup, B unchanged');
 assert.deepEqual(errors,[]);
 const report={browser:context.browser()?.version() || await page.evaluate(()=>navigator.userAgent),passed,pageErrors:errors};
 await writeFile(join(evidence,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));console.log('Evidence: '+evidence);
}catch(error){
 if(page&&!page.isClosed())console.error(JSON.stringify({notice:await page.locator('#notice').innerText(),daily:await page.locator('#daily-groups').innerText(),pageErrors:errors}));
 throw error;
}finally{
 if(context)await context.close();try{process.kill(-demo.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}await new Promise(r=>demo.exitCode!==null?r():demo.once('exit',r));await rm(profile,{recursive:true,force:true});
}
