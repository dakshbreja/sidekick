// Copyright 2026 Daksh Breja. All rights reserved.
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {parseICS} from './core/ics.js';
import {fail, string} from './validation.js';
export const FEED_LIMITS={bytes:250000,events:500,announcements:200,feeds:20,interval:900000};
export const schoolFeedsEnabled=env=>env.SCHOOL_FEEDS_ENABLED==='true' && Boolean(env.COLLECTION_BUDGETS) && /^[A-Za-z0-9_-]{43}$/.test(env.GOOGLE_CREDENTIAL_KEY||'');
export function feedURL(value,kind){
  string(value,4096);let url;try{url=new URL(value);}catch{fail('invalid_school_feed');}
  if(url.protocol!=='https:' || url.hostname!=='uga.view.usg.edu' || url.port || url.username || url.password || url.hash || /[\u0000-\u0020\u007f]/.test(value))fail('invalid_school_feed');
  let org=null;
  if(kind==='calendar'){if(url.pathname!=='/d2l/le/calendar/feed/user/feed.ics')fail('invalid_school_feed');}
  else if(kind==='announcements'){
    org=url.pathname.match(/^\/d2l\/le\/news\/rss\/([1-9]\d{0,11})\/course$/)?.[1];
    if(!org || url.searchParams.get('ou')!==org)fail('invalid_school_feed');
  }else fail('invalid_school_feed');
  if(!url.searchParams.get('token') || url.searchParams.get('token').length<8)fail('invalid_school_feed');
  for(const key of url.searchParams.keys())if(url.searchParams.getAll(key).length!==1)fail('invalid_school_feed');
  return {url:url.href,org};
}
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export const itemId=async(feedId,uid,anchor)=>'school_'+await digest(JSON.stringify([feedId,uid,anchor]));
const text=value=>typeof value==='string'?value:typeof value==='number'?String(value):'';
const plain=value=>text(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export async function parseSchoolFeed(raw,feed,{now=Date.now(),timezone='UTC',url}={}){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>FEED_LIMITS.bytes)fail('school_feed_too_large');
  if(url)raw=raw.split(url).join('[private feed address]');
  if(feed.kind==='calendar'){
    if(!/^BEGIN:VCALENDAR\r?$/m.test(raw)||!/^END:VCALENDAR\r?$/m.test(raw))fail('invalid_school_calendar');
    const windowStart=new Date(now-30*86400000),windowEnd=new Date(now+180*86400000);
    let parsed;try{parsed=parseICS(raw,{windowStart,windowEnd,source:'school_feed',defaultTz:timezone});}catch{fail('invalid_school_calendar');}
    if(parsed.length>FEED_LIMITS.events)fail('school_feed_event_limit');
    const events=await Promise.all(parsed.map(async e=>{
      if(!e.uid || e.uid.length>200 || e.summary.length>200)fail('invalid_school_calendar');
      return {id:await itemId(feed.id,e.uid,e.recurrence_anchor),uid:e.uid,anchor:e.recurrence_anchor,title:e.summary||'Untitled event',start:e.start.toISOString(),end:e.end?.toISOString()||null,all_day:e.allDay,
        category:/\b(?:due|deadline)\b/i.test(e.summary)&&! /\b(?:opens?|available|closes?)\b/i.test(e.summary)?'deadline':'event'};
    }));
    if(new Set(events.map(e=>e.id)).size!==events.length)fail('school_feed_duplicate_event');
    return {events,announcements:[],coverage:{mode:'calendar_window',window_start:windowStart.toISOString(),window_end:windowEnd.toISOString(),complete:parsed.warnings.length===0,warnings:parsed.warnings}};
  }
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)||XMLValidator.validate(raw)!==true)fail('invalid_school_announcements');
  const doc=new XMLParser({ignoreAttributes:true,parseTagValue:false,trimValues:true,processEntities:true,isArray:(_name,path)=>path==='rss.channel.item'}).parse(raw);
  const channel=doc?.rss?.channel;if(!channel||typeof channel!=='object')fail('invalid_school_announcements');
  const items=channel.item||[];if(!Array.isArray(items)||items.length>100)fail('school_feed_announcement_limit');
  const announcements=[];
  for(const item of items){
    const guid=text(item.guid),match=guid.match(/^([1-9]\d{0,11})-([1-9]\d{0,11})$/);
    let link;try{link=new URL(text(item.link));}catch{fail('invalid_school_announcements');}
    if(!match||match[2]!==feed.org||link.protocol!=='https:'||link.hostname!=='uga.view.usg.edu'||link.port||link.username||link.password||link.searchParams.get('ou')!==feed.org)fail('invalid_school_announcements');
    const title=plain(item.title),body=plain(item.description);if(!title||title.length>300||body.length>12000)fail('school_feed_announcement_limit');
    const published=Date.parse(text(item.pubDate));if(!Number.isFinite(published))fail('invalid_school_announcements');
    announcements.push({id:await itemId(feed.id,guid,''),title,text:body,published_at:new Date(published).toISOString(),url:'https://uga.view.usg.edu/d2l/le/news/'+feed.org+'/'+match[1]+'/view',
      review_date_change:/\b(?:exam|test|quiz|assignment|due|deadline)\b/i.test(title+' '+body)&&/\b(?:moved|changed|rescheduled|extended|postponed|instead|new date|now due)\b/i.test(title+' '+body)});
  }
  if(new Set(announcements.map(a=>a.id)).size!==announcements.length)fail('school_feed_duplicate_announcement');
  return {events:[],announcements,coverage:{mode:'recent_announcements_only',complete:false,reason:'Feed may omit older posts; absence is not deletion.'}};
}
export async function fetchSchoolFeed(url,fetcher=fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let reader;
  try{
    const response=await fetcher(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'text/calendar, application/rss+xml, application/xml, text/xml'}});
    if([401,403].includes(response.status))fail('school_feed_access_denied');
    if(response.status!==200)fail('school_feed_unavailable');
    if(Number(response.headers.get('content-length'))>FEED_LIMITS.bytes)fail('school_feed_too_large');
    if(!response.body)fail('school_feed_unavailable');reader=response.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>FEED_LIMITS.bytes)fail('school_feed_too_large');chunks.push(value);}
    const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(data);
  }finally{clearTimeout(timer);try{await reader?.cancel();}catch{}}
}
