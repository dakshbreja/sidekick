import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntime} from './runtime-fixture.mjs';
import {studyProtocol} from '../src/study-connector.js';
import {StudentStore} from '../src/store.js';
import {sqliteFixture} from './sqlite-fixture.mjs';
import {tutorPrompt} from '../src/tutor.js';

export const sourceText='Synthetic inventory practice: demand of 10 units per day for 3 days requires 30 units before any safety stock. A buffer of 5 raises the reorder point to 35 units.';
export const checkpoint=()=>({course_id:'synthetic-course',session_id:'synthetic-session',topic:'Inventory reasoning',question:'Explain why the reorder point is 35, including the buffer.',response:'Ten each day for three days gives 30 units.',assistance:'independent',test_only:true,next_step:'Explain the missing five-unit buffer, then try a different lead time.',sources:[{material_id:'synthetic-material',revision:1,start:0,end:sourceText.length}],criteria:[{criterion:'Demand during lead time',verdict:'met',evidence_quote:'three days gives 30 units',reason:'Correctly combines daily demand with lead time.'},{criterion:'Safety stock',verdict:'not_evidenced',evidence_quote:'',reason:'The response omits the buffer and final reorder point.'}]});
const call=(name,args)=>({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args}});
const write=data=>({operation_id:crypto.randomUUID(),expected_revision:0,...data});

test('connector permissions and strict arguments cannot select owners or arbitrary backend operations',async()=>{
  let calls=0;
  const dispatch=async()=>{calls++;return {ok:true};};
  const noScope=await studyProtocol(call('study_resume',{course_id:'x'}),{dispatch});
  assert.equal(noScope.error.message,'study_read_permission_required');
  const readOnly={dispatch,scopes:['study:read']};
  const list=await studyProtocol({jsonrpc:'2.0',id:1,method:'tools/list' },readOnly);
  assert.ok(!list.result.tools.some(t=>t.name==='study_save_checkpoint'));
  assert.equal((await studyProtocol(call('study_save_checkpoint',write(checkpoint())),readOnly)).result.isError,true);
  for(const args of [{course_id:'x',tenantId:'synthetic_other_owner'},{course_id:'x',owner:'other'},{student_id:'other'},{}])assert.equal((await studyProtocol(call('study_resume',args),readOnly)).result.isError,true);
  assert.equal((await studyProtocol(call('account.delete',{}),readOnly)).error.code,-32602);
  assert.equal((await studyProtocol({...call('study_resume',{course_id:'x'}),id:undefined},readOnly)).error.code,-32600);
  assert.equal(calls,0);
});

test('real Worker/SQLite connector save, website readback, restart, identity isolation and deletion',async t=>{
  const persistPath=await mkdtemp(join(tmpdir(),'bridge-study-synthetic-'));
  let rt=await createRuntime({persistPath,bindings:{STUDY_CONNECTOR_PREVIEW:'true'}});
  t.after(async()=>{await rt.close();await rm(persistPath,{recursive:true,force:true});});
  const owners={};
  const req=async(path,{student='a',status=200,...options}={})=>{const res=await rt.request(path,{...options,student,headers:{'X-Workspace-Id':owners[student],...options.headers}});const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;};
  const rpc=async(name,args,student='a')=>{const r=await req('/api/study-connector-preview',{student,method:'POST',body:call(name,args)});return r.result?.structuredContent??r;};
  for(const student of ['a','b']) {
    owners[student]=(await(await rt.request('/api/onboarding',{student})).json()).workspace_id;
    await req('/api/courses',{student,method:'PUT',body:write({id:'synthetic-course',code:'SYN101',title:'Synthetic course '+student,section:student,term_id:'synthetic-term'})});
    await req('/api/materials',{student,method:'PUT',body:write({id:'synthetic-material',course_id:'synthetic-course',title:'Synthetic notes '+student,text:student==='a'?sourceText:'Private synthetic B-only content.',source_kind:'manual'})});
  }
  const packet=write(checkpoint());
  let saved;
  await t.test('protocol initialization and source reads are bounded, versioned and scoped',async()=>{
    const init=await req('/api/study-connector-preview',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'synthetic-client',version:'1'},capabilities:{}}}});
    assert.equal(init.result.protocolVersion,'2025-06-18');
    assert.match(init.result.instructions,/correct choice or self-report alone/);
    assert.equal((await rpc('study_list_courses',{})).records[0].section,'a');
    assert.equal((await rpc('study_list_materials',{course_id:'synthetic-course'})).records[0].text,undefined);
    const data={course_id:'synthetic-course',material_id:'synthetic-material',revision:1};
    assert.equal((await rpc('study_read_material',data)).text,sourceText);
    assert.equal((await rpc('study_read_material',data,'b')).text,'Private synthetic B-only content.');
    assert.equal((await rpc('study_read_material',{...data,course_id:'another-course'})).error,'course_not_found');
    assert.equal((await rpc('study_read_material',{...data,revision:2})).error,'source_revision_conflict');
  });
  await t.test('course names resolve uniquely and repeated terms or sections require clarification',async()=>{
    const first=await rpc('study_resume',{course_query:'SYN 101'});
    assert.equal(first.ok,true);assert.equal(first.resolved_course.id,'synthetic-course');
    // Backward-compatible recovery for a model that still puts the code in course_id.
    assert.equal((await rpc('study_resume',{course_id:'syn 101'})).resolved_course.id,'synthetic-course');
    await req('/api/courses',{method:'PUT',body:write({id:'synthetic-course-2',code:'SYN101',title:'Synthetic second section',section:'other',term_id:'synthetic-term'})});
    await req('/api/courses',{method:'PUT',body:write({id:'synthetic-course-3',code:'SYN101',title:'Synthetic later term',section:'a',term_id:'later-term'})});
    const ambiguous=await rpc('study_resume',{course_query:'SYN101'});
    assert.equal(ambiguous.error,'course_ambiguous');assert.equal(ambiguous.candidates.length,3);assert.equal(ambiguous.record,undefined);
    assert.equal((await rpc('study_resume',{course_query:'SYN101',term_id:'synthetic-term'})).error,'course_ambiguous');
    assert.equal((await rpc('study_resume',{course_query:'SYN101',term_id:'synthetic-term',section:'a'})).resolved_course.id,'synthetic-course');
    assert.equal((await rpc('study_resume',{course_query:'Synthetic course a'})).resolved_course.id,'synthetic-course');
    assert.equal((await rpc('study_resume',{course_query:'Synthetic course b'})).error,'course_not_found_or_not_authorized');
    assert.equal((await rpc('study_resume',{course_query:'SYN10'})).error,'course_not_found_or_not_authorized');
    assert.equal((await rpc('study_resume',{course_query:'SYN101',course_id:'synthetic-course'})).result.isError,true);
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course'})).resolved_course.id,'synthetic-course');
    assert.equal((await rpc('study_resume',{course_query:'SYN101'},'b')).resolved_course.section,'b');
  });
  await t.test('partial written reasoning saves through tools and appears in the website API without mastery credit',async()=>{
    saved=await rpc('study_save_checkpoint',packet);assert.equal(saved.ok,true);assert.equal(saved.revision,1);
    assert.equal(saved.record.assessment.outcome,'partial');assert.equal(saved.record.assessment.mastery,false);assert.equal(saved.record.assessment.authority,'assistant_report_unverified');
    assert.equal(saved.record.sources[0].text,sourceText);
    const website=await req('/api/study?course_id=synthetic-course&scope=test');assert.deepEqual(website.record,saved.record);
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course',session_id:'synthetic-session'})).record,saved.record);
    const tutor=await req('/api/tutor?course_id=synthetic-course');assert.deepEqual(tutor.session.summary,{correct:0,assisted_correct:0,incorrect:0});
    const exp=await req('/api/account/export');assert.deepEqual(exp.data.progress,[]);assert.deepEqual(exp.data.learning,[]);assert.deepEqual(exp.data.study_sessions,[saved.record]);
  });
  await t.test('default continuation excludes simulations; explicit test and session reads stay available',async()=>{
    assert.equal((await req('/api/study?course_id=synthetic-course')).record,null);
    assert.equal((await rpc('study_resume',{course_query:'Synthetic course a'})).record,null);
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course',session_id:packet.session_id})).record,saved.record);
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course',session_id:packet.session_id,scope:'learning'})).record,null);
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course',scope:'test'},'b')).record,null);
    await req('/api/study?course_id=synthetic-course&scope=all',{status:400});
    const learning=await rpc('study_save_checkpoint',write({...checkpoint(),session_id:'synthetic-learning-session',test_only:false}));
    assert.equal(learning.ok,true);
    const newerTest=await rpc('study_save_checkpoint',write({...checkpoint(),session_id:'synthetic-newer-test'}));
    assert.equal(newerTest.ok,true);
    assert.deepEqual((await req('/api/study?course_id=synthetic-course')).record,learning.record);
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course'})).record,learning.record);
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course',session_id:newerTest.record.session_id,scope:'test'})).record,newerTest.record);
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course',session_id:learning.record.session_id,scope:'test'})).record,null);
    assert.deepEqual((await req('/api/tutor?course_id=synthetic-course')).session.summary,{correct:0,assisted_correct:0,incorrect:0});
  });
  await t.test('lost responses, exact retries, changed packets and stale revisions preserve the original save',async()=>{
    assert.deepEqual((await rpc('study_get_receipt',{operation_id:packet.operation_id})).receipt,saved.receipt);
    const replay=await rpc('study_save_checkpoint',packet);assert.equal(replay.replayed,true);assert.equal(replay.account_revision,saved.account_revision);
    assert.equal((await rpc('study_save_checkpoint',{...packet,next_step:'Changed'})).error,'operation_id_conflict');
    assert.equal((await rpc('study_save_checkpoint',{...packet,operation_id:crypto.randomUUID()})).error,'revision_conflict');
    const invalid=await rpc('study_save_checkpoint',{...packet,operation_id:crypto.randomUUID(),expected_revision:1,criteria:[{...packet.criteria[0],evidence_quote:'Invented learner explanation'}]});
    assert.equal(invalid.error,'response_evidence_mismatch');
    assert.equal((await rpc('study_save_checkpoint',{...packet,operation_id:crypto.randomUUID(),expected_revision:1,test_only:false})).error,'immutable_identity');
    const unrelated=await req('/api/assignments',{method:'PUT',body:write({id:'synthetic-deadline',course_id:'synthetic-course',title:'Synthetic deadline',due_at:'2026-10-15T12:00:00.000Z',all_day:false})});
    assert.equal((await rpc('study_get_receipt',{operation_id:unrelated.receipt.operation_id})).error,'receipt_not_found');
    const deadlines=await rpc('study_read_deadlines',{course_id:'synthetic-course',limit:1});assert.equal(deadlines.records[0].progress,'unknown');assert.equal(deadlines.complete,true);
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course',session_id:'synthetic-session'})).record,saved.record);
  });
  await t.test('second account and stale account guards cannot read or overwrite the checkpoint or receipt',async()=>{
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course'},'b')).record,null);
    assert.equal((await rpc('study_get_receipt',{operation_id:packet.operation_id},'b')).error,'receipt_not_found');
    assert.equal((await req('/api/study?course_id=synthetic-course',{student:'b',status:403,headers:{'X-Workspace-Id':owners.a}})).error,'workspace_changed');
    await req('/api/study-connector-preview',{student:'b',method:'POST',body:call('study_save_checkpoint',packet),status:403,headers:{'X-Workspace-Id':owners.a}});
    await req('/api/study-connector-preview',{student:null,method:'POST',body:call('study_resume',{course_id:'synthetic-course'}),status:401});
    await req('/api/study-connector-preview',{method:'POST',body:call('study_resume',{course_id:'synthetic-course'}),status:403,headers:{Origin:'https://attacker.example.invalid'}});
    assert.deepEqual((await req('/api/account/export',{student:'b'})).data.study_sessions,[]);
  });
  await t.test('source changes reject new saves but cannot invalidate recovery of the exact earlier save',async()=>{
    await req('/api/materials',{method:'PUT',body:write({id:'synthetic-material',course_id:'synthetic-course',title:'Updated synthetic notes',text:'Changed source content.',source_kind:'manual',expected_revision:1})});
    assert.equal((await rpc('study_save_checkpoint',{...packet,operation_id:crypto.randomUUID(),expected_revision:1})).error,'source_revision_conflict');
    assert.equal((await rpc('study_save_checkpoint',packet)).replayed,true);
  });
  await t.test('fresh runtime resumes the exact checkpoint and deletion removes it without affecting B',async()=>{
    const authFixture=rt.authFixture;await rt.close();rt=await createRuntime({persistPath,authFixture,bindings:{STUDY_CONNECTOR_PREVIEW:'true'}});
    assert.deepEqual((await rpc('study_resume',{course_id:'synthetic-course',session_id:'synthetic-session'})).record,saved.record);
    const exp=await req('/api/account/export');await req('/api/account',{method:'DELETE',body:{operation_id:crypto.randomUUID(),expected_revision:exp.account_revision,confirm:'DELETE_MY_WORKSPACE'}});
    assert.equal((await rpc('study_resume',{course_id:'synthetic-course'})).error,'account_deleted');
    assert.equal((await rpc('study_get_receipt',{operation_id:packet.operation_id})).error,'account_deleted');
    assert.deepEqual((await req('/api/account/export')).data.study_sessions,[]);
    assert.equal((await rpc('study_list_courses',{},'b')).records.length,1);
  });
});

test('connector preview is unreachable by default, even with a valid browser identity',async t=>{
  const rt=await createRuntime();t.after(()=>rt.close());
  const owner=(await(await rt.request('/api/onboarding')).json()).workspace_id;
  const result=await rt.request('/api/study-connector-preview',{method:'POST',body:call('study_list_courses',{}),headers:{'X-Workspace-Id':owner}});
  assert.equal(result.status,404);
  assert.equal((await rt.request('/mcp',{method:'POST',body:call('study_list_courses',{})})).status,404);
});

test('checkpoint and receipt roll back atomically when storage fails',async t=>{
  let fault=false;const f=sqliteFixture({beforeExec:q=>{if(fault&&q.startsWith('UPDATE workspace_meta SET account_revision'))throw new Error('synthetic fault');}});t.after(()=>f.close());
  const store=new StudentStore(f.storage),tenantId='synthetic_student_a';
  const dispatch=(op,data,packet={})=>store.dispatch({tenantId,op,data,...packet});
  for(const [op,data] of [['courses.put',{id:'synthetic-course',code:'SYN',title:'Synthetic',section:'A',term_id:'demo'}],['materials.put',{id:'synthetic-material',course_id:'synthetic-course',title:'Synthetic notes',text:sourceText,source_kind:'manual'}]])assert.equal((await dispatch(op,data,{operationId:crypto.randomUUID(),expectedRevision:0})).ok,true);
  fault=true;const operationId=crypto.randomUUID();assert.equal((await dispatch('study.put',checkpoint(),{operationId,expectedRevision:0})).error,'storage_unavailable');
  fault=false;assert.equal((await dispatch('study.get',{course_id:'synthetic-course'})).record,null);assert.equal((await dispatch('study.receipt',{operation_id:operationId})).error,'receipt_not_found');
});

test('website continuation includes a newer real checkpoint only for selected source versions',()=>{
  const session={turns:[],check:null,updated_at:null},sources=[{material_id:'synthetic-material',revision:1,label:'S1',text:sourceText}],record={...checkpoint(),test_only:false,revision:1,updated_at:'2026-10-13T12:00:00.000Z'};
  const context=(saved,history=session,refs=sources)=>JSON.parse(tutorPrompt(history,'Continue',refs,saved)[1].content).saved_study_checkpoint;
  assert.equal(context(record).response,record.response);
  assert.equal(context(record).authority,'assistant_report_unverified');
  assert.equal(context({...record,test_only:true}),null);
  assert.equal(context(record,session,[{...sources[0],revision:2}]),null);
  assert.equal(context(record,{...session,updated_at:'2026-10-13T13:00:00.000Z'}),null);
  assert.equal(context(record,session,[{...sources[0],material_id:'another-material'}]),null);
});

test('course lookup does not select a first-page match when coverage is incomplete',async()=>{
  let reads=0,lists=0;
  const dispatch=async(op)=>{
    if(op==='study.get'){reads++;return {ok:true};}
    lists++;return {ok:true,records:[{id:'one',code:'SYN101',title:'Synthetic',term_id:'test',section:'a'}],complete:false,next_cursor:'same'};
  };
  const result=await studyProtocol(call('study_resume',{course_query:'SYN101'}),{dispatch,scopes:['study:read']});
  assert.equal(result.result.structuredContent.error,'course_lookup_incomplete');assert.equal(reads,0);assert.equal(lists,2);
});
