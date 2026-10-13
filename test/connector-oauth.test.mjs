import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRuntime} from './runtime-fixture.mjs';

test('real OAuth transport scopes, saves, resumes and revokes isolated workspaces',async t=>{
  const rt=await createRuntime({connector:true});t.after(()=>rt.close());
  const edge=await rt.mf.getWorker('study-connector-test');
  const origin='https://connector.example.invalid',resource=origin+'/mcp',callback='https://claude.ai/api/mcp/auth_callback';
  const owners={};
  const site=async(path,{student='a',body,status=200,...other}={})=>{
    const res=await rt.request(path,{student,...(body?{method:'POST',body}:{}),...other,headers:{'X-Workspace-Id':owners[student],...other.headers}});
    const value=await res.json();assert.equal(res.status,status,JSON.stringify(value));return value;
  };
  const write=data=>({operation_id:crypto.randomUUID(),expected_revision:0,...data});
  for(const student of ['a','b']){
    owners[student]=(await(await rt.request('/api/onboarding',{student})).json()).workspace_id;
    for(const id of ['shared','hidden'])await site('/api/courses',{student,method:'PUT',body:write({id,code:id.toUpperCase(),title:'Synthetic '+student+' '+id,term_id:'test-term',section:student})});
    await site('/api/materials',{student,method:'PUT',body:write({id:'notes',course_id:'shared',title:'Test source',text:'Synthetic '+student+' source: low costs can support a lower price or a higher margin.',source_kind:'manual'})});
  }
  const edgePost=(path,body,token)=>edge.fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const tokenRequest=body=>edge.fetch(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const rpc=async(token,name,args)=>{const res=await edgePost('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},token);return res.json();};
  const value=r=>r.result?.structuredContent||r.result?.content?.[0]&&JSON.parse(r.result.content[0].text)||r;
  const registration=await edgePost('/oauth/register',{client_name:'Synthetic Claude',redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'});
  const client=await registration.json();assert.equal(registration.status,201,JSON.stringify(client));
  async function authorize(student='a',write=true){
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    const q=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:callback,scope:'study:read study:write',state:crypto.randomUUID(),code_challenge:challenge,code_challenge_method:'S256',resource});
    const auth=await edge.fetch(origin+'/authorize?'+q,{redirect:'manual'});
    assert.equal(auth.status,302,await auth.clone().text());
    const ticket=new URL(auth.headers.get('location')).searchParams.get('request');
    const info=await site('/api/ai-access/request?request='+ticket,{student});assert.equal(info.redirect_origin,'https://claude.ai');
    const approval=await site('/api/ai-access/approve',{student,body:{request:ticket,course_ids:['shared'],write}});
    const redirect=new URL(approval.redirect);assert.equal(redirect.searchParams.get('state'),q.get('state'));
    const tokenRes=await tokenRequest({grant_type:'authorization_code',client_id:client.client_id,code:redirect.searchParams.get('code'),redirect_uri:callback,code_verifier:verifier,resource});
    const tokens=await tokenRes.json();assert.equal(tokenRes.status,200,JSON.stringify(tokens));
    return {tokens,ticket,code:redirect.searchParams.get('code'),verifier};
  }
  const a=await authorize(),b=await authorize('b');
  await t.test('Claude protocol metadata is accepted and notifications produce no response',async()=>{
    const init=await edgePost('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'claude',version:'synthetic'},_meta:{'synthetic/tracing':'ignored'}}},a.tokens.access_token);
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
    assert.deepEqual((await site('/api/study?course_id=shared')).record,saved.record);
    assert.deepEqual(value(await rpc(a.tokens.access_token,'study_resume',{course_id:'shared'})).record,saved.record);
    assert.equal(value(await rpc(a.tokens.access_token,'study_save_checkpoint',packet)).replayed,true);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_id:'shared'})).record,null);
    assert.deepEqual(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'SHARED'})).record,saved.record);
    assert.equal(value(await rpc(b.tokens.access_token,'study_resume',{course_query:'SHARED'})).record,null);
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'HIDDEN'})).error,'course_not_found_or_not_authorized');
    assert.equal(value(await rpc(a.tokens.access_token,'study_resume',{course_query:'Synthetic b shared'})).error,'course_not_found_or_not_authorized');
    assert.equal(value(await rpc(b.tokens.access_token,'study_get_receipt',{operation_id:packet.operation_id})).error,'receipt_not_found');
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
  await t.test('deleting an account immediately retires its delegated access',async()=>{
    const exp=await site('/api/account/export',{student:'b'});
    await site('/api/account',{student:'b',method:'DELETE',body:{operation_id:crypto.randomUUID(),expected_revision:exp.account_revision,confirm:'DELETE_MY_WORKSPACE'}});
    assert.equal((await rpc(b.tokens.access_token,'study_list_courses',{})).error.message,'account_deleted');
    const refreshed=await tokenRequest({grant_type:'refresh_token',client_id:client.client_id,refresh_token:b.tokens.refresh_token,resource});assert.equal(refreshed.status,400);
  });
});
