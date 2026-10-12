// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
test('real SQLite commits and rolls back SQL plus an alarm together across nested synchronous transactions',async t=>{
 const script=`import {DurableObject} from 'cloudflare:workers';export class Probe extends DurableObject {constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY,value INTEGER)');}async run({abort}){try{await this.ctx.storage.transaction(async()=>{this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT OR REPLACE INTO probe VALUES (1,1)'));await this.ctx.storage.setAlarm(Date.now()+3600000);if(abort)throw new Error('Synthetic rollback');});}catch{}return {rows:this.ctx.storage.sql.exec('SELECT * FROM probe').toArray(),alarm:await this.ctx.storage.getAlarm()};}async alarm(){}}export default{async fetch(request,env){return Response.json(await env.PROBE.getByName('synthetic').run(await request.json()));}};`;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'community-alarm-transaction',modules:true,script,compatibilityDate:'2026-10-12',host:'127.0.0.1',port:0,cf:false,unsafeDevRegistryPath:undefined,unsafeRegisterWorker:false,log:new Log(LogLevel.ERROR),durableObjects:{PROBE:{className:'Probe',useSQLite:true}}}));t.after(()=>mf.dispose());await mf.ready;
 const request=async abort=>(await mf.dispatchFetch('https://synthetic.invalid/',{method:'POST',body:JSON.stringify({abort})})).json();
 assert.deepEqual(await request(true),{rows:[],alarm:null});const saved=await request(false);assert.equal(saved.rows.length,1);assert.ok(saved.alarm>Date.now());
 const rollback=await request(true);assert.deepEqual(rollback,saved);
});
