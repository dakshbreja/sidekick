// Copyright 2026 Daksh Breja. All rights reserved.
import {object,id,fail,ContractError} from './validation.js';
import {studyProtocol} from './study-connector.js';

export class ConnectorGrants {
  constructor(store) {
    this.store=store;
    store.sql.exec('CREATE TABLE IF NOT EXISTS connector_grants (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  account(owner) {if(this.store.bind(owner).deleted)fail('account_deleted',410);}
  get(owner,grantId) {
    this.account(owner);id(grantId);
    const row=this.store.row('SELECT body FROM connector_grants WHERE id = ?',grantId);
    const grant=row?JSON.parse(row.body):null;
    if(!grant||grant.revoked_at||grant.expires_at<=Date.now())fail('connector_access_revoked',403);
    return grant;
  }
  manage(owner,op,data) {
    try {return this.store.storage.transactionSync(()=>{
      this.account(owner);
      if(op==='list') {object(data,[]);return {ok:true,grants:this.store.sql.exec('SELECT body FROM connector_grants').toArray().map(r=>JSON.parse(r.body))};}
      if(op==='revoke') {
        object(data,['grant_id']);id(data.grant_id);
        const row=this.store.row('SELECT body FROM connector_grants WHERE id = ?',data.grant_id);
        if(!row)fail('grant_not_found',404);
        const grant=JSON.parse(row.body);grant.revoked_at ||= new Date().toISOString();
        this.store.sql.exec('UPDATE connector_grants SET body = ? WHERE id = ?',JSON.stringify(grant),grant.id);
        return {ok:true,grant};
      }
      if(op!=='create')fail('unknown_operation',404);
      object(data,['grant_id','client_name','client_id','course_ids','write']);id(data.grant_id);
      if(typeof data.client_name!=='string'||data.client_name.length>200||typeof data.client_id!=='string'||data.client_id.length>2048||typeof data.write!=='boolean')fail('invalid_grant');
      if(!Array.isArray(data.course_ids)||!data.course_ids.length||data.course_ids.length>20||new Set(data.course_ids).size!==data.course_ids.length)fail('select_courses');
      data.course_ids.forEach(course=>this.store.requireCourse(id(course)));
      if(this.store.row('SELECT COUNT(*) AS n FROM connector_grants').n>=100)fail('connector_grant_limit',409);
      const grant={id:data.grant_id,client_name:data.client_name,client_id:data.client_id,course_ids:data.course_ids,scopes:['study:read',...(data.write?['study:write']:[])],created_at:new Date().toISOString(),expires_at:Date.now()+7*86400000,revoked_at:null};
      this.store.sql.exec('INSERT INTO connector_grants (id,body) VALUES (?,?)',grant.id,JSON.stringify(grant));
      return {ok:true,grant};
    });}catch(e){return {ok:false,error:e instanceof ContractError?e.code:'connector_unavailable',status:e.status||503};}
  }
  async protocol(owner,grantId,message,tokenScopes) {
    try {
      const grant=this.get(owner,grantId);
      const scopes=grant.scopes.filter(s=>tokenScopes.includes(s));
      return await studyProtocol(message,{scopes,dispatch:async(op,data,packet)=>{
        const guard=()=>{
          const current=this.get(owner,grantId);
          if(!current.scopes.includes('study:read')||(op==='study.put'&&!current.scopes.includes('study:write')))fail('connector_scope_denied',403);
          if(op==='study.receipt') {
            const row=this.store.row('SELECT body FROM operations WHERE operation_id = ?',data.operation_id);
            const saved=row?JSON.parse(row.body):null;
            if(saved?.receipt?.operation!=='study.put'||!current.course_ids.includes(saved?.record?.course_id))fail('receipt_not_found',404);
          } else if(op!=='courses.list'&&!current.course_ids.includes(data.course_id))fail('course_access_denied',403);
          return current;
        };
        if(op==='courses.list')return this.store.storage.transactionSync(()=>{
          const current=guard();
          const all=current.course_ids.map(c=>this.store.getRecord('courses',c)).filter(c=>c&&(!data.term_id||c.term_id===data.term_id)).sort((a,b)=>a.id.localeCompare(b.id)).filter(c=>!data.cursor||c.id.localeCompare(data.cursor)>0);
          const records=all.slice(0,Math.min(100,Math.max(1,Number(data.limit)||20)));
          return {ok:true,records,complete:all.length<=records.length,next_cursor:all.length>records.length?records.at(-1).id:null};
        });
        const result=await this.store.dispatch({tenantId:owner,op,data,...packet},{commit:callback=>this.store.storage.transactionSync(()=>{guard();return callback();})});
        const {account_revision,...safe}=result;
        return safe;
      }});
    }catch(e){return {jsonrpc:'2.0',id:message?.id??null,error:{code:-32001,message:e instanceof ContractError?e.code:'connector_unavailable'}};}
  }
}
