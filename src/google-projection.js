// Copyright 2026 Daksh Breja. All rights reserved.
// Pure projection of one complete, owner-scoped provider snapshot. No I/O.
import {_internals as dates} from './core/ics.js';
const DAY=86400000;
export const PROJECTION_LIMITS=Object.freeze({events:500,steps:20000,days:31,bytes:500000});
const invalid=()=>{throw new Error('invalid_source_time');};
function point(value,defaultZone='UTC'){
 if(value?.date){const date=new Date(value.date+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value.date)invalid();return {date,allDay:true,zone:'UTC'};}
 if(typeof value?.dateTime!=='string')invalid();const zone=value.timeZone||defaultZone;new Intl.DateTimeFormat('en',{timeZone:zone});
 const v=value.dateTime;let date;
 if(/(?:Z|[+-]\d\d:\d\d)$/.test(v))date=new Date(v);
 else {const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(v);if(!m)invalid();date=dates.wallTimeToInstant(...m.slice(1).map(Number),zone);}
 if(!Number.isFinite(+date))invalid();return {date,allDay:false,zone};
}
function recurrenceLines(event,start,warn,budget){
 const rules=[],added=[],excluded=new Set();let unsupported=false;
 for(const line of event.recurrence||[]){
  // Parse properties structurally; source text is never injected into a document.
  if(/[\r\n]/.test(line)){warn('unsupported_recurrence');unsupported=true;continue;}
  const prop=dates.parseLine(line);
  if(!prop||!['RRULE','RDATE','EXDATE'].includes(prop.name)||Object.keys(prop.params).some(k=>!['VALUE','TZID'].includes(k))){warn('unsupported_recurrence');unsupported=true;continue;}
  if(prop.name==='RRULE'){if(Object.keys(prop.params).length){warn('unsupported_recurrence');unsupported=true;}else rules.push(dates.parseRRule(prop.value));continue;}
  if(prop.params.VALUE && !['DATE','DATE-TIME'].includes(prop.params.VALUE)){warn('unsupported_recurrence');unsupported=true;continue;}
  for(const value of prop.value.split(',')){if(--budget.remaining<0){warn('expansion_limit');break;}try{const at=dates.parseDateProp({...prop,value},start.zone);if(!at||at.allDay!==start.allDay)throw new Error();if(prop.name==='EXDATE')excluded.add(+at.date);else added.push(at.date);}catch{warn('invalid_recurrence_date');unsupported=true;}}
 }
 return {rules,added,excluded,unsupported};
}
export function projectGoogleEvents(records,{now=Date.now(),timezone='UTC',limits={}}={}){
 const max={...PROJECTION_LIMITS,...limits};for(const key of Object.keys(max))if(!(key in PROJECTION_LIMITS)||!Number.isInteger(max[key])||max[key]<1||max[key]>PROJECTION_LIMITS[key])throw new Error('invalid_projection_limit');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const windowStart=dates.wallTimeToInstant(...day.split('-').map(Number),0,0,0,timezone),endCivil=new Date(day+'T00:00:00Z');endCivil.setUTCDate(endCivil.getUTCDate()+max.days);const windowEnd=dates.wallTimeToInstant(endCivil.getUTCFullYear(),endCivil.getUTCMonth()+1,endCivil.getUTCDate(),0,0,0,timezone);
 const endDay=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(windowEnd);
 let outputBytes=0,outputFull=false;const encoder=new TextEncoder();
 const warnings=new Map(),warn=code=>warnings.set(code,(warnings.get(code)||0)+1),events=[],budget={remaining:max.steps};
 const byId=new Map(records.map(e=>[e.id,e])),overrides=new Map();
 for(const event of records){if(!event.recurringEventId)continue;try{const parent=byId.get(event.recurringEventId),at=point(event.originalStartTime,parent?.start?.timeZone||'UTC');const key=event.recurringEventId+'\u0000'+ +at.date;if(overrides.has(key)){overrides.set(key,null);warn('conflicting_exceptions');}else overrides.set(key,event.id);}catch{warn('invalid_exception');}}
 function add(event,start,end,anchor,recurring){
  const allDay=Boolean(event.start?.date),startText=allDay?start.toISOString().slice(0,10):start.toISOString(),endText=allDay?end.toISOString().slice(0,10):end.toISOString();
  if(allDay?(endText<=day||startText>=endDay):(+end<=+windowStart&&+start<+windowStart||+start>=+windowEnd))return;
  if(outputFull)return;
  if(events.length>=max.events){warn('event_limit');return;}
  const title=event.summary||'Untitled event';const projected={source_event_id:event.id,occurrence_id:JSON.stringify([event.recurringEventId||event.id,anchor]),title:title.length>500?title.slice(0,499)+'…':title,title_truncated:title.length>500,start:startText,end:endText,all_day:allDay,recurring,status:event.status,source_time_zone:event.start?.timeZone||null};const bytes=encoder.encode(JSON.stringify(projected)).byteLength;if(outputBytes+bytes>max.bytes){outputFull=true;warn('response_limit');return;}outputBytes+=bytes;events.push(projected);
 }
 for(const event of records){
  if(outputFull)break;if(events.length>=max.events){warn('event_limit');break;}
  if(--budget.remaining<0){warn('expansion_limit');break;}
  if(event.status==='cancelled')continue;
  try{
   const start=point(event.start),end=point(event.end);if(start.allDay!==end.allDay||+end.date<+start.date)invalid();
   if(event.recurringEventId){const parent=byId.get(event.recurringEventId);if(parent?.status==='cancelled')continue;const anchor=point(event.originalStartTime,parent?.start?.timeZone||'UTC');if(overrides.get(event.recurringEventId+'\u0000'+ +anchor.date)!==event.id)continue;if(!parent)warn('missing_series');add(event,start.date,end.date,anchor.date.toISOString(),true);continue;}
   if(!event.recurrence?.length){add(event,start.date,end.date,null,false);continue;}
   if(!start.allDay&&!event.start.timeZone){warn('missing_recurrence_zone');continue;}
   if(+start.date%1000){warn('unsupported_recurrence_precision');continue;}
   const duration=+end.date-+start.date;if(duration>366*DAY){warn('recurrence_duration_limit');continue;}const recurrence=recurrenceLines(event,start,warn,budget),starts=new Map([[+start.date,start.date],...recurrence.added.map(d=>[+d,d])]);
   for(const rule of recurrence.rules){const result=dates.expandRecurrence({start:start.date,wall:dates.wallParts(start.date,start.zone)},rule,new Date(+windowStart-duration-DAY),windowEnd,start.zone,budget);if(result.unsupported)warn(result.unsupported==='EXPANSION_LIMIT'?'expansion_limit':'unsupported_recurrence');const baseWall=dates.wallParts(start.date,start.zone);for(const at of result.occurrences){const sameWall=dates.wallParts(at,start.zone).every((value,index)=>value===baseWall[index]);if(!sameWall||+at===+start.date)starts.set(+at,at);}}
   for(const at of [...starts.values()].sort((a,b)=>a-b)){if(recurrence.excluded.has(+at)||overrides.has(event.id+'\u0000'+ +at))continue;add(event,at,new Date(+at+duration),at.toISOString(),true);if(outputFull)break;if(events.length>=max.events){warn('event_limit');break;}}
  }catch{warn('invalid_source_event');}
 }
 events.sort((a,b)=>a.start.localeCompare(b.start)||a.occurrence_id.localeCompare(b.occurrence_id));
 return {representation:'projected_occurrences',recurrence_expanded:true,events,coverage:{complete:warnings.size===0,window_start:windowStart.toISOString(),window_end:windowEnd.toISOString(),start_date:day,end_date:endDay,timezone,warnings:[...warnings].map(([code,count])=>({code,count}))}};
}
