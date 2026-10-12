// Copyright 2026 Daksh Breja. All rights reserved.
// Methods below run inside the student's SQL/alarm transaction. No external I/O.
import {COLLECTION_BUDGET,reserveWindow} from './collection-budget.js';
import {googleConfigured} from './google-oauth.js';
export function collectionEnabled(env){return env.GOOGLE_COLLECTION_ENABLED==='true' && googleConfigured(env) && Boolean(env.COLLECTION_BUDGETS);}
export function initializeGoogleSchedule(store){store.sql.exec('CREATE TABLE IF NOT EXISTS google_schedule (singleton INTEGER PRIMARY KEY CHECK(singleton=1),body TEXT NOT NULL)');}
export class GoogleScheduler {
  constructor(store,{clock=()=>Date.now()}={}){this.store=store;this.clock=clock;}
  account(){return this.store.row('SELECT * FROM workspace_meta WHERE singleton=1');}
  state(){const row=this.store.row('SELECT body FROM google_schedule WHERE singleton=1');return row?JSON.parse(row.body):{budget:{},next_allowed:0,last_key:'',pending:null,failures:0,paused:false,last_error:null};}
  save(state){this.store.sql.exec('INSERT INTO google_schedule VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body',JSON.stringify(state));}
  candidates(){
    const meta=this.account();if(!meta||meta.deleted)return [];
    const choices=this.store.sql.exec("SELECT body FROM records WHERE kind='google_selection' ORDER BY id").toArray().map(row=>JSON.parse(row.body)),items=[];
    for(const selection of choices){
      if(!this.store.activeGoogleConnection(selection.id,selection.connection_generation))continue;
      const auth=this.store.googleConnection(selection.id);
      for(const calendarId of selection.calendar_ids){
        const saved=this.store.row('SELECT body FROM google_collection WHERE connection_id=? AND calendar_id=?',selection.id,calendarId);const row=saved?JSON.parse(saved.body):null;
        if(row?.status==='paused')continue;
        items.push({connectionId:selection.id,calendarId,key:selection.id+'\u0000'+calendarId,due:Math.max(row?.next_due??0,row?.job?.lease_expires_at??0,auth.refresh_retry_at??0,auth.refresh_lease?.expires_at??0)});
      }
    }
    return items.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  }
  nextTime(){
    const candidates=this.candidates(),state=this.state(),now=this.clock();if(!candidates.length||state.paused)return null;
    const budget=reserveWindow(state.budget,now,{hour:COLLECTION_BUDGET.studentHour,day:COLLECTION_BUDGET.studentDay});
    return Math.max(now+1000,Math.min(...candidates.map(item=>item.due)),state.next_allowed,state.pending?.expires_at??0,budget.retry_at??0);
  }
  reserve(){
    const now=this.clock(),state=this.state(),candidates=this.candidates();if(!candidates.length||state.paused)return {kind:'idle'};
    const budget=reserveWindow(state.budget,now,{hour:COLLECTION_BUDGET.studentHour,day:COLLECTION_BUDGET.studentDay});
    if(!budget.allowed||state.next_allowed>now||state.pending?.expires_at>now)return {kind:'wait'};
    const due=candidates.filter(item=>item.due<=now);if(!due.length)return {kind:'wait'};
    const next=due.find(item=>item.key>state.last_key)||due[0],reservationId=crypto.randomUUID();
    state.budget=budget.state;state.last_key=next.key;state.next_allowed=now+COLLECTION_BUDGET.gapMs;state.pending={id:reservationId,expires_at:now+COLLECTION_BUDGET.leaseMs};this.save(state);
    return {kind:'reserved',tenantId:this.account().owner,connectionId:next.connectionId,calendarId:next.calendarId,reservationId};
  }
  finish(reservationId,result,error=false){
    if(this.account()?.deleted)return;
    const state=this.state();if(state.pending?.id!==reservationId)return;state.pending=null;
    if(error){state.failures++;state.paused=state.failures>=8;state.last_error='collection_unavailable';state.next_allowed=Math.max(state.next_allowed,this.clock()+Math.min(3600000,60000*2**(state.failures-1)));}
    else if(result.kind==='global_wait'){state.last_error='collection_global_limit';state.next_allowed=Math.max(state.next_allowed,result.retry_at);}
    else {state.failures=0;state.last_error=null;}
    this.save(state);
  }
  selectionChanged(){const state=this.state();state.failures=0;state.paused=false;if(state.last_error!=='collection_global_limit')state.last_error=null;this.save(state);}
  status(){const state=this.state(),next=this.nextTime();return {status:state.paused?'paused':state.pending?.expires_at>this.clock()?'running':next===null?'idle':'scheduled',next_run_at:next,error:state.last_error};}
}
