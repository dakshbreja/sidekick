import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteQueue} from '../src/write-intent.js';
const packet={operation_id:'save-synthetic-1',expected_revision:0,id:'resource-one'};
const receipt={operation_id:packet.operation_id,request_hash:'synthetic-hash',revision:1};
const success={ok:true,receipt};
test('lost acknowledgement replays the exact packet and verifies the stored receipt',async()=>{
  const queue=createWriteQueue();let built=0,sent=[];
  const build=async()=>{built++;return {...packet};};
  const send=async p=>{sent.push(p);if(sent.length===1)throw new Error('Lost response');return success;};
  await assert.rejects(queue.run('form',{title:'One'},build,send,async()=>success));
  await queue.run('form',{title:'One'},build,send,async()=>success);
  assert.equal(built,1);assert.deepEqual(sent,[packet,packet]);
});
test('failed receipt readback remains pending and forbids a different write',async()=>{
  const queue=createWriteQueue();let built=0;
  const build=async()=>{built++;return packet;};
  await assert.rejects(queue.run('form',{value:1},build,async()=>success,async()=>({ok:true,receipt:{...receipt,request_hash:'wrong'}})));
  await assert.rejects(queue.run('form',{value:2},build,async()=>success,async()=>success),/previous save is unconfirmed/);
  await queue.run('form',{value:1},build,async()=>success,async()=>success);assert.equal(built,1);
});
test('definitive revision conflict permits a corrected fresh intent',async()=>{
  const queue=createWriteQueue();
  await assert.rejects(queue.run('form',{value:1},async()=>packet,async()=>{throw Object.assign(new Error('conflict'),{status:409});},async()=>success));
  await queue.run('form',{value:2},async()=>packet,async()=>success,async()=>success);
});
test('readback authorization loss after a successful save retains the original intent',async()=>{
  const queue=createWriteQueue();let built=0;
  const build=async()=>{built++;return packet;};
  await assert.rejects(queue.run('form',{value:1},build,async()=>success,async()=>{throw Object.assign(new Error('signed out'),{status:401});}));
  await queue.run('form',{value:1},build,async()=>success,async()=>success);assert.equal(built,1);
});

test('a lost save response survives repeated authorization failures without allocating a second operation',async()=>{
  const queue=createWriteQueue();let built=0;const sent=[];
  const build=async()=>({...packet,operation_id:`synthetic-operation-${++built}`});
  const send=async p=>{
    sent.push(p);
    if(sent.length===1)throw new Error('Response lost after the server saved');
    if(sent.length===2)throw Object.assign(new Error('authentication_required'),{status:401,code:'authentication_required'});
    if(sent.length===3)throw Object.assign(new Error('workspace_changed'),{status:403,code:'workspace_changed'});
    return {ok:true,receipt:{...receipt,operation_id:p.operation_id}};
  };
  const read=async()=>({ok:true,receipt:{...receipt,operation_id:sent[0].operation_id}});
  for(let attempt=0;attempt<3;attempt++)await assert.rejects(queue.run('form',{value:1},build,send,read));
  await assert.rejects(queue.run('form',{value:2},build,send,read),/previous save is unconfirmed/);
  await queue.run('form',{value:1},build,send,read);
  assert.equal(built,1);assert.equal(sent.length,4);assert.ok(sent.every(p=>p===sent[0]));
});

test('receipt uncertainty remains sticky when a later retry returns a revision error',async()=>{
  const queue=createWriteQueue();let built=0,sends=0;
  const build=async()=>{built++;return packet;};
  const send=async()=>{if(++sends===2)throw Object.assign(new Error('revision_conflict'),{status:409,code:'revision_conflict'});return success;};
  await assert.rejects(queue.run('form',{value:1},build,send,async()=>{throw new Error('Readback lost');}));
  await assert.rejects(queue.run('form',{value:1},build,send,async()=>success));
  await assert.rejects(queue.run('form',{value:2},build,send,async()=>success),/previous save is unconfirmed/);
  await queue.run('form',{value:1},build,send,async()=>success);assert.equal(built,1);
});

test('operation ID conflict is not mistaken for permission to allocate a new write',async()=>{
  const queue=createWriteQueue();let built=0;
  const build=async()=>{built++;return packet;};
  await assert.rejects(queue.run('form',{value:1},build,async()=>{
    throw Object.assign(new Error('The operation conflicts'),{status:409,code:'operation_id_conflict'});
  },async()=>success));
  await assert.rejects(queue.run('form',{value:2},build,async()=>success,async()=>success),/previous save is unconfirmed/);
  await queue.run('form',{value:1},build,async()=>success,async()=>success);assert.equal(built,1);
});

test('concurrent calls reserve one asynchronous packet and share one save and receipt read',async()=>{
  const queue=createWriteQueue();let release,built=0,sends=0,reads=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const build=async()=>{built++;await gate;return packet;};
  const send=async()=>{sends++;return success;};
  const read=async()=>{reads++;return success;};
  const first=queue.run('form',{value:1},build,send,read);
  const second=queue.run('form',{value:1},build,send,read);
  await assert.rejects(queue.run('form',{value:2},build,send,read),/previous save is unconfirmed/);
  release();
  const results=await Promise.all([first,second]);
  assert.deepEqual(results,[success,success]);assert.equal(built,1);assert.equal(sends,1);assert.equal(reads,1);
});

test('a pre-send builder failure releases the intent so corrected input can be used',async()=>{
  const queue=createWriteQueue();let sends=0;
  const send=async()=>{sends++;return success;};
  await assert.rejects(queue.run('form',{value:1},async()=>{throw new Error('Failed before packet existed');},send,async()=>success));
  assert.equal(sends,0);
  await queue.run('form',{value:2},async()=>packet,send,async()=>success);assert.equal(sends,1);
});

test('deletion keeps the original asynchronously read revision through response loss and sign-in recovery',async()=>{
  const queue=createWriteQueue();let exports=0,sends=0;const sent=[];
  const build=async()=>{
    exports++;await Promise.resolve();
    return {operation_id:'synthetic-deletion',expected_revision:42,confirm:'DELETE_MY_WORKSPACE'};
  };
  const deleted={ok:true,deleted:true,receipt:{operation_id:'synthetic-deletion',request_hash:'synthetic-delete-hash',revision:43}};
  const send=async p=>{
    sent.push(p);
    if(++sends===1)throw new Error('Lost deletion response');
    if(sends===2)throw Object.assign(new Error('authentication_required'),{status:401});
    return deleted;
  };
  const first=queue.run('delete',{owner:'synthetic-a',confirm:'DELETE_MY_WORKSPACE'},build,send,async()=>deleted);
  const simultaneous=queue.run('delete',{owner:'synthetic-a',confirm:'DELETE_MY_WORKSPACE'},build,send,async()=>deleted);
  assert.ok((await Promise.allSettled([first,simultaneous])).every(result=>result.status==='rejected'));
  await assert.rejects(queue.run('delete',{owner:'synthetic-a',confirm:'DELETE_MY_WORKSPACE'},build,send,async()=>deleted));
  await queue.run('delete',{owner:'synthetic-a',confirm:'DELETE_MY_WORKSPACE'},build,send,async()=>deleted);
  assert.equal(exports,1);assert.equal(sends,3);assert.ok(sent.every(p=>p===sent[0]));assert.equal(sent[0].expected_revision,42);
});

test('clearing the queue cannot let an old completion erase a newer account intent',async()=>{
  const queue=createWriteQueue();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const old=queue.run('form',{owner:'synthetic-a'},async()=>packet,async()=>{await gate;return success;},async()=>success);
  queue.clear();
  await assert.rejects(queue.run('form',{owner:'synthetic-b'},async()=>packet,async()=>{throw new Error('Lost B response');},async()=>success));
  release();await old;
  await assert.rejects(queue.run('form',{owner:'synthetic-c'},async()=>packet,async()=>success,async()=>success),/previous save is unconfirmed/);
});
