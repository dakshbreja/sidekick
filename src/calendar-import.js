import {parseICS} from './core/ics.js';
import {HttpError} from './http.js';

export function calendarImport(data, {now = new Date(), timezone = 'UTC'} = {}) {
  const allowed = ['id','course_id','source_id','ics'];
  if (Object.keys(data).some(k=>!allowed.includes(k))) throw new HttpError('unknown_calendar_field');
  if (typeof data.ics !== 'string' || new TextEncoder().encode(data.ics).length > 250000) throw new HttpError('calendar_too_large', 413);
  if (!/^BEGIN:VCALENDAR\r?$/m.test(data.ics) || !/^END:VCALENDAR\r?$/m.test(data.ics)) throw new HttpError('invalid_calendar');
  const start = new Date(+now - 30*86400000), end = new Date(+now + 180*86400000);
  let parsed;
  try { parsed = parseICS(data.ics, {windowStart:start, windowEnd:end, source:'student_import', defaultTz:timezone}); }
  catch { throw new HttpError('invalid_calendar'); }
  if (parsed.length > 500) throw new HttpError('calendar_event_limit', 413);
  const events = parsed.map(e=>{
    if (!e.uid || e.uid.length>200 || e.summary.length>200 || e.description.length>2000 || e.location.length>300) throw new HttpError('invalid_calendar_event');
    return {uid:e.uid,title:e.summary || 'Untitled event',start:e.start.toISOString(),end:e.end?.toISOString() || null,
      all_day:e.allDay,description:e.description,location:e.location};
  });
  return {id:data.id,course_id:data.course_id,source_id:data.source_id,events,coverage:{mode:'imported_only',
    window_start:start.toISOString(),window_end:end.toISOString(),complete:parsed.warnings.length===0,warnings:parsed.warnings}};
}
