// Rendered synthetic QA. Browser profiles, exports and screenshots stay outside Git.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, realpath, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../',import.meta.url));
const evidence=resolve(process.env.BROWSER_EVIDENCE_DIR || await mkdtemp(join(tmpdir(),'school-bridge-browser-evidence-')));
await mkdir(evidence,{recursive:true});
const location=relative(await realpath(repository),await realpath(evidence));
if(!location.startsWith('..'))throw new Error('Browser evidence must be outside the repository.');
const profile=await mkdtemp(join(tmpdir(),'school-bridge-synthetic-browser-'));
const port=process.env.DEMO_PORT || '8767';const root=`http://127.0.0.1:${port}`;
const demo=spawn('npm',['run','demo'],{cwd:repository,env:{...process.env,DEMO_PORT:port},stdio:['ignore','pipe','pipe'],detached:true});
let demoLog='';demo.stdout.on('data',b=>demoLog+=b);demo.stderr.on('data',b=>demoLog+=b);
let context,page;const errors=[];const passed=[];
const ready=()=>page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('ready'));
const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('form button')].some(b=>b.disabled));
const snapshot=()=>page.evaluate(async()=>{const data=await (await fetch('/api/account/export')).json();delete data.exported_at;return data;});
const stored=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('school-bridge-outbox-v1:')).map(k=>JSON.parse(localStorage.getItem(k))));
async function launch(){context=await chromium.launchPersistentContext(profile,{executablePath:process.env.BROWSER_EXECUTABLE || '/usr/bin/chromium',headless:true,acceptDownloads:true,args:['--no-sandbox']});page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await page.goto(root);await ready();}
async function submit(id,values){for(const [key,value] of Object.entries(values))await page.locator(`${id} [name="${key}"]`).fill(value);await page.locator(id).evaluate(form=>{form.requestSubmit();form.requestSubmit();});await settled();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Saved and verified'));}
async function reconcile(){await page.locator('#reconcile').click();await page.waitForFunction(()=>!document.querySelector('#reconcile').disabled && document.querySelector('#recovery').hidden);}
try{
 for(let attempt=0;attempt<100;attempt++){if(demo.exitCode!==null)throw new Error(demoLog);try{if(demoLog.includes('Synthetic-only School Bridge: '+root) && (await fetch(root+'/health')).ok)break;}catch{}if(attempt===99)throw new Error('Synthetic demo startup timed out');await new Promise(r=>setTimeout(r,100));}
 await launch();assert.equal((await snapshot()).account_revision,0);
 await page.locator('#profile-form [name=consent]').check();await submit('#profile-form',{display_name:'Synthetic Student A',timezone:'America/New_York'});
 await submit('#course-form',{code:'SYN 101',title:'Synthetic course',section:'A',term_id:'fall-2026'});
 await submit('#connection-form',{site_url:'https://school.example.invalid'});
 assert.match(await page.locator('#connections').innerText(),/Needs authorization/);
 const course=await page.locator('#material-form [name=course_id] option').nth(1).getAttribute('value');
 const source=await page.locator('#source-select option').nth(1).getAttribute('value');
 const calendarDate=offset=>new Date(Date.now()+7*86400000+offset).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z');
 const ics=title=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nDTSTART:${calendarDate(0)}\r\nDTEND:${calendarDate(3600000)}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
 for(const title of ['Synthetic first event','Synthetic replacement event']){
  await page.locator('#calendar-form [name=course_id]').selectOption(course);await page.locator('#source-select').selectOption(source);
  await page.locator('#calendar-form [name=ics]').setInputFiles({name:'synthetic.ics',mimeType:'text/calendar',buffer:Buffer.from(ics(title))});
  await page.locator('#calendar-form button').click();await settled();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Saved and verified'));
 }
 assert.match(await page.locator('#events').innerText(),/Synthetic replacement event/);assert.doesNotMatch(await page.locator('#events').innerText(),/Synthetic first event/);
 passed.push('empty onboarding, profile/course saves and simultaneous-submit protection, source honesty, calendar replacement');
 // Server committed; deliberately drop the response, then close the whole browser.
 let committedPacket;
 await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT'){committedPacket=route.request().postDataJSON();await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('#material-form [name=course_id]').selectOption(course);
 await page.locator('#material-form [name=title]').fill('Synthetic notes');await page.locator('#material-form [name=text]').fill('Disposable synthetic material A.');
 await page.locator('#material-form button').click();await settled();assert.equal((await stored()).length,1);
 await context.close();await launch();assert.equal((await stored())[0].intents[0].packet.operation_id,committedPacket.operation_id);
 await page.screenshot({path:join(evidence,'recovery-after-restart.png'),fullPage:true});
 let replayed=0;await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT')replayed++;await route.continue();});
 await reconcile();assert.equal(replayed,0);assert.equal((await stored()).length,0);assert.equal((await snapshot()).data.materials.length,1);
 passed.push('response loss + browser restart: receipt reconciliation without duplicate send');
 // Request never reached storage. Preserve the packet across identity changes.
 await page.unroute('**/api/materials');let originalPacket;
 await page.route('**/api/materials',async route=>{if(route.request().method()==='PUT'){originalPacket=route.request().postDataJSON();await route.abort('failed');}else await route.continue();});
 await page.locator('#material-form [name=course_id]').selectOption(course);await page.locator('#material-form [name=title]').fill('Reconnect notes');await page.locator('#material-form [name=text]').fill('Synthetic pending content.');
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
 await page.locator('#course-form [name=code]').fill('STALE');await page.locator('#course-form [name=title]').fill('Must not save');await page.locator('#course-form [name=section]').fill('A');await page.locator('#course-form [name=term_id]').fill('fall-2026');
 await page.locator('#course-form button').click();await settled();assert.match(await page.locator('#notice').innerText(),/sign-in changed/);assert.deepEqual(await snapshot(),bSaved);
 await other.goto(root+'/__demo/student/a');await other.close();await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Workspace refreshed.');
 passed.push('stale account tab rejected by server workspace guard');
 await page.screenshot({path:join(evidence,'student-a.png'),fullPage:true});
 const exportPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await exportPromise;await download.saveAs(join(evidence,'synthetic-export.json'));const exported=JSON.parse(await readFile(join(evidence,'synthetic-export.json'),'utf8'));assert.equal(exported.data.materials.length,2);
 passed.push('rendered export downloads current workspace');
 // Delete succeeds server-side, but its response is lost. Restart and recover.
 await page.route('**/api/account',async route=>{if(route.request().method()==='DELETE'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('#privacy summary').click();await page.locator('#delete-confirm').fill('DELETE_MY_WORKSPACE');await page.locator('#delete').click();await page.waitForFunction(()=>!document.querySelector('#delete').disabled);assert.equal((await stored()).length,1);
 await context.close();await launch();await reconcile();assert.equal((await snapshot()).deleted,true);assert.equal((await stored()).length,0);
 await page.getByRole('link',{name:'Student B',exact:true}).click();await ready();assert.deepEqual(await snapshot(),bSaved);
 passed.push('lost deletion response + browser restart: deletion receipt recovery, local cleanup, B unchanged');
 assert.deepEqual(errors,[]);
 const report={browser:context.browser()?.version() || await page.evaluate(()=>navigator.userAgent),passed,pageErrors:errors};
 await writeFile(join(evidence,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));console.log('Evidence: '+evidence);
}finally{
 if(context)await context.close();try{process.kill(-demo.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}await new Promise(r=>demo.exitCode!==null?r():demo.once('exit',r));await rm(profile,{recursive:true,force:true});
}
