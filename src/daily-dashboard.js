// Copyright 2026 Daksh Breja. All rights reserved.
import {buildPersonalBriefing} from './personal-briefing.js';
import {checkStudySources} from './study.js';
import {feedRows,publicFeed} from './school-feed-state.js';
export function schoolItems(store,{feeds=feedRows(store).filter(f=>f.status!=='removed')}={}){
  const manual=store.sql.exec("SELECT body FROM records WHERE kind='assignments'").toArray().map(r=>({...JSON.parse(r.body),category:'deadline',origin:'manual'}));
  return [...manual,...feeds.flatMap(f=>(f.snapshot?.events||[]).map(e=>({...e,course_id:f.course_id,term_id:f.term_id,source_id:f.id,due_at:e.start,origin:'elc_feed',source_status:f.status,last_checked:f.last_successful_sync})))];
}
export function dailyDashboard(store,{now=Date.now()}={}){
  const profile=store.getRecord('profile','profile'),timezone=profile?.timezone||'UTC';
  const planningItems=[],planningEnd=now+Math.max(7,profile?.exam_prep_days||7)*86400000;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}),day=value=>formatter.format(new Date(value));
  const allFeeds=feedRows(store),feeds=allFeeds.filter(f=>f.status!=='removed');
  const today=day(now),week=day(now+7*86400000),courses=new Map(store.sql.exec("SELECT body FROM records WHERE kind='courses'").toArray().map(r=>{const c=JSON.parse(r.body);return [c.id,c];}));
  const groups={overdue:[],due_today:[],upcoming:[],completed:[],events:[],review:[]};
  for(const item of schoolItems(store,{feeds})){
    const course=courses.get(item.course_id),progress=store.getRecord('progress','daily_'+item.id);
    const entry={...item,course_code:course?.code||'',term_id:course?.term_id||item.term_id,progress:progress||null};
    if(progress?.status==='done'&&progress.submitted===true&&progress.verification==='reported'){groups.completed.push(entry);continue;}
    if(item.source_missing){groups.review.push(entry);continue;}
    if(item.category!=='deadline'){if(day(item.end||item.due_at)>=today&&day(item.due_at)<=week)groups.events.push(entry);continue;}
    if(Date.parse(item.due_at)<=planningEnd)planningItems.push(entry);
    const due=day(item.due_at);
    if(due<today)groups.overdue.push(entry);else if(due===today)groups.due_today.push(entry);else if(due<=week)groups.upcoming.push(entry);
  }
  const announcements=feeds.flatMap(f=>(f.snapshot?.announcements||[]).map(a=>({...a,text:a.text.slice(0,2500),course_code:courses.get(f.course_id)?.code||'',course_id:f.course_id,source_id:f.id,last_checked:f.last_successful_sync}))).sort((a,b)=>b.published_at.localeCompare(a.published_at));
  const counts={};let complete=true;
  for(const [name,items] of Object.entries(groups)){items.sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.id.localeCompare(b.id));counts[name]=items.length;groups[name]=items.slice(0,100);if(items.length>100)complete=false;}
  const checkpoints=store.sql.exec("SELECT body FROM records WHERE kind='study_sessions' AND json_extract(body,'$.test_only')=0 ORDER BY updated_at DESC, id DESC").toArray().map(r=>{const c=JSON.parse(r.body);return {...c,source_status:checkStudySources(store,c,null).status};});
  const personal=buildPersonalBriefing({profile,groups,planningItems,sources:feeds.map(f=>publicFeed(f,now)),announcements,checkpoints,now,timezone});
  return {ok:true,personal,today,timezone,generated_at:new Date(now).toISOString(),groups,counts,display_complete:complete,announcements:announcements.slice(0,100),announcement_count:announcements.length,
    sources:feeds.map(f=>publicFeed(f,now)),inactive_sources:allFeeds.filter(f=>f.status==='removed').map(f=>publicFeed(f,now)),coverage:'Only connected feeds and explicitly added deadlines. Calendar events do not prove completion; feeds do not cover all course work.',
    briefing:counts.due_today+' due today, '+counts.overdue+' overdue, '+counts.upcoming+' due in the next 7 days, based on saved sources. '+(announcements.some(a=>a.review_date_change)?'Instructor date changes need review. ':'')+(feeds.some(f=>publicFeed(f,now).freshness!=='recent'||f.error)?'Some school sources need a fresh check.':'')};
}
