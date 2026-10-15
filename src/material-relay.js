// Course-only, revocable publisher. It cannot read source text or write progress.
import {object,id,fail} from './validation.js';
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const relayMaterialId=async(course,key)=>'relay_'+await digest(JSON.stringify([course,key]));
export function initializeRelay(store){store.sql.exec('CREATE TABLE IF NOT EXISTS material_relay (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');}
export class MaterialRelay {
  constructor(store){this.store=store;}
  state(){const row=this.store.row('SELECT body FROM material_relay WHERE id=1');return row?JSON.parse(row.body):null;}
  save(state){this.store.sql.exec('INSERT INTO material_relay VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',JSON.stringify(state));}
  owner(owner){if(owner.startsWith('demo_v1_'))fail('demo_external_connections_disabled',403);const meta=this.store.bind(owner);if(meta.deleted)fail('account_deleted',410);}
  public(state=this.state()){if(!state)return {enabled:false};return {enabled:!state.revoked&&Date.now()<state.expires_at,course_ids:state.course_ids,expires_at:state.expires_at,last_check_at:state.last_check_at||null,last_save_at:state.last_save_at||null,created_at:state.created_at};}
  async manage(owner,op,data={}){
    this.owner(owner);
    if(op==='status')return {ok:true,relay:this.public()};
    if(op==='revoke'){object(data,[]);const state=this.state();if(state){state.revoked=true;this.save(state);}return {ok:true,relay:this.public()};}
    object(data,['course_ids']);
    if(op!=='create'||!Array.isArray(data.course_ids)||!data.course_ids.length||data.course_ids.length>20||new Set(data.course_ids).size!==data.course_ids.length)fail('invalid_relay_courses');
    const old=this.state();if(old&&!old.revoked&&Date.now()<old.expires_at)fail('relay_already_enabled',409);
    for(const course of data.course_ids)this.store.requireCourse(id(course));
    const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const state={hash:await digest(secret),course_ids:[...data.course_ids].sort(),created_at:new Date().toISOString(),expires_at:Date.now()+180*86400000,revoked:false};this.save(state);
    return {ok:true,relay:this.public(state),credential:owner+'.'+secret};
  }
  async request(owner,secret,message){
    this.owner(owner);const state=this.state();
    if(!state||state.revoked||Date.now()>=state.expires_at)fail('relay_access_revoked',401);
    const actual=new TextEncoder().encode(await digest(secret)),expected=new TextEncoder().encode(state.hash);
    if(!crypto.subtle.timingSafeEqual(actual,expected))fail('relay_access_denied',401);
    object(message,['op','data','operation_id','expected_revision']);
    const day=new Date().toISOString().slice(0,10);if(state.day!==day){state.day=day;state.calls=0;}if(++state.calls>1200)fail('relay_daily_limit',429);this.save(state);
    if(message.op==='status'){
      object(message.data||{},[]);state.last_check_at=new Date().toISOString();this.save(state);
      const courses=state.course_ids.map(c=>this.store.getRecord('courses',c));
      const records=this.store.sql.exec("SELECT body FROM records WHERE kind='materials'").toArray().map(r=>JSON.parse(r.body)).filter(r=>r.id.startsWith('relay_')&&state.course_ids.includes(r.course_id)).map(({text,...r})=>r);
      return {ok:true,workspace_id:owner,courses,records,relay:this.public(state)};
    }
    if(message.op==='receipt'){
      object(message.data,['operation_id']);const op=message.data.operation_id;if(typeof op!=='string'||!/^relay_[a-f0-9]{64}$/.test(op))fail('relay_operation_denied',403);
      const result=await this.store.dispatch({tenantId:owner,op:'receipt.get',data:{operation_id:op}});
      if(result.ok){const record=this.store.getRecord('materials',result.receipt.resource_id);if(!result.receipt.resource_id.startsWith('relay_')||!record||!state.course_ids.includes(record.course_id))fail('relay_operation_denied',403);}return result;
    }
    if(message.op!=='put')fail('relay_operation_denied',403);
    const data=message.data;
    if(!data||!state.course_ids.includes(data.course_id)||!data.import_source||data.source_kind!=='text_import'||data.archived!==undefined)fail('relay_scope_denied',403);
    if(typeof data.import_source.key!=='string'||data.id!==await relayMaterialId(data.course_id,data.import_source.key))fail('relay_identity_mismatch',403);
    if(typeof message.operation_id!=='string'||!/^relay_[a-f0-9]{64}$/.test(message.operation_id))fail('relay_operation_denied',403);
    // Exact retries must remain readable after edits, without overwriting them.
    const receipt=this.store.row('SELECT operation_id FROM operations WHERE operation_id=?',message.operation_id);
    const current=this.store.getRecord('materials',data.id);
    if(!receipt&&current){
      if(current.archived||!current.import_source)fail('relay_material_locally_changed',409);
      if(Date.parse(data.import_source.extracted_at)<Date.parse(current.import_source.extracted_at))fail('relay_snapshot_older',409);
    }
    const result=await this.store.dispatch({tenantId:owner,op:'materials.put',data,operationId:message.operation_id,expectedRevision:message.expected_revision});
    if(result.ok){state.last_save_at=new Date().toISOString();this.save(state);return {ok:true,revision:result.revision,receipt:result.receipt,replayed:Boolean(result.replayed)};}return result;
  }
}
