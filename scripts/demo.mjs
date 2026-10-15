#!/usr/bin/env node
// Loopback-only disposable demo. This is never imported by the deployed Worker.
import { createServer } from 'node:http';
import { createRuntime } from '../test/runtime-fixture.mjs';
const syntheticFeeds=process.env.DEMO_SCHOOL_FEEDS==='1',syntheticTutor=process.env.DEMO_TUTOR==='1',syntheticStudy=process.env.DEMO_STUDY==='1';
const runtime = await createRuntime({ deploymentBundle: process.env.DEMO_DEPLOYMENT_BUNDLE === '1' ? new URL('../dist/index.js', import.meta.url) : undefined,
  bindings:{...(syntheticStudy?{STUDY_CONNECTOR_PREVIEW:'true'}:{}),...(syntheticFeeds?{SCHOOL_FEEDS_ENABLED:'true',GOOGLE_CREDENTIAL_KEY:'A'.repeat(43)}:{}),...(syntheticTutor?{TUTOR_ENABLED:'true',TUTOR_FREE_TIER_CONFIRMED:'true'}:{})},
  ...(syntheticTutor?{aiFetch:async request=>{const body=await request.json(),sources=JSON.parse(body.input.messages[1].content).sources;return Response.json({response:JSON.stringify({source_sufficient:true,teaching_explanation:'This is a synthetic lesson from your selected notes [S1]. These disposable notes identify synthetic material A as the selected reference. Use that reference to answer the practice question, rather than assuming the tutor can see another student’s notes or an unrelated website. The question checks recognition of this selected source only; it does not establish subject mastery.',question:'Which material is selected?',correct_answer:'Synthetic material A',distractors:['Another student’s private notes','An unrelated website','No material'],source_label:'S1',explanation:'The selected source is synthetic material A.'})});}}:{}),
  ...(syntheticFeeds?{providerFetch:async request=>{
    const url=new URL(request.url);if(url.hostname!=='uga.view.usg.edu'||url.searchParams.get('token')!=='synthetic_browser_feed')throw new Error('Only synthetic demo feed requests are accepted');
    const date=new Date(Date.now()-86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-browser-deadline\r\nDTSTART:'+date+'\r\nSUMMARY:Synthetic feed exercise due\r\nEND:VEVENT\r\nEND:VCALENDAR');
  }}:{}) });
const demoPort = Number(process.env.DEMO_PORT || 8766);
if (!Number.isSafeInteger(demoPort) || demoPort < 1024 || demoPort > 65535) throw new Error('Invalid DEMO_PORT');
const demoOrigin = `http://127.0.0.1:${demoPort}`;
if(syntheticStudy){
  const text='Synthetic inventory notes: daily demand of 10 units for 3 days requires 30 units. Add a safety buffer of 5 for a reorder point of 35 units.';
  for(const student of ['a','b']){
    for(const [path,data] of [['/api/courses',{id:'synthetic-course',code:'SYN101',title:'Synthetic inventory course',section:student.toUpperCase(),term_id:'synthetic-term'}],['/api/materials',{id:'synthetic-material',course_id:'synthetic-course',title:'Synthetic inventory notes '+student.toUpperCase(),text:student==='a'?text:'Separate synthetic Student B notes.',source_kind:'manual'}]]){
      const res=await runtime.request(path,{student,method:'PUT',body:{operation_id:crypto.randomUUID(),expected_revision:0,...data}});if(!res.ok)throw new Error('Synthetic study setup failed');
    }
  }
  const owner=(await(await runtime.request('/api/onboarding')).json()).workspace_id;
  const result=await runtime.request('/api/study-connector-preview',{method:'POST',headers:{'X-Workspace-Id':owner},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'study_save_checkpoint',arguments:{operation_id:'synthetic-study-checkpoint',expected_revision:0,course_id:'synthetic-course',session_id:'synthetic-session',topic:'Inventory reasoning',question:'Explain the reorder point, including the safety buffer.',response:'Ten units a day for three days means 30 units.',assistance:'independent',test_only:true,next_step:'Explain the missing five-unit buffer, then try a different lead time.',sources:[{material_id:'synthetic-material',revision:1,start:0,end:text.length}],criteria:[{criterion:'Demand during lead time',verdict:'met',evidence_quote:'three days means 30 units',reason:'Correctly combines demand and lead time.'},{criterion:'Safety buffer',verdict:'not_evidenced',evidence_quote:'',reason:'The response has not explained the buffer or the final 35-unit result.'}]}}}});
  if(!(await result.json()).result?.structuredContent?.ok)throw new Error('Synthetic connector save failed');
  if(process.env.DEMO_STUDY_SOURCE_LIMITED==='1'){
    const record=(await(await runtime.request('/api/study?course_id=synthetic-course&scope=test',{headers:{'X-Workspace-Id':owner}})).json()).record;
    const {course_id,session_id,topic,question,response,test_only,next_step,sources,criteria}=record;
    const updated=await runtime.request('/api/study-connector-preview',{method:'POST',headers:{'X-Workspace-Id':owner},body:{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'study_save_checkpoint',arguments:{course_id,session_id,topic,question,response,test_only,next_step:'Find authorized material explaining the buffer before assessing its purpose; meanwhile practice the supported calculation.',assistance:'hints',sources:sources.map(({material_id,revision,start,end})=>({material_id,revision,start,end})),criteria:[criteria[0],{criterion:'Why the buffer is needed',verdict:'source_not_covered',evidence_quote:'',reason:'The excerpt gives the buffer size but does not explain its purpose.'}],operation_id:'synthetic-source-gap',expected_revision:1}}}});
    if(!(await updated.json()).result?.structuredContent?.ok)throw new Error('Synthetic source-gap setup failed');
  }
  if(process.env.DEMO_STUDY_CHANGED==='1'){
    const changed=await runtime.request('/api/materials',{method:'PUT',body:{operation_id:crypto.randomUUID(),expected_revision:1,id:'synthetic-material',course_id:'synthetic-course',title:'Updated synthetic inventory notes A',text:'Updated synthetic inventory notes: use a safety buffer of 8 units. The earlier five-unit passage is historical.',source_kind:'manual'}});
    if(!changed.ok)throw new Error('Synthetic source revision setup failed');
  }
}
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${demoPort}`) { res.writeHead(403); res.end('Loopback demo only'); return; }
    if (req.headers.origin && req.headers.origin !== demoOrigin) { res.writeHead(403); res.end('Same-origin demo only'); return; }
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end('Same-origin demo only'); return; }
    const url = new URL(req.url, demoOrigin);
    if (/^\/__demo\/student\/[ab]$/.test(url.pathname) && req.method === 'GET') {
      const student = url.pathname.at(-1);
      res.writeHead(303, { location: '/', 'set-cookie': `demo_student=${student}; Path=/; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store' }); res.end(); return;
    }
    const student = /(?:^|;\s*)demo_student=b(?:;|$)/.test(req.headers.cookie || '') ? 'b' : 'a';
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 350000) { res.writeHead(413); res.end('Request too large'); return; } chunks.push(chunk); }
    const identity = { sub: `synthetic-student-${student}`, email: `student-${student}@example.invalid` };
    const headers = new Headers({ 'Cf-Access-Jwt-Assertion': await runtime.authFixture.signToken(identity) });
    for (const name of ['content-type','x-workspace-id','sec-fetch-site']) if (req.headers[name]) headers.set(name, req.headers[name]);
    if (req.headers.origin) headers.set('origin', runtime.origin);
    const response = await runtime.mf.dispatchFetch(runtime.origin + url.pathname + url.search, {
      method: req.method, headers, ...(!['GET','HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
    });
    let body = Buffer.from(await response.arrayBuffer());
    if (response.headers.get('content-type')?.includes('text/html') && response.status === 200) {
      const banner = `<aside class="demo-banner">LOCAL SIMULATION · Student ${student.toUpperCase()} · Disposable synthetic data only. <a href="/__demo/student/a">Student A</a> · <a href="/__demo/student/b">Student B</a></aside>`;
      body = Buffer.from(body.toString().replace('<body>', '<body>' + banner));
    }
    if (url.pathname === '/style.css') body = Buffer.concat([body,Buffer.from('\n.demo-banner{padding:12px 24px;background:#fff1bf;text-align:center;font-size:13px}.demo-banner a{color:#193c38;font-weight:700}\n')]);
    const outputHeaders = Object.fromEntries(response.headers); delete outputHeaders['content-length'];
    res.writeHead(response.status, outputHeaders); res.end(body);
  } catch { res.writeHead(503, {'content-type':'text/plain'}); res.end('Synthetic demo unavailable'); }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(demoPort,'127.0.0.1',resolve);});
console.log(`Synthetic-only School Bridge: ${demoOrigin}`);
console.log(syntheticStudy?'Two isolated synthetic accounts; Student A has a connector study checkpoint. No real AI calls.':'Two empty student workspaces. No real accounts. Ctrl-C discards this session.');
let closing=false;
async function close(){if(closing)return;closing=true;server.close();await runtime.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
