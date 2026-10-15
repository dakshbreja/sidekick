import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPersonalBriefing,fictionalSidekickDay} from '../src/personal-briefing.js';
import {StudentStore} from '../src/store.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
import {createRuntime} from './runtime-fixture.mjs';
const NOW=Date.parse('2026-10-14T16:00:00Z'),groups={overdue:[],due_today:[],upcoming:[]};
const profile={display_name:'Fictional Student',timezone:'UTC',consent_version:'synthetic-v1'};

test('fictional preview prioritizes exam preparation and labels targets as chosen goals',()=>{
 const d=fictionalSidekickDay();assert.equal(d.greeting,'Welcome back, John!');assert.equal(d.focus[0].id,'demo-exam');assert.equal(d.focus[1].progress,'in_progress');assert.equal(d.target_percent,85);assert.match(d.boundary,/not the whole portal/);
});
test('empty and stale feeds never imply a successful portal sweep',()=>{
 const make=sources=>buildPersonalBriefing({groups,sources,now:NOW});
 assert.match(make([]).source_summary,/No eLC feeds connected/);
 assert.match(make([{status:'connected'}]).source_summary,/first successful check.*pending/);
 assert.match(make([{status:'error',freshness:'stale',last_successful_sync:'2026-10-10T00:00:00Z'}]).source_summary,/need attention/);
 assert.equal(make([]).latest_checked_at,null);
});
test('urgent deadlines outrank later exams and simulated checkpoints never supply learning history',()=>{
 const items=[{id:'exam',course_id:'c',work_kind:'exam',due_at:'2026-10-19T14:00:00Z'},{id:'today',course_id:'c',due_at:'2026-10-14T20:00:00Z'}];
 const d=buildPersonalBriefing({groups:{...groups,upcoming:items},now:NOW,checkpoints:[{course_id:'c',test_only:true,next_step:'Simulation must not leak'},{course_id:'c',test_only:false,next_step:'Real saved step',source_status:'changed'}]});
 assert.equal(d.focus[0].id,'today');assert.equal(d.focus[0].checkpoint.next_step,'Real saved step');assert.equal(d.focus[0].checkpoint.source_status,'changed');
});
test('SQLite briefing uses the full chosen exam window, excludes reported submission, and preserves legacy retry',async t=>{
 const f=sqliteFixture();t.after(f.close);const store=new StudentStore(f.storage,{clock:()=>new Date(NOW).toISOString()});
 const write=(op,data,expectedRevision=0,operationId=crypto.randomUUID())=>store.dispatch({tenantId:'synthetic-personal-owner',op,data,expectedRevision,operationId});
 assert.equal((await write('profile.put',profile,0,'synthetic-old-profile')).ok,true);
 assert.equal((await write('profile.put',profile,0,'synthetic-old-profile')).replayed,true);
 assert.equal((await write('profile.put',{...profile,preferred_name:'Sam',exam_prep_days:14},1)).ok,true);
 await write('courses.put',{id:'course',code:'SYN 1',title:'Synthetic course',section:'A',term_id:'synthetic-term'});
 const exam={id:'exam',course_id:'course',title:'Synthetic exam',due_at:'2026-10-26T16:00:00Z',all_day:false,work_kind:'exam'};
 assert.equal((await write('assignments.put',exam)).ok,true);
 let daily=await store.dispatch({tenantId:'synthetic-personal-owner',op:'daily.get',data:{}});
 assert.equal(daily.groups.upcoming.length,0);assert.equal(daily.personal.focus[0].id,'exam');assert.equal(daily.personal.greeting,'Welcome back, Sam!');
 assert.equal((await write('progress.put',{id:'daily_exam',assignment_id:'exam',course_id:'course',title:exam.title,status:'done',submitted:true,verification:'reported',note:'Synthetic completed requirement.'})).ok,true);
 daily=await store.dispatch({tenantId:'synthetic-personal-owner',op:'daily.get',data:{}});assert.equal(daily.personal.focus.length,0);
 for(const [field,value] of [['study_session_minutes',9],['exam_prep_days',31],['exam_target_percent',101],['exam_target_percent','85']])assert.equal((await write('profile.put',{...profile,[field]:value},2)).error,'invalid_study_preference');
});
test('actual Worker keeps personalized briefing private between signed owners and demo reads create no records',async t=>{
 const r=await createRuntime();t.after(()=>r.close());
 const request=async(path,options={})=>{const response=await r.request(path,options),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 for(const [student,name] of [['a','Avery'],['b','Blair']]){
  await request('/api/onboarding',{student,method:'PUT',body:{...profile,preferred_name:name,study_session_minutes:student==='a'?20:40,exam_prep_days:10,exam_target_percent:85,operation_id:'synthetic-profile-save',expected_revision:0}});
  await request('/api/courses',{student,method:'PUT',body:{id:'same-course',code:'SYN 1',title:'Synthetic '+name,section:'A',term_id:'synthetic-term',operation_id:'synthetic-course-save',expected_revision:0}});
  await request('/api/assignments',{student,method:'PUT',body:{id:'same-exam',course_id:'same-course',title:name+' synthetic exam',due_at:new Date(Date.now()+9*86400000).toISOString(),all_day:false,work_kind:'exam',operation_id:'synthetic-exam-save',expected_revision:0}});
 }
 for(const [student,name,other] of [['a','Avery','Blair'],['b','Blair','Avery']]){
  const d=await request('/api/daily',{student});assert.equal(d.personal.greeting,'Welcome back, '+name+'!');assert.equal(d.personal.focus[0].title,name+' synthetic exam');assert.doesNotMatch(JSON.stringify(d),new RegExp(other));
  const before=await request('/api/account/export',{student});const demo=await r.request('/demo',{student});assert.equal(demo.status,200);assert.match(await demo.text(),/Sidekick/);const after=await request('/api/account/export',{student});assert.equal(after.account_revision,before.account_revision);assert.deepEqual(after.data,before.data);
 }
});
