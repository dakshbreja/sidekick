import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteQueue} from '../src/write-intent.js';
const owner='synthetic-a';
const input={owner,path:'/api/courses',method:'PUT',data:{title:'Synthetic course'}};
const packet={operation_id:'synthetic-operation',expected_revision:0,id:'synthetic-course',title:'Synthetic course'};
const receipt={operation_id:packet.operation_id,request_hash:'synthetic-hash',revision:1,operation:'courses.put',resource_id:packet.id};
const saved={ok:true,receipt};
const lost=async()=>{throw new Error('Response lost');};
const missing=()=>Object.assign(new Error('Missing'),{code:'receipt_not_found',status:404});
function fixture(){const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};return {values,storage,queue:()=>createWriteQueue({storage,owner})};}
test('outbox persists before sending and recovers response loss after browser restart without resending',async()=>{
 const f=fixture();const q=f.queue();let sent=0;
 await assert.rejects(q.run('course',input,async()=>packet,async()=>{sent++;assert.equal(f.values.size,1);throw new Error('Lost after commit');},async()=>saved));
 const restarted=f.queue();assert.equal(restarted.count(),1);
 await restarted.reconcile(async()=>{sent++;return saved;},async id=>{assert.equal(id,packet.operation_id);return saved;});
 assert.equal(sent,1);assert.equal(f.values.size,0);
});
test('reconnect reads receipt first then replays the original packet only when absent',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 const calls=[];let reads=0;
 await f.queue().reconcile(async(route,p)=>{calls.push('send');assert.deepEqual(route,{path:input.path,method:input.method});assert.deepEqual(p,packet);return saved;},async()=>{calls.push('read');if(++reads===1)throw missing();return saved;});
 assert.deepEqual(calls,['read','send','read']);assert.equal(f.values.size,0);
});
test('identity changes never expose or replay another account outbox',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 const b=createWriteQueue({storage:f.storage,owner:'synthetic-b'});assert.equal(b.count(),0);
 await b.reconcile(()=>assert.fail('No A replay in B'),()=>assert.fail('No A receipt in B'));b.clear();assert.equal(f.queue().count(),1);
 await assert.rejects(f.queue().run('course',{...input,owner:'synthetic-b'},async()=>packet,async()=>saved,async()=>saved),/sign-in changed/);
});
test('restored intent blocks fresh submission until explicit receipt reconciliation',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 await assert.rejects(f.queue().run('course',input,()=>assert.fail('No new packet'),()=>assert.fail('No implicit retry'),async()=>saved),/Check receipts/);
});
test('acknowledgement hash mismatch and authentication loss preserve recovery data',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,async()=>saved,lost));
 await assert.rejects(f.queue().reconcile(()=>assert.fail('No replay'),async()=>({ok:true,receipt:{...receipt,request_hash:'wrong'}})),/unconfirmed/);
 await assert.rejects(f.queue().reconcile(()=>assert.fail('No replay'),async()=>{throw Object.assign(new Error('Changed account'),{status:403,code:'workspace_changed'});}));
 assert.equal(f.queue().count(),1);
 await f.queue().reconcile(()=>assert.fail('No replay'),async()=>saved);assert.equal(f.values.size,0);
});
test('acknowledged operation with missing receipt is never replayed',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,async()=>saved,lost));
 await assert.rejects(f.queue().reconcile(()=>assert.fail('Acknowledged operation must not replay'),async()=>{throw missing();}));assert.equal(f.queue().count(),1);
});
test('lost deletion response recovers its receipt first and clears this account only',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 const b=createWriteQueue({storage:f.storage,owner:'synthetic-b'});await assert.rejects(b.run('course',{...input,owner:'synthetic-b'},async()=>packet,lost,async()=>saved));
 const deletion={operation_id:'synthetic-deletion',expected_revision:42,confirm:'DELETE_MY_WORKSPACE'};
 await assert.rejects(f.queue().run('delete',{owner,path:'/api/account',method:'DELETE',confirm:deletion.confirm},async()=>deletion,lost,async()=>saved));
 const reads=[];const result=await f.queue().reconcile(()=>assert.fail('No resend after deletion'),async id=>{reads.push(id);return {ok:true,receipt:{...receipt,operation_id:id,operation:'account.delete',resource_id:'account',deleted:true,revision:43}};});
 assert.equal(result.deleted,true);assert.deepEqual(reads,[deletion.operation_id]);assert.equal(f.queue().count(),0);assert.equal(createWriteQueue({storage:f.storage,owner:'synthetic-b'}).count(),1);
});
test('storage unavailable fails before network send',async()=>{
 const storage={getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded');},removeItem:()=>{}};
 await assert.rejects(createWriteQueue({storage,owner}).run('course',input,async()=>packet,()=>assert.fail('Must not send'),async()=>saved),/Quota/);
});
test('outbox retains only pending packet, digest, route and minimal acknowledgement',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,async()=>saved,lost));
 const record=JSON.parse([...f.values.values()][0]);assert.deepEqual(Object.keys(record.intents[0]).sort(),['ack','fingerprint','key','packet','route']);
 assert.equal(record.intents[0].fingerprint.length,64);assert.equal(JSON.stringify(record).split('Synthetic course').length-1,1);
});

test('failed local cleanup retains the original in-memory intent and blocks a new operation',async()=>{
 const f=fixture();const queue=f.queue();const remove=f.storage.removeItem;
 f.storage.removeItem=()=>{throw new Error('Cleanup unavailable');};
 await assert.rejects(queue.run('course',input,async()=>packet,async()=>saved,async()=>saved),/Cleanup unavailable/);
 assert.equal(queue.count(),1);
 await assert.rejects(queue.run('course',{...input,data:{title:'Another course'}},()=>assert.fail('No replacement operation'),async()=>saved,async()=>saved),/previous save/);
 f.storage.removeItem=remove;await queue.reconcile(()=>assert.fail('Receipt already exists'),async()=>saved);assert.equal(f.values.size,0);
});
test('failed local clear preserves recovery entries until cleanup succeeds',async()=>{
 const f=fixture();const queue=f.queue();await assert.rejects(queue.run('course',input,async()=>packet,lost,async()=>saved));
 const remove=f.storage.removeItem;f.storage.removeItem=()=>{throw new Error('Cleanup unavailable');};
 assert.throws(()=>queue.clear(),/Cleanup unavailable/);assert.equal(queue.count(),1);
 f.storage.removeItem=remove;queue.clear();assert.equal(queue.count(),0);assert.equal(f.values.size,0);
});
test('receipt recovery rejects wrong resource, operation, revision and deletion flag even without acknowledgement',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 for(const changed of [{revision:2},{resource_id:'different-course'},{operation:'materials.put'},{deleted:true}]){
  await assert.rejects(f.queue().reconcile(()=>assert.fail('Do not replay mismatched receipt'),async()=>({ok:true,receipt:{...receipt,...changed}})),/unconfirmed/);
  assert.equal(f.queue().count(),1);
 }
 await f.queue().reconcile(()=>assert.fail('No resend'),async()=>saved);assert.equal(f.values.size,0);
});
test('malformed local routes are rejected before any recovery request',async()=>{
 const f=fixture();await assert.rejects(f.queue().run('course',input,async()=>packet,lost,async()=>saved));
 const [key,value]=[...f.values][0];const original=JSON.parse(value);
 for(const route of [undefined,{}, {path:'/api/unknown',method:'PUT'}, {path:'/api/courses',method:'DELETE'}]){
  const record=structuredClone(original);record.intents[0].route=route;f.values.set(key,JSON.stringify(record));
  assert.throws(()=>f.queue(),/invalid/);
 }
});
