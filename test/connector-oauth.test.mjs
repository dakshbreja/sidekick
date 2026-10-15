import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntime} from './runtime-fixture.mjs';

for (const [provider,callback] of [['Claude','https://claude.ai/api/mcp/auth_callback'],['ChatGPT','https://chatgpt.com/connector/oauth/synthetic_callback_1234']]) test(provider+' real OAuth transport scopes, saves, resumes and revokes isolated workspaces',async t=>{
  const persistPath=await mkdtemp(join(tmpdir(),'bridge-pilot-'));
  let rt=await createRuntime({connector:true,persistPath});t.after(async()=>{await rt.close();await rm(persistPath,{recursive:true,force:true});});
  let edge=await rt.mf.getWorker('study-connector-test');
  const origin='https://connector.example.invalid',resource=origin+'/mcp';
  const owners={};
  const site=async(path,{student='a',body,status=200,...other}={})=>{
    const res=await rt.request(path,{student,...(body?{method:'POST',body}:{}),...other,headers:{'X-Workspace-Id':owners[student],...other.headers}});
    const value=await res.json();assert.equal(res.status,status,JSON.stringify(value));return value;
  };
  const write=data=>({operation_id:crypto.randomUUID(),expected_revision:0,...data});
  for(const student of ['a','b']){
    const empty=await(await rt.request('/api/onboarding',{student})).json();
    assert.equal(empty.profile,null);assert.deepEqual(empty.courses,[]);assert.deepEqual(empty.connections,[]);
    owners[student]=empty.workspace_id;
    await site('/api/onboarding',{student,method:'PUT',body:write({display_name:'Synthetic '+student,timezone:'America/New_York',consent_version:'synthetic-pilot-v1',institution:'Synthetic school'})});
    for(const id of ['shared','hidden'])await site('/api/courses',{student,method:'PUT',body:write({id,code:id.toUpperCase(),title:'Synthetic '+student+' '+id,term_id:'test-term',section:student})});
    await site('/api/materials',{student,method:'PUT',body:write({id:'notes',course_id:'shared',title:'Test source',text:'Synthetic '+student+' source: low costs can support a lower price or a higher margin.',source_kind:'manual'})});
  }
  await t.test('empty workspace setup reaches private calendar and daily dashboard',async()=>{
    await site('/api/connections',{method:'PUT',body:write({id:'calendar-source',provider:'manual',site_url:'https://calendar.example.invalid/'})});
    const start=new Date(Date.now()+2*86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const imported=await site('/api/calendar/import',{body:write({id:'calendar',course_id:'shared',source_id:'calendar-source',ics:'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-pilot-event\r\nDTSTART:'+start+'\r\nSUMMARY:Synthetic study meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'})});
    assert.equal(imported.record.events.length,1);assert.equal(imported.record.live_sync,false);
    assert.deepEqual((await site('/api/calendar',{student:'b'})).records,[]);
    await site('/api/assignments',{method:'PUT',body:write({id:'deadline',course_id:'shared',title:'Synthetic exercise',due_at:new Date(Date.now()-86400000).toISOString(),all_day:false})});
    const daily=await site('/api/daily');assert.equal(daily.counts.overdue,1);assert.match(daily.briefing,/1 overdue/);
    assert.equal((await site('/api/daily',{student:'b'})).counts.overdue,0);
  });
  const edgePost=(path,body,token)=>edge.fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const tokenRequest=body=>edge.fetch(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const rpc=async(token,name,args)=>{const res=await edgePost('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},token);return res.json();};
  const value=r=>r.result?.structuredContent||r.result?.content?.[0]&&JSON.parse(r.result.content[0].text)||r;
  const registration=await edgePost('/oauth/register',{client_name:'Synthetic '+provider,redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'});
  const client=await registration.json();assert.equal(registration.status,201,JSON.stringify(client));
  async function authorize(student='a',write=true){
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    const q=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:callback,scope:'study:read study:write',state:crypto.randomUUID(),code_challenge:challenge,code_challenge_method:'S256',resource});
    const auth=await edge.fetch(origin+'/authorize?'+q,{redirect:'manual'});
    assert.equal(auth.status,302,await auth.clone().text());
    const ticket=new URL(auth.headers.get('location')).searchParams.get('request');
    const info=await site('/api/ai-access/request?request='+ticket,{student});assert.equal(info.redirect_origin,new URL(callback).origin);
    const approval=await site('/api/ai-access/approve',{student,body:{request:ticket,course_ids:['shared'],write}});
    const redirect=new URL(approval.redirect);assert.equal(redirect.searchParams.get('state'),q.get('state'));
    const tokenRes=await tokenRequest({grant_type:'authorization_code',client_id:client.client_id,code:redirect.searchParams.get('code'),redirect_uri:callback,code_verifier:verifier,resource});
    const tokens=await tokenRes.json();assert.equal(tokenRes.status,200,JSON.stringify(tokens));
    return {tokens,ticket,code:redirect.searchParams.get('code'),verifier};
  }
  const a=await authorize(),b=await authorize('b');
  await t.test(provider+' protocol metadata is accepted and notifications produce no response',async()=>{
    const init=await edgePost('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:provider.toLowerCase(),version:'synthetic'},_meta:{'synthetic/tracing':'ignored'}}},a.tokens.access_token);
    assert.equal((await init.json()).result.serverInfo.name,'school-bridge-study');
    const listed=await edgePost('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{_meta:{'synthetic/tracing':'ignored'}}},a.tokens.access_token);assert.equal((await listed.json()).result.tools.length,7);
    const notification=await edgePost('/mcp',{jsonrpc:'2.0',method:'notifications/initialized',params:{_meta:{}}},a.tokens.access_token);assert.equal(notification.status,202);assert.equal(await notification.text(),'');
  });
  await t.test('consent rejects cross-origin and stale workspace requests',async()=>{
    await site('/api/ai-access/revoke',{body:{grant_id:crypto.randomUUID()},headers:{Origin:'https://attacker.example.invalid'},status:403});
    await site('/api/ai-access',{student:'b',headers:{'X-Workspace-Id':owners.a},status:403});
    const challenge=createHash('sha256').update('test').digest('base64url');
    for(const override of [{code_challenge_method:'plain'},{resource:'https://attacker.example.invalid/mcp'},{redirect_uri:'https://attacker.example.invalid/callback'}]){
      const q=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:callback,scope:'study:read',state:'synthetic',code_challenge:challenge,code_challenge_method:'S256',resource,...override});
      assert.equal((await edge.fetch(origin+'/authorize?'+q,{redirect:'manual'})).status,400);
    }
  });
  await t.test('discovery and missing/fake credentials fail closed',async()=>{
    assert.equal((await edgePost('/mcp',{jsonrpc:'2.0',id:1,method:'ping'})).status,401);
    assert.equal((await edgePost('/mcp',{},'fake')).status,401);
    const metadata=await(await edge.fetch(origin+'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(metadata.resource,resource);
    assert.equal((await edgePost('/oauth/register',{redirect_uris:['https://attacker.example.invalid/callback']})).status,400);
  });
  await t.test('consent and authorization codes are single-use',async()=>{
    assert.equal((await site('/api/ai-access/approve',{body:{request:a.ticket,course_ids:['shared'],write:true},status:400})).error,'authorization_expired');
    const extra=await authorize();
    const replay=await tokenRequest({grant_type:'authorization_code',client_id:client.client_id,code:extra.code,redirect_uri:callback,code_verifier:extra.verifier,resource});assert.equal(replay.status,400);
  });
  await t.test('selected courses only; identical IDs are isolated by signed owner',async()=>{
    const courses=value(await rpc(a.tokens.access_token,'study_list_courses',{}));assert.equal(courses.records.length,1);assert.equal(courses.records[0].section,'a');
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_id:'hidden'})).error,'course_not_found_or_not_authorized');
    assert.match(value(await rpc(a.tokens.access_token,'study_read_material',{course_id:'shared',material_id:'notes',revision:1})).text,/Synthetic a/);
    assert.match(value(await rpc(b.tokens.access_token,'study_read_material',{course_id:'shared',material_id:'notes',revision:1})).text,/Synthetic b/);
    const forged=await rpc(a.tokens.access_token,'study_resume',{course_id:'shared',owner:owners.b});assert.equal(forged.result.isError,true);
  });
  const packet=write({course_id:'shared',session_id:'synthetic-session',topic:'Cost advantage',question:'Why can lower costs improve margin?',response:'Lower costs leave more profit at the same price.',assistance:'independent',test_only:true,next_step:'Explain when a firm might lower price instead.',sources:[{material_id:'notes',revision:1,start:0,end:40}],criteria:[{criterion:'Relates costs to margin',verdict:'met',evidence_quote:'more profit at the same price',reason:'The response links cost reduction with profit holding price fixed.'}]});
  await t.test('real token saves back to website; fresh client resumes; B cannot see save or receipt',async()=>{
    const saved=value(await rpc(a.tokens.access_token,'study_save_checkpoint',packet));assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.record.assessment.mastery,false);
    assert.deepEqual((await site('/api/study?course_id=shared&scope=test')).record,saved.record);
    assert.deepEqual(value(await rpc(a.tokens.access_token,'study_resume',{course_id:'shared',scope:'test'})).record,saved.record);
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_id:'shared'})).record,null);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_id:'shared',scope:'test'})).record,null);
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',packet)).replayed,true);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_id:'shared'})).record,null);
    assert.deepEqual(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'SHARED',scope:'test'})).record,saved.record);
    const checked=value(await rpc(a.tokens.access_token,'study_resume',{course_query:'SHARED',scope:'test'}));
    assert.equal(checked.source_check.status,'current');assert.equal(checked.source_check.can_use_saved_sources,true);
    assert.equal(checked.source_check.sources[0].current_revision,1);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_query:'SHARED',scope:'test'})).source_check.status,'no_checkpoint');
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_query:'SHARED'})).record,null);
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'HIDDEN'})).error,'course_not_found_or_not_authorized');
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'Synthetic b shared'})).error,'course_not_found_or_not_authorized');
    assert.equal(value(await rpc(b.tokens.access_token,'study_get_receipt',{operation_id:packet.operation_id})).error,'receipt_not_found');
  });
  await t.test('source gaps are separate from learner errors; assistance cannot be relabeled',async()=>{
    const missing={criterion:'Purpose absent from material',verdict:'source_not_covered',evidence_quote:'',reason:'The selected excerpt does not explain this purpose.'};
    const update={...packet,operation_id:'pilot-source-gap',expected_revision:1,assistance:'hints',criteria:[...packet.criteria,missing]};
    const saved=value(await rpc(a.tokens.access_token,'study_save_checkpoint',update));assert.equal(saved.ok,true,JSON.stringify(saved));
    assert.equal(saved.record.assessment.outcome,'source_limited');assert.equal(saved.record.assessment.covered_criteria_outcome,'supported_response');assert.equal(saved.record.assessment.mastery,false);
    const downgrade={...update,operation_id:'pilot-downgrade',expected_revision:2,assistance:'independent',response:'I insist this was independent.'};
    downgrade.criteria=[missing];
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',downgrade)).error,'assistance_downgrade_requires_new_session');
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_id:'shared',scope:'test'})).revision,2);
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',update)).replayed,true);
    // A new question/assessment can start a separate session without erasing prior help.
    const separate={...downgrade,operation_id:'pilot-new-assessment',expected_revision:0,session_id:'new-assessment',question:'New synthetic question not covered by this excerpt.'};
    const fresh=value(await rpc(a.tokens.access_token,'study_save_checkpoint',separate));assert.equal(fresh.ok,true);assert.equal(fresh.record.assessment.covered_criteria_outcome,'unassessed');
    const mixed={...update,operation_id:'pilot-mixed',expected_revision:2,criteria:[{...packet.criteria[0],verdict:'not_met',reason:'Synthetic deliberate incorrect reasoning for contract testing.'},missing]};
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',mixed)).record.assessment.covered_criteria_outcome,'incorrect');
    const worked={...mixed,operation_id:'pilot-worked',expected_revision:3,assistance:'worked_example'};
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',worked)).ok,true);
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',{...mixed,operation_id:'pilot-worked-downgrade',expected_revision:4})).error,'assistance_downgrade_requires_new_session');
    assert.equal(value(await rpc(b.tokens.access_token,'study_get_receipt',{operation_id:update.operation_id})).error,'receipt_not_found');
  });
  await t.test('restart preserves consent, saves, exact retry recovery and fresh-client resume',async()=>{
    const authFixture=rt.authFixture;
    await rt.close();rt=await createRuntime({connector:true,persistPath,authFixture});edge=await rt.mf.getWorker('study-connector-test');
    const resumed=value(await rpc(a.tokens.access_token,'study_resume',{course_id:'shared',session_id:'synthetic-session'}));
    assert.equal(resumed.revision,4);assert.equal(resumed.record.assistance,'worked_example');assert.equal(resumed.source_check.status,'current');
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',packet)).replayed,true);
    assert.deepEqual((await site('/api/study?course_id=shared&session_id=synthetic-session')).record,resumed.record);
    assert.equal((await site('/api/study?course_id=shared')).record,null);
    assert.equal((await site('/api/daily')).counts.overdue,1);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_id:'shared',scope:'test'})).record,null);
  });
  await t.test('read-only consent denies writes even when client requested both scopes',async()=>{
    const ro=await authorize('a',false);
    assert.equal(value(await rpc(ro.tokens.access_token,'study_save_checkpoint',packet)).error,'study_write_permission_required');
  });
  await t.test('refresh remains usable and is audience-bound',async()=>{
    const wrong=await tokenRequest({grant_type:'refresh_token',client_id:client.client_id,refresh_token:b.tokens.refresh_token,resource:'https://attacker.example.invalid/mcp'});assert.equal(wrong.status,400);
    const refreshed=await tokenRequest({grant_type:'refresh_token',client_id:client.client_id,refresh_token:b.tokens.refresh_token,resource});assert.equal(refreshed.status,200);b.tokens=await refreshed.json();
    assert.equal(value(await rpc(b.tokens.access_token,'study_list_courses',{})).records[0].section,'b');
  });
  await t.test('revoke stops existing access, save retries and refresh; second account stays working',async()=>{
    const grants=(await site('/api/ai-access')).grants;const grant=grants.find(g=>g.scopes.includes('study:write'));
    await site('/api/ai-access/revoke',{student:'b',body:{grant_id:grant.id},status:404});
    await site('/api/ai-access/revoke',{body:{grant_id:grant.id}});
    assert.equal((await rpc(a.tokens.access_token,'study_resume',{course_id:'shared'})).error.message,'connector_access_revoked');
    assert.equal((await rpc(a.tokens.access_token,'study_save_checkpoint',packet)).error.message,'connector_access_revoked');
    const refresh=await tokenRequest({grant_type:'refresh_token',client_id:client.client_id,refresh_token:a.tokens.refresh_token,resource});assert.equal(refresh.status,400);
    assert.equal(value(await rpc(b.tokens.access_token,'study_list_courses',{})).records[0].section,'b');
  });
  await t.test('new consent reconnects to the same saved session without reviving old access',async()=>{
    const reconnected=await authorize();
    assert.equal(value(await rpc(reconnected.tokens.access_token,'study_resume',{course_id:'shared',session_id:'synthetic-session'})).revision,4);
    const retired=await rpc(a.tokens.access_token,'study_resume',{course_id:'shared'});
    assert.ok(retired.error==='invalid_token'||retired.error?.message==='connector_access_revoked',JSON.stringify(retired));
    assert.equal(retired.result,undefined);
  });
  await t.test('deleting an account immediately retires its delegated access',async()=>{
    const exp=await site('/api/account/export',{student:'b'});
    await site('/api/account',{student:'b',method:'DELETE',body:{operation_id:crypto.randomUUID(),expected_revision:exp.account_revision,confirm:'DELETE_MY_WORKSPACE'}});
    assert.equal((await rpc(b.tokens.access_token,'study_list_courses',{})).error.message,'account_deleted');
    const refreshed=await tokenRequest({grant_type:'refresh_token',client_id:client.client_id,refresh_token:b.tokens.refresh_token,resource});assert.equal(refreshed.status,400);
  });
});
