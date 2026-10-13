// Copyright 2026 Daksh Breja. All rights reserved.
import {object,id,revision,operationId,fail} from './validation.js';
import {sealCredential,openCredential} from './credential-envelope.js';
import {feedURL,digest,fetchSchoolFeed,parseSchoolFeed,FEED_LIMITS} from './school-feed.js';
export function initializeSchoolFeeds(store){store.sql.exec('CREATE TABLE IF NOT EXISTS school_feeds (id TEXT PRIMARY KEY, body TEXT NOT NULL)');}
export function feedRows(store){return store.sql.exec('SELECT body FROM school_feeds ORDER BY id').toArray().map(r=>JSON.parse(r.body));}
export function feedSchedules(store){return store.sql.exec("SELECT id,json_extract(body,'$.status') AS status,json_extract(body,'$.next_due') AS next_due,json_type(body,'$.envelope')='object' AS has_access FROM school_feeds").toArray();}
export function publicFeed(row,now=Date.now()){
  const {envelope,snapshot,...safe}=row;
  return {...safe,freshness:!row.last_successful_sync?'never_checked':now-Date.parse(row.last_successful_sync)>1800000?'stale':'recent',coverage:snapshot?.coverage||null,event_count:snapshot?.events?.length||0,announcement_count:snapshot?.announcements?.length||0};
}
export class SchoolFeedState{
  constructor(store,{key,clock=()=>Date.now()}={}){this.store=store;this.key=key;this.clock=clock;}
  get(feedId){const row=this.store.row('SELECT body FROM school_feeds WHERE id=?',feedId);return row?JSON.parse(row.body):null;}
  save(row){this.store.sql.exec('INSERT INTO school_feeds VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',row.id,JSON.stringify(row));}
  assert(tenant){if(!/^[A-Za-z0-9_-]{16,128}$/.test(tenant))fail('invalid_owner',403);if(this.store.bind(tenant).deleted)fail('account_deleted',410);}
  async put(tenant,data,commit){
    object(data,['id','course_id','kind','feed_url','consent','expected_revision','operation_id']);
    id(data.id);id(data.course_id);revision(data.expected_revision);operationId(data.operation_id);
    if(data.consent!==true)fail('school_feed_consent_required');
    const checked=feedURL(data.feed_url,data.kind);
    const requestHash=await digest(JSON.stringify(['school_feed.put',data.id,data.course_id,data.kind,checked.url,data.expected_revision]));
    const generation=data.expected_revision+1;
    const envelope=await sealCredential(this.key,{tenantId:tenant,connectionId:data.id,generation,purpose:'school_feed'},{url:checked.url});
    return commit(()=>{
      this.assert(tenant);const replay=this.replay(data.operation_id,requestHash);if(replay)return replay;
      this.store.requireCourse(data.course_id);const old=this.get(data.id);
      if((old?.revision||0)!==data.expected_revision)fail('revision_conflict',409);
      if(old&&(old.course_id!==data.course_id||old.kind!==data.kind))fail('immutable_identity',409);
      const rows=feedRows(this.store);if(!old&&rows.length>=FEED_LIMITS.feeds)fail('school_feed_limit',409);
      if(rows.some(r=>r.id!==data.id&&r.course_id===data.course_id&&r.kind===data.kind&&r.status!=='removed'))fail('school_feed_already_connected',409);
      const row={id:data.id,course_id:data.course_id,term_id:this.store.getRecord('courses',data.course_id).term_id,kind:data.kind,org:checked.org,revision:generation,status:'pending',consented_at:new Date(this.clock()).toISOString(),envelope,snapshot:null,next_due:this.clock(),failures:0,last_successful_sync:null,last_attempt:null,error:null};
      this.save(row);return this.receipt(data,requestHash,'school_feed.put',row);
    });
  }
  replay(operation,hash){const found=this.store.row('SELECT request_hash,body FROM operations WHERE operation_id=?',operation);if(!found)return null;if(found.request_hash!==hash)fail('operation_id_conflict',409);return {...JSON.parse(found.body),replayed:true};}
  receipt(data,hash,operation,row){
    const meta=this.store.row('SELECT account_revision FROM workspace_meta WHERE singleton=1'),account_revision=meta.account_revision+1;
    const receipt={operation_id:data.operation_id,operation,resource_id:row.id,revision:row.revision,account_revision,saved_at:new Date(this.clock()).toISOString(),request_hash:hash};
    const result={ok:true,feed:publicFeed(row,this.clock()),receipt};this.store.saveReceipt(data.operation_id,hash,result);this.store.sql.exec('UPDATE workspace_meta SET account_revision=? WHERE singleton=1',account_revision);return result;
  }
  async remove(tenant,data,commit){
    object(data,['id','expected_revision','operation_id']);id(data.id);revision(data.expected_revision);operationId(data.operation_id);
    const hash=await digest(JSON.stringify(['school_feed.remove',data.id,data.expected_revision]));
    return commit(()=>{this.assert(tenant);const replay=this.replay(data.operation_id,hash);if(replay)return replay;const old=this.get(data.id);if(!old)fail('school_feed_not_found',404);if(old.revision!==data.expected_revision)fail('revision_conflict',409);
      const row={...old,revision:old.revision+1,status:'removed',envelope:null,snapshot:null,next_due:null,error:null};this.save(row);return this.receipt(data,hash,'school_feed.remove',row);});
  }
  async collect(tenant,feedId,{fetcher=fetch}={}){
    this.assert(tenant);const row=this.get(feedId);if(!row?.envelope||row.status==='removed')return {kind:'stopped'};
    const generation=row.revision;let snapshot,error;
    try{
      const secret=await openCredential(this.key,{tenantId:tenant,connectionId:feedId,generation,purpose:'school_feed'},row.envelope);
      const checked=feedURL(secret.url,row.kind);
      const raw=await fetchSchoolFeed(checked.url,fetcher);
      snapshot=await parseSchoolFeed(raw,row,{now:this.clock(),timezone:this.store.getRecord('profile','profile')?.timezone||'UTC',url:checked.url});
    }catch(e){error=['school_feed_access_denied','school_feed_too_large','school_feed_event_limit','invalid_school_calendar','invalid_school_announcements','school_feed_announcement_limit','school_feed_duplicate_event','school_feed_duplicate_announcement'].includes(e.code)?e.code:'school_feed_unavailable';}
    return this.store.storage.transactionSync(()=>{
      const meta=this.store.row('SELECT * FROM workspace_meta WHERE singleton=1'),current=this.get(feedId);
      if(meta?.deleted||!current||current.revision!==generation||current.status==='removed')return {kind:'stopped'};
      const now=this.clock();current.last_attempt=new Date(now).toISOString();
      if(error){current.failures++;current.error=error;current.status=error==='school_feed_access_denied'?'needs_attention':'retrying';current.next_due=now+Math.min(21600000,60000*2**Math.min(current.failures,9));}
      else{
        if(row.kind==='calendar'&&current.snapshot){
          const keys=new Set(snapshot.events.map(e=>e.id));
          for(const event of current.snapshot.events||[])if(!keys.has(event.id)&&event.category==='deadline')snapshot.events.push({...event,source_missing:true});
          if(snapshot.events.length>FEED_LIMITS.events){current.error='school_feed_event_limit';current.status='needs_attention';current.next_due=now+21600000;this.save(current);return {kind:'school_feed_finished'};}
        }
        if(row.kind==='announcements'){
          const merged=new Map((current.snapshot?.announcements||[]).map(a=>[a.id,a]));for(const a of snapshot.announcements)merged.set(a.id,a);
          snapshot.announcements=[...merged.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)).slice(0,FEED_LIMITS.announcements);
          snapshot.coverage.retention_limit=FEED_LIMITS.announcements;
        }
        if(new TextEncoder().encode(JSON.stringify(snapshot)).length>500000){current.error='school_feed_too_large';current.status='needs_attention';current.next_due=now+21600000;}
        else{current.snapshot=snapshot;current.error=null;current.failures=0;current.status='connected';current.last_successful_sync=new Date(now).toISOString();current.next_due=now+FEED_LIMITS.interval;}
      }
      this.save(current);return {kind:'school_feed_finished'};
    });
  }
}
