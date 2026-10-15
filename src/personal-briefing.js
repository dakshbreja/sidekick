// Copyright 2026 Daksh Breja. All rights reserved.
// Deterministic recommendations: no inference spend, grade predictions or hidden chat access.
export function buildPersonalBriefing({profile=null,groups,planningItems=null,sources=[],announcements=[],checkpoints=[],now=Date.now(),timezone='UTC'}){
  const name=(profile?.preferred_name||profile?.display_name||'').trim();
  const minutes=profile?.study_session_minutes||25,leadDays=profile?.exam_prep_days||7;
  const format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const candidates=(planningItems||[...groups.overdue,...groups.due_today,...groups.upcoming]).map(item=>{
    const remaining=(Date.parse(item.due_at)-now)/86400000;
    const exam=item.work_kind==='exam';
    const urgent=remaining<0?10000:remaining<=1?5000:0;
    return {...item,score:urgent+(exam&&remaining<=leadDays?2000:0)-remaining*10,exam,remaining};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const focus=candidates.slice(0,3).map((item,index)=>{
    const checkpoint=checkpoints.find(c=>c.course_id===item.course_id&&!c.test_only)||null;
    const reason=item.remaining<0?'Its saved deadline has passed; check the requirement and submission status first.':item.remaining<=1?'Its saved deadline is within a day.':item.exam&&item.remaining<=leadDays?'It is inside your '+leadDays+'-day exam preparation window.':'It is one of your nearest saved deadlines.';
    const next=item.progress?.status==='blocked'?'Start by resolving the blocker you reported.':item.progress?.status==='in_progress'?'You reported starting this. Pick one unfinished part for this session.':item.exam?'Start with one diagnostic question, then work on the reasoning that needs practice.':'Choose one concrete next step and give it a focused session.';
    return {id:item.id,course_id:item.course_id,course_code:item.course_code,title:item.title,due_at:item.due_at,due_label:format.format(new Date(item.due_at)),kind:item.work_kind||'assignment',priority:index===0?'Start here':'Keep in view',reason,next,
      progress:item.progress?.status||'not_recorded',progress_note:item.progress?.note?.slice(0,300)||'',source:item.origin==='manual'?'Deadline added by you':'Saved course feed',source_warning:item.origin!=='manual'&&(item.source_status!=='connected'||!item.last_checked||now-Date.parse(item.last_checked)>1800000),
      checkpoint:checkpoint?{session_id:checkpoint.session_id,revision:checkpoint.revision,updated_at:checkpoint.updated_at,assistance:checkpoint.assistance,source_status:checkpoint.source_status,next_step:checkpoint.next_step?.slice(0,400)||''}:null};
  });
  const checked=sources.filter(s=>s.last_successful_sync&&Number.isFinite(Date.parse(s.last_successful_sync)));
  const latest=checked.map(s=>s.last_successful_sync).sort().at(-1)||null;
  const needsAttention=sources.some(s=>s.status!=='connected'||s.freshness!=='recent'||s.error);
  return {greeting:name?'Welcome back, '+name+'!':'Welcome. Let’s make this yours.',intro:focus.length?'You don’t have to tackle everything at once. Here’s a manageable place to start.':'Good to see you. Add a deadline or some course notes, and we’ll build a plan from there.',
    focus,session_minutes:minutes,exam_prep_days:leadDays,target_percent:profile?.exam_target_percent??null,
    preferences:{goals:profile?.study_goals||'',learning:profile?.learning_preferences||''},
    source_summary:!sources.length?'No eLC feeds connected yet. This plan uses the deadlines you added.':!latest?'Your course feed connections are saved; their first successful check is still pending.':(needsAttention?'Some course feeds need attention. ':'')+'Last successful feed check: '+format.format(new Date(latest))+'. '+checked.length+' of '+sources.length+' connected feeds have completed a check.',
    latest_checked_at:latest,source_attention:needsAttention,date_changes:announcements.filter(a=>a.review_date_change).length,
    boundary:'Feed checks cover their published entries, not the whole portal. Progress is what you reported; it has not been compared with a project rubric.',
    assessment_note:'Saved study feedback is an assistant report. Helped answers and practice scores do not establish mastery.'};
}

export function fictionalSidekickDay(){
  // Read-only display fixture. These identities never enter a student's records.
  const now=Date.parse('2026-10-14T16:00:00Z');
  const groups={overdue:[],due_today:[],upcoming:[
    {id:'demo-project',course_id:'fictional-design',course_code:'DES 110',title:'Design project',due_at:'2026-10-17T03:59:00Z',work_kind:'project',origin:'manual',progress:{status:'in_progress',note:'Fictional student report: outline and first draft complete; final section and rubric review remain.'}},
    {id:'demo-exam',course_id:'fictional-physics',course_code:'PHYS 202',title:'Physics II exam',due_at:'2026-10-19T14:00:00Z',work_kind:'exam',origin:'manual'},
    {id:'demo-problems',course_id:'fictional-physics',course_code:'PHYS 202',title:'Practice problem set',due_at:'2026-10-18T21:00:00Z',work_kind:'assignment',origin:'manual'}]};
  return buildPersonalBriefing({now,timezone:'America/New_York',groups,profile:{display_name:'John Doe',preferred_name:'John',study_session_minutes:25,exam_prep_days:10,exam_target_percent:85,study_goals:'Aim for 85% on my next exam. Make steady progress on the project.',learning_preferences:'I prefer extra time before tests and short sessions. Ask me to explain my reasoning before showing an example.'},sources:[{status:'connected',freshness:'recent',last_successful_sync:'2026-10-14T15:50:00Z'}],checkpoints:[{course_id:'fictional-physics',session_id:'fictional-session',revision:2,assistance:'hints',source_status:'current',updated_at:'2026-10-13T20:00:00Z',next_step:'Explain the direction of the electric field in your own words, then try a new example.'}]});
}
