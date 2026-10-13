#!/usr/bin/env node
// Loopback-only disposable demo. This is never imported by the deployed Worker.
import { createServer } from 'node:http';
import { createRuntime } from '../test/runtime-fixture.mjs';
const syntheticFeeds=process.env.DEMO_SCHOOL_FEEDS==='1';
const runtime = await createRuntime({ deploymentBundle: process.env.DEMO_DEPLOYMENT_BUNDLE === '1' ? new URL('../dist/index.js', import.meta.url) : undefined,
  ...(syntheticFeeds?{bindings:{SCHOOL_FEEDS_ENABLED:'true',GOOGLE_CREDENTIAL_KEY:'A'.repeat(43)},providerFetch:async request=>{
    const url=new URL(request.url);if(url.hostname!=='uga.view.usg.edu'||url.searchParams.get('token')!=='synthetic_browser_feed')throw new Error('Only synthetic demo feed requests are accepted');
    const date=new Date(Date.now()-86400000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-browser-deadline\r\nDTSTART:'+date+'\r\nSUMMARY:Synthetic feed exercise due\r\nEND:VEVENT\r\nEND:VCALENDAR');
  }}:{}) });
const demoPort = Number(process.env.DEMO_PORT || 8766);
if (!Number.isSafeInteger(demoPort) || demoPort < 1024 || demoPort > 65535) throw new Error('Invalid DEMO_PORT');
const demoOrigin = `http://127.0.0.1:${demoPort}`;
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
    if (url.pathname === '/' && response.status === 200) {
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
console.log('Two empty student workspaces. No real accounts. Ctrl-C discards this session.');
let closing=false;
async function close(){if(closing)return;closing=true;server.close();await runtime.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
