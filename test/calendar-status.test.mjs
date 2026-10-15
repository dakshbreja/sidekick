// Copyright 2026 Daksh Breja. All rights reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarStatus} from '../src/calendar-status.js';
const caps={google_calendar_oauth:true,google_calendar_collection:true};
const selection={active:true,record:{calendar_ids:['a']}};
const calendar={calendar_id:'a',snapshot_complete:true,last_successful_sync:'2026-10-13T00:00:00Z',freshness:'recent',status:'idle'};
const state={authorized:true,collection:{automatic_enabled:true,calendars:[calendar],scheduler:{status:'scheduled'}}};
const agenda=[{data:{snapshot_complete:true,freshness:'recent',coverage:{complete:true},events:[]}}];
const stage=(s=state,sel=selection,a=agenda,c=caps)=>calendarStatus(c,s,sel,a).stage;
test('calendar setup and consent are distinct from registration and selection',()=>{
 assert.equal(calendarStatus().stage,'setup_pending');
 assert.equal(calendarStatus(caps).stage,'consent_pending');
 for(const status of ['needs_authorization','authorizing','exchanging','authorization_denied','authorization_expired','authorization_failed','reauthorization_required'])assert.equal(stage({status,authorized:false}), 'consent_pending');
 assert.equal(stage({authorized:true}, {active:false,record:{calendar_ids:['a']}}),'unselected');
 assert.equal(stage({authorized:true}, {active:true,record:{calendar_ids:[]}}),'unselected');
 assert.equal(stage(state,selection,agenda,{...caps,google_calendar_collection:false}),'setup_pending');
});
test('ready requires actual complete recent collection and complete rendered coverage',()=>{
 assert.equal(stage(),'ready');
 assert.equal(stage({...state,collection:{...state.collection,calendars:[]}}),'syncing');
 assert.equal(stage({...state,collection:{...state.collection,calendars:[{...calendar,snapshot_complete:false,last_successful_sync:null}]}}),'syncing');
 assert.equal(stage({...state,collection:{...state.collection,calendars:[{...calendar,freshness:'stale'}]}}),'stale');
 for(const a of [[],[{unavailable:true}],[{data:{...agenda[0].data,coverage:{complete:false}}}],[{data:{...agenda[0].data,events:Array(101).fill({})}}]])assert.equal(stage(state,selection,a),'partial');
 assert.equal(stage(state,selection,[{...agenda[0],displayLimited:true}]),'partial');
 assert.equal(stage({...state,refresh_error:'google_refresh_unavailable'}),'partial');
 assert.equal(stage({...state,collection:{...state.collection,scheduler:{status:'paused'}}}),'partial');
 assert.equal(stage(state,{active:true,record:{calendar_ids:['a','b']}}),'partial');
});
test('removal, reconnect barriers and unavailable reads never imply a working connection',()=>{
 assert.equal(stage({unavailable:true}),'unavailable');
 assert.equal(calendarStatus(caps,{authorized:true}).stage,'unavailable');
 for(const s of [{status:'revoking'},{revocation:{state:'pending'}},{authorization_blocked:true,authorized:false}])assert.equal(stage(s),'removing');
 for(const removal of ['confirmed','unconfirmed',undefined]){
  const result=calendarStatus(caps,{status:'disconnected',revocation:{state:removal}});
  assert.equal(result.stage,'disconnected');assert.match(result.detail,removal==='confirmed'?/confirmed permission removal/:/not confirmed/);
 }
});
