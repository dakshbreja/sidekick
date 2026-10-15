// Copyright 2026 Daksh Breja. All rights reserved.
import {object,operationId} from './validation.js';
import {TUTOR_LIMITS} from './tutor.js';
export class TutorBudget {
  constructor(storage,{now=()=>Date.now()}={}){this.storage=storage;this.now=now;storage.sql.exec('CREATE TABLE IF NOT EXISTS tutor_budget (id TEXT PRIMARY KEY, day TEXT NOT NULL, expires INTEGER NOT NULL)');}
  reserve(input){object(input,['reservationId']);operationId(input.reservationId);return this.storage.transactionSync(()=>{
    const sql=this.storage.sql,now=this.now(),day=new Date(now).toISOString().slice(0,10);
    const newest=sql.exec('SELECT MAX(day) AS day FROM tutor_budget').one().day;
    if(newest&&newest>day)return {allowed:false};
    sql.exec('DELETE FROM tutor_budget WHERE day < ?',day);
    const old=sql.exec('SELECT expires FROM tutor_budget WHERE id = ?',input.reservationId).toArray()[0];
    // A replay never grants a second external call, even while its lease is live.
    if(old)return {allowed:false};
    if(sql.exec('SELECT COUNT(*) AS n FROM tutor_budget').one().n>=TUTOR_LIMITS.globalDaily||sql.exec('SELECT COUNT(*) AS n FROM tutor_budget WHERE expires > ?',now).one().n>=2)return {allowed:false};
    sql.exec('INSERT INTO tutor_budget (id,day,expires) VALUES (?,?,?)',input.reservationId,day,now+TUTOR_LIMITS.leaseMs);
    return {allowed:true};
  });}
  release(input){object(input,['reservationId']);operationId(input.reservationId);this.storage.sql.exec('UPDATE tutor_budget SET expires = 0 WHERE id = ?',input.reservationId);return {ok:true};}
}
