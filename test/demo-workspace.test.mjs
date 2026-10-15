import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from './runtime-fixture.mjs';

test('John demo uses real persisted app contracts while isolating both owners and ordinary records',async t=>{
 const r=await createRuntime();t.after(()=>r.close());
 const call=async(path,options={},status=200)=>{const res=await r.request(path,options),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;};
 const actual=await call('/api/onboarding');
 const before=await call('/api/account/export');
 const a=await call('/api/demo/start',{method:'POST',body:{}}),b=await call('/api/demo/start',{student:'b',method:'POST',body:{}});
 assert.notEqual(a.workspace_id,actual.workspace_id);assert.notEqual(a.workspace_id,b.workspace_id);
 const profile=await call('/api/demo/onboarding');assert.equal(profile.profile.preferred_name,'John');assert.equal(profile.courses.length,3);assert.equal(profile.capabilities.google_calendar_oauth,false);assert.equal(profile.capabilities.school_feeds,false);assert.equal(profile.capabilities.study_connector,false);
 assert.equal((await call('/api/demo/materials')).records.length,4);assert.equal((await call('/api/demo/calendar')).records[0].events.length,5);
 const daily=await call('/api/demo/daily');assert.equal(daily.personal.focus[0].id,'john-exam');assert.equal(daily.personal.focus[0].checkpoint.assistance,'independent');
 assert.equal((await call('/api/demo/learning?course_id=john-physics')).record.observations[0].outcome,'unassessed');
 const headers={'X-Workspace-Id':a.workspace_id};
 assert.equal((await call('/api/demo/study?course_id=john-physics',{headers})).record.response,'I think the force always points along the electric field.');
 for(const path of ['/api/demo/google/prepare','/api/demo/school-feeds','/api/demo/ai-access/approve','/api/demo/study-connector-preview'])await call(path,{method:'POST',headers,body:{}},403);
 await call('/api/demo/materials',{headers:{'X-Workspace-Id':actual.workspace_id}},403);await call('/api/materials',{headers},403);await call('/api/demo/materials',{student:'b',headers},403);
 const update=await call('/api/demo/materials',{method:'PUT',headers,body:{id:'john-field-notes',course_id:'john-physics',title:'Fictional revised notes A',text:'Fictional change only in A’s demo.',source_kind:'manual',operation_id:'synthetic-demo-edit',expected_revision:1}});
 assert.equal(update.ok,true);await call('/api/demo/start',{method:'POST',body:{}});
 assert.equal((await call('/api/demo/materials/john-field-notes')).record.revision,2);assert.equal((await call('/api/demo/materials/john-field-notes',{student:'b'})).record.revision,1);
 const after=await call('/api/account/export');assert.deepEqual(after.data,before.data);assert.equal(after.account_revision,before.account_revision);
 const exported=await call('/api/demo/account/export');await call('/api/demo/account',{method:'DELETE',headers,body:{confirm:'DELETE_MY_WORKSPACE',expected_revision:exported.account_revision,operation_id:'synthetic-demo-delete'}});
 await call('/api/demo/start',{method:'POST',body:{}},410);assert.equal((await call('/api/onboarding')).deleted,undefined);assert.equal((await call('/api/demo/onboarding',{student:'b'})).profile.preferred_name,'John');
});
