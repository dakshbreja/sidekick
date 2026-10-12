import test from 'node:test';
import assert from 'node:assert/strict';
import {readJSON,mutationOrigin,queryData,writePacket} from '../src/http.js';
import {calendarImport} from '../src/calendar-import.js';
const post=(body,headers={})=>new Request('https://workspace.example/api/courses',{method:'PUT',headers:{'Content-Type':'application/json',...headers},body});
test('request parsing rejects oversized stream without trusting declared length',async()=>{
  await assert.rejects(readJSON(post(JSON.stringify({a:'x'.repeat(100)})),20),{code:'request_too_large'});
});
test('reject malformed JSON, arrays, incorrect type and absent body',async()=>{
  await assert.rejects(readJSON(post('{')),{code:'invalid_json'});
  await assert.rejects(readJSON(post('[]')),{code:'object_required'});
  await assert.rejects(readJSON(post('{}',{'Content-Type':'text/plain'})),{code:'json_required'});
});
test('same-origin mutations accepted, hostile sites blocked',()=>{
  mutationOrigin(post('{}',{'Origin':'https://workspace.example'}));
  assert.throws(()=>mutationOrigin(post('{}',{'Origin':'https://hostile.example'})),{code:'cross_origin_write'});
  assert.throws(()=>mutationOrigin(post('{}',{'Sec-Fetch-Site':'cross-site'})),{code:'cross_origin_write'});
});
test('client owner selectors, duplicate filters and invalid write revisions rejected',()=>{
  assert.throws(()=>queryData(new URL('https://workspace.example?tenant_id=b'),['course_id']),{code:'unknown_query_field'});
  assert.throws(()=>queryData(new URL('https://workspace.example?course_id=a&course_id=b'),['course_id']),{code:'unknown_query_field'});
  assert.throws(()=>writePacket({operation_id:'short',expected_revision:0}),{code:'operation_id_required'});
  assert.throws(()=>writePacket({operation_id:'operation-one',expected_revision:-1}),{code:'expected_revision_required'});
});
const ics=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nDTSTART;TZID=America/New_York:20261015T090000\r\nDTEND;TZID=America/New_York:20261015T100000\r\nSUMMARY:Synthetic study group\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
test('synthetic ICS import supplies dates and bounded import-only coverage',()=>{
  const result=calendarImport({id:'calendar-a',course_id:'course-a',source_id:'source-a',ics},{now:new Date('2026-10-12T12:00:00Z')});
  assert.equal(result.events[0].start,'2026-10-15T13:00:00.000Z');
  assert.equal(result.coverage.mode,'imported_only');assert.equal(result.coverage.complete,true);
});
test('calendar cannot smuggle tenant or connection claims',()=>{
  assert.throws(()=>calendarImport({ics,tenant_id:'another'}),{code:'unknown_calendar_field'});
  assert.throws(()=>calendarImport({ics:'not a calendar'}),{code:'invalid_calendar'});
});
test('unsupported recurrence remains explicit rather than pretending complete coverage',()=>{
  const result=calendarImport({id:'a',course_id:'c',source_id:'s',ics:ics.replace('SUMMARY:','RRULE:FREQ=HOURLY\r\nSUMMARY:')},{now:new Date('2026-10-12T12:00:00Z')});
  assert.equal(result.coverage.complete,false);assert.ok(result.coverage.warnings.length);
});
