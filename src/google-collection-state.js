// Copyright 2026 Daksh Breja. All rights reserved.
// Internal durable collection state. No provider calls, alarms or public routes.
import { fail, id } from './validation.js';
import { validateGoogleEventPage } from './google-calendar.js';
export const COLLECTION_LIMITS = Object.freeze({ leaseMs:60000, intervalMs:900000, runMs:86400000, pages:500, calendarEvents:10000, workspaceEvents:20000, workspaceBytes:8000000, failures:8 });
const tables = ['google_collection', 'google_event_stage', 'google_events', 'google_page_history'];
const bytes = value => new TextEncoder().encode(value).byteLength;
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
function calendarId(value) { if(typeof value!=='string'||!value.length||value.length>1024||/[\u0000-\u0020\u007f]/.test(value)||['.','..'].includes(value))fail('invalid_calendar_id');return value; }
export function initializeGoogleCollection(store) {
  store.sql.exec('CREATE TABLE IF NOT EXISTS google_collection (connection_id TEXT NOT NULL, calendar_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(connection_id, calendar_id))');
  for(const table of ['google_event_stage','google_events'])store.sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (connection_id TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, byte_count INTEGER NOT NULL, PRIMARY KEY(connection_id, calendar_id, event_id))`);
  store.sql.exec('CREATE TABLE IF NOT EXISTS google_page_history (connection_id TEXT NOT NULL, calendar_id TEXT NOT NULL, cursor_hash TEXT NOT NULL, PRIMARY KEY(connection_id, calendar_id, cursor_hash))');
}
// These helpers join the caller's existing synchronous transaction.
export function clearGoogleCollection(store, connectionId) {
  for(const table of tables)store.sql.exec(`DELETE FROM ${table}`+(connectionId===undefined?'':' WHERE connection_id = ?'),...(connectionId===undefined?[]:[connectionId]));
}
function clearCalendar(store, connectionId, calendarId, includePublished=false) {
  for(const table of includePublished?tables: ['google_event_stage','google_page_history'])store.sql.exec(`DELETE FROM ${table} WHERE connection_id = ? AND calendar_id = ?`,connectionId,calendarId);
}
function put(store,row) {
  const body=JSON.stringify(row);if(bytes(body)>40000)fail('collection_state_too_large',413);
  store.sql.exec('INSERT INTO google_collection (connection_id,calendar_id,body) VALUES (?,?,?) ON CONFLICT(connection_id,calendar_id) DO UPDATE SET body=excluded.body',row.connection_id,row.calendar_id,body);
}
export function reconcileGoogleSelection(store, selection) {
  const rows=store.sql.exec('SELECT body FROM google_collection WHERE connection_id = ?',selection.id).toArray().map(row=>JSON.parse(row.body));
  for(const row of rows) {
    if(row.generation!==selection.connection_generation || !selection.calendar_ids.includes(row.calendar_id))clearCalendar(store,selection.id,row.calendar_id,true);
    else { clearCalendar(store,selection.id,row.calendar_id);put(store,{...row,selection_revision:selection.revision,job:null,claim_failures:0,status:'queued',error:null,next_due:0}); }
  }
}
function publicState(row, now) {
  return {connection_id:row.connection_id,calendar_id:row.calendar_id,snapshot_revision:row.snapshot_revision,snapshot_id:row.snapshot_id,last_successful_sync:row.last_successful_sync,
    snapshot_complete:row.last_successful_sync!==null,status:row.status,error:row.error??null,retry_at:row.status==='backoff'?row.next_due:null,
    freshness:row.last_successful_sync===null?'never_synced':row.error||now-Date.parse(row.last_successful_sync)>=COLLECTION_LIMITS.intervalMs?'stale':'recent',
    time_zone:row.time_zone??null,recurrence_expanded:false};
}
export function exportGoogleSnapshots(store) {
  return store.sql.exec('SELECT body FROM google_collection ORDER BY connection_id,calendar_id').toArray().map(item=>JSON.parse(item.body)).filter(row=>row.last_successful_sync!==null && store.activeGoogleConnection(row.connection_id,row.generation) && store.getRecord('google_selection',row.connection_id)?.calendar_ids.includes(row.calendar_id)).map(row=>({...publicState(row,Date.parse(store.clock())),events:store.sql.exec('SELECT body FROM google_events WHERE connection_id = ? AND calendar_id = ? ORDER BY event_id',row.connection_id,row.calendar_id).toArray().map(event=>JSON.parse(event.body))}));
}
export class GoogleCollectionState {
  constructor(store,{clock=()=>Date.now(),limits={}}={}) {
    this.store=store;this.clock=clock;this.limits={...COLLECTION_LIMITS,...limits};
    for(const [key,value] of Object.entries(this.limits))if(!Object.hasOwn(COLLECTION_LIMITS,key)||!Number.isSafeInteger(value)||value<1||value>COLLECTION_LIMITS[key])fail('invalid_collection_limits');
  }
  now(){const value=this.clock();if(!Number.isSafeInteger(value)||value<0)fail('invalid_clock',503);return value;}
  transaction(tenant,callback) {
    if(typeof tenant!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(tenant))fail('invalid_owner',403);
    return this.store.storage.transactionSync(()=>{const meta=this.store.bind(tenant);if(meta.deleted)fail('account_deleted',410);return callback(meta);});
  }
  selected(connection,calendar) {
    id(connection);calendarId(calendar);
    const selected=this.store.getRecord('google_selection',connection);
    if(!selected?.calendar_ids.includes(calendar))fail('calendar_not_selected',409);
    if(!this.store.activeGoogleConnection(connection,selected.connection_generation))fail('google_access_changed',409);
    return selected;
  }
  row(connection,calendar) {const row=this.store.row('SELECT body FROM google_collection WHERE connection_id = ? AND calendar_id = ?',connection,calendar);return row?JSON.parse(row.body):null;}
  budget(table,connection,calendar) {
    const count=this.store.row(`SELECT COUNT(*) AS n FROM ${table} WHERE connection_id = ? AND calendar_id = ?`,connection,calendar).n;
    const total=this.store.row(`SELECT COUNT(*) AS n,COALESCE(SUM(byte_count),0) AS bytes FROM ${table}`);
    if(count>this.limits.calendarEvents||total.n>this.limits.workspaceEvents||total.bytes>this.limits.workspaceBytes)fail('calendar_collection_limit',409);
  }
  claim(tenant,{connectionId,calendarId}) {
    return this.transaction(tenant,()=>{
      const selection=this.selected(connectionId,calendarId),now=this.now();let row=this.row(connectionId,calendarId);
      if(row && (row.generation!==selection.connection_generation||row.selection_revision!==selection.revision)) {reconcileGoogleSelection(this.store,selection);row=this.row(connectionId,calendarId);}
      row??={connection_id:connectionId,calendar_id:calendarId,generation:selection.connection_generation,selection_revision:selection.revision,snapshot_revision:0,snapshot_id:null,last_successful_sync:null,sync_token:null,time_zone:null,next_due:0,status:'queued',error:null,job:null};
      if(row.status==='paused')return {kind:'paused',error:row.error};
      if(row.job?.lease_expires_at>now)return {kind:'wait',retry_at:row.job.lease_expires_at};
      if(row.next_due>now)return {kind:'wait',retry_at:row.next_due};
      if(row.job && now-row.job.started_at>=this.limits.runMs){clearCalendar(this.store,connectionId,calendarId);row.job=null;}
      if(!row.job) {
        clearCalendar(this.store,connectionId,calendarId);
        if(row.sync_token)this.store.sql.exec('INSERT INTO google_event_stage SELECT * FROM google_events WHERE connection_id = ? AND calendar_id = ?',connectionId,calendarId);
        try { this.budget('google_event_stage',connectionId,calendarId); }
        catch(error) {
          if(error.code!=='calendar_collection_limit')throw error;
          clearCalendar(this.store,connectionId,calendarId);row.claim_failures=(row.claim_failures??0)+1;row.error=error.code;row.next_due=now+60000;row.status=row.claim_failures>=this.limits.failures?'paused':'backoff';put(this.store,row);
          return row.status==='paused'?{kind:'paused',error:row.error}:{kind:'wait',retry_at:row.next_due};
        }
        row.claim_failures=0;
        row.job={id:crypto.randomUUID(),base_sync_token:row.sync_token,page_token:null,page_count:0,failures:0,started_at:now,time_zone:row.time_zone};
      }
      row.job.lease=crypto.randomUUID();row.job.lease_expires_at=now+this.limits.leaseMs;row.status='collecting';row.error=null;put(this.store,row);
      return {kind:'page',connectionId,calendarId,generation:row.generation,selectionRevision:row.selection_revision,runId:row.job.id,lease:row.job.lease,pageNumber:row.job.page_count,pageToken:row.job.page_token,syncToken:row.job.base_sync_token};
    });
  }
  current(claim) {
    const selection=this.selected(claim.connectionId,claim.calendarId),row=this.row(claim.connectionId,claim.calendarId);
    if(!row?.job || row.generation!==claim.generation || selection.connection_generation!==claim.generation || row.selection_revision!==claim.selectionRevision || selection.revision!==claim.selectionRevision || row.job.id!==claim.runId || row.job.lease!==claim.lease || row.job.page_count!==claim.pageNumber || row.job.page_token!==claim.pageToken || row.job.base_sync_token!==claim.syncToken || row.job.lease_expires_at<=this.now())fail('collection_lease_stale',409);
    return row;
  }
  assertCurrent(tenant,claim) { this.transaction(tenant,()=>{this.current(claim);}); }
  async commit(tenant,claim,input) {
    const page=validateGoogleEventPage(input),cursorHash=page.next_page_token?await hash(page.next_page_token):null;
    return this.transaction(tenant,meta=>{
      const row=this.current(claim),now=this.now(),job=row.job;
      if(job.page_count>=this.limits.pages || page.next_page_token && job.page_count+1>=this.limits.pages)fail('calendar_collection_limit',409);
      if(cursorHash){if(this.store.row('SELECT 1 AS found FROM google_page_history WHERE connection_id = ? AND calendar_id = ? AND cursor_hash = ?',claim.connectionId,claim.calendarId,cursorHash))fail('calendar_cursor_repeated',409);this.store.sql.exec('INSERT INTO google_page_history VALUES (?,?,?)',claim.connectionId,claim.calendarId,cursorHash);}
      for(const event of page.items) {
        const body=JSON.stringify(event);
        this.store.sql.exec('INSERT INTO google_event_stage VALUES (?,?,?,?,?) ON CONFLICT(connection_id,calendar_id,event_id) DO UPDATE SET body=excluded.body,byte_count=excluded.byte_count',claim.connectionId,claim.calendarId,event.id,body,bytes(body));
      }
      this.budget('google_event_stage',claim.connectionId,claim.calendarId);
      job.page_count++;job.page_token=page.next_page_token;job.lease=null;job.lease_expires_at=0;if(page.time_zone!==null)job.time_zone=page.time_zone;
      if(page.next_page_token){row.next_due=now+1000;put(this.store,row);return {published:false,pages_staged:job.page_count};}
      this.store.sql.exec('DELETE FROM google_events WHERE connection_id = ? AND calendar_id = ?',claim.connectionId,claim.calendarId);
      this.store.sql.exec('INSERT INTO google_events SELECT * FROM google_event_stage WHERE connection_id = ? AND calendar_id = ?',claim.connectionId,claim.calendarId);
      this.budget('google_events',claim.connectionId,claim.calendarId);
      row.sync_token=page.next_sync_token;row.snapshot_revision++;row.snapshot_id=crypto.randomUUID();row.last_successful_sync=new Date(now).toISOString();row.time_zone=job.time_zone;row.job=null;row.status='idle';row.error=null;row.next_due=now+this.limits.intervalMs;
      clearCalendar(this.store,claim.connectionId,claim.calendarId);put(this.store,row);
      this.store.sql.exec('UPDATE workspace_meta SET account_revision = ? WHERE singleton = 1',meta.account_revision+1);
      return {published:true,...publicState(row,now)};
    });
  }
  failure(tenant,claim,{code,retryAfterSeconds=0}) {
    const retryable=['calendar_provider_unavailable','calendar_provider_timeout','google_refresh_pending'];
    const paused=['calendar_collection_limit','calendar_cursor_repeated','calendar_provider_invalid_response','calendar_provider_redirect_rejected','calendar_provider_request_rejected'];
    if(![...retryable,...paused,'calendar_full_sync_required','calendar_not_accessible'].includes(code)||!Number.isSafeInteger(retryAfterSeconds)||retryAfterSeconds<0||retryAfterSeconds>86400000)fail('invalid_collection_failure');
    return this.transaction(tenant,meta=>{
      const row=this.current(claim),now=this.now();
      if(code==='calendar_full_sync_required' && !row.job.base_sync_token)fail('invalid_collection_failure');
      if(['calendar_full_sync_required','calendar_not_accessible'].includes(code)) {
        clearCalendar(this.store,claim.connectionId,claim.calendarId,true);
        row.sync_token=null;row.last_successful_sync=null;row.time_zone=null;row.snapshot_revision++;row.snapshot_id=crypto.randomUUID();row.job=null;row.error=code;row.status=code==='calendar_full_sync_required'?'queued':'paused';row.next_due=now+1000;put(this.store,row);
        this.store.sql.exec('UPDATE workspace_meta SET account_revision = ? WHERE singleton = 1',meta.account_revision+1);
      } else {
        row.job.failures++;row.job.lease=null;row.job.lease_expires_at=0;row.error=code;
        if(paused.includes(code)||row.job.failures>=this.limits.failures){clearCalendar(this.store,claim.connectionId,claim.calendarId);row.job=null;row.status='paused';}
        else {row.status='backoff';const delay=Math.min(3600000,30000*2**(row.job.failures-1));const jitter=crypto.getRandomValues(new Uint32Array(1))[0]%(Math.floor(delay/4)+1);row.next_due=now+Math.max(delay+jitter,retryAfterSeconds*1000);}
        put(this.store,row);
      }
      return publicState(row,now);
    });
  }
  snapshot(tenant,{connectionId,calendarId,limit=100,cursor=null,snapshotId}) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||cursor!==null && (typeof cursor!=='string'||cursor.length>1024))fail('invalid_collection_read');
    return this.transaction(tenant,()=>{
      this.selected(connectionId,calendarId);const row=this.row(connectionId,calendarId);
      if(cursor!==null && snapshotId===undefined)fail('snapshot_id_required');
      if(snapshotId!==undefined && snapshotId!==(row?.snapshot_id??null))fail('calendar_snapshot_changed',409);
      if(!row)return {snapshot_complete:false,status:'not_synced',snapshot_revision:0,snapshot_id:null,last_successful_sync:null,events:[],next_cursor:null};
      const events=this.store.sql.exec('SELECT event_id,body FROM google_events WHERE connection_id = ? AND calendar_id = ? AND event_id > ? ORDER BY event_id LIMIT ?',connectionId,calendarId,cursor??'',limit+1).toArray();
      return {...publicState(row,this.now()),events:events.slice(0,limit).map(item=>JSON.parse(item.body)),next_cursor:events.length>limit?events[limit-1].event_id:null};
    });
  }
}
