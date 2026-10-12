// Copyright 2026 Daksh Breja. All rights reserved.
// Pure, bounded scheduled-provider budgets; no student data or credentials.
import {fail} from './validation.js';
export const COLLECTION_BUDGET = Object.freeze({units:3,studentHour:300,studentDay:3000,globalHour:3000,globalDay:30000,gapMs:5000,leaseMs:60000});
export function reserveWindow(previous,now,{hour,day}) {
  const state={...previous},hourStart=Math.floor(now/3600000)*3600000,dayStart=Math.floor(now/86400000)*86400000;
  if(state.hour_start===undefined || hourStart>state.hour_start){state.hour_start=hourStart;state.hour_used=0;}
  if(state.day_start===undefined || dayStart>state.day_start){state.day_start=dayStart;state.day_used=0;}
  const retry=Math.max(state.hour_used+3>hour?state.hour_start+3600000:0,state.day_used+3>day?state.day_start+86400000:0,now<state.hour_start?state.hour_start:0,now<state.day_start?state.day_start:0);
  if(retry>now)return {allowed:false,retry_at:retry,state};
  state.hour_used+=3;state.day_used+=3;return {allowed:true,retry_at:null,state};
}
export class ProviderBudgetStore {
  constructor(storage,{clock=()=>Date.now()}={}){this.storage=storage;this.clock=clock;storage.sql.exec('CREATE TABLE IF NOT EXISTS provider_budget (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL)');storage.sql.exec('CREATE TABLE IF NOT EXISTS provider_reservations (id TEXT PRIMARY KEY,expires INTEGER NOT NULL,body TEXT NOT NULL)');storage.sql.exec('CREATE INDEX IF NOT EXISTS provider_reservation_expiry ON provider_reservations(expires)');}
  reserve({reservationId,...extra}) {
    if(Object.keys(extra).length || typeof reservationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(reservationId))fail('invalid_budget_reservation');
    const now=this.clock();if(!Number.isSafeInteger(now)||now<0)fail('invalid_clock',503);
    return this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM provider_reservations WHERE expires < ?',now-172800000);
      const old=this.storage.sql.exec('SELECT body FROM provider_reservations WHERE id = ?',reservationId).toArray()[0];
      if(old){const saved=JSON.parse(old.body);return saved.allowed && saved.valid_until<=now?{allowed:false,retry_at:now+60000,error:'budget_reservation_expired'}:saved;}
      const row=this.storage.sql.exec('SELECT body FROM provider_budget WHERE singleton=1').toArray()[0];
      const reserved=reserveWindow(row?JSON.parse(row.body):{},now,{hour:COLLECTION_BUDGET.globalHour,day:COLLECTION_BUDGET.globalDay});
      const result={allowed:reserved.allowed,retry_at:reserved.retry_at,valid_until:Math.min(now+60000,reserved.state.hour_start+3600000,reserved.state.day_start+86400000)};
      if(this.storage.sql.exec('SELECT COUNT(*) AS n FROM provider_reservations').toArray()[0].n>=25000)return {allowed:false,retry_at:now+3600000,error:'collection_global_limit'};
      this.storage.sql.exec('INSERT INTO provider_budget VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body',JSON.stringify(reserved.state));
      this.storage.sql.exec('INSERT INTO provider_reservations VALUES (?,?,?)',reservationId,now,JSON.stringify(result));return result;
    });
  }
}
