import {TUTOR_PAGE} from './tutor-ui.js';
// Copyright 2026 Daksh Breja. All rights reserved.
export const APP_PATHS=['/','/dashboard','/notes','/learning','/tutor','/calendar','/onboarding','/onboarding/profile','/onboarding/courses','/onboarding/connections','/onboarding/demo','/settings','/demo'];
export const WORKSPACE_NAV=`<nav aria-label="Everyday workspace" class="workspace-nav"><a href="/dashboard">Dashboard</a><a href="/notes">Notes</a><a href="/learning">Learning</a><a href="/tutor">Tutor</a><a href="/calendar">Calendar</a><span class="nav-divider"></span><a href="/onboarding/profile">Setup</a><a href="/onboarding/connections">Connections</a><a href="/settings">Settings</a></nav>
<section id="onboarding-nav" class="setup-steps" hidden><div class="section-top"><p class="eyebrow">SET UP ONCE. RETURN WHEN THINGS CHANGE.</p><a href="/onboarding/demo">Try the sample walkthrough</a></div><nav aria-label="Setup steps"><a href="/onboarding/profile">1 · Profile</a><a href="/onboarding/courses">2 · Courses</a><a href="/onboarding/connections">3 · Connections</a></nav><p id="setup-progress" class="hint"></p></section>
<section id="dashboard-start" class="card" hidden><h2>Make this your school day</h2><p>Add your profile and courses, then choose which sources to connect. Your workspace starts empty.</p><a class="button-link" href="/onboarding/profile">Start setup</a> <a href="/onboarding/demo">Preview onboarding</a></section>`;
export const EXTRA_PAGES=`<section id="learning-page" data-page-section="learning" class="card" hidden><p class="eyebrow">PERSONALIZED LEARNING</p><h2>Your study direction</h2><div id="learning-preferences" class="rows"></div><p><a href="/onboarding/profile">Edit study preferences</a></p><h3>Saved learning progress</h3><p class="hint">Only learning observations explicitly saved in this workspace appear here. Other GPT chats are not imported, and a preference or an explanation does not count as understanding.</p><label>Course<select id="learning-course" class="course-select"></select></label><button id="learning-load" class="secondary">Load saved progress</button><div id="learning-handoff" class="rows" aria-live="polite"></div></section>
${TUTOR_PAGE}
<section id="onboarding-demo" data-page-section="demo" class="card" hidden><p class="eyebrow">SAMPLE WALKTHROUGH · NOTHING IS SAVED</p><h2 id="demo-title">1 · Your profile</h2><p id="demo-description"></p><div id="demo-example" class="demo-example"></div><div class="page-actions"><button id="demo-back" class="secondary">Previous</button><button id="demo-next">Next step</button><a href="/onboarding/profile">Set up my own workspace</a></div><p class="hint">All examples are fictional. This walkthrough never requests access, writes profile data or connects a source.</p></section>`;
export function createWorkspacePages({api,row,notice,workspace,assertOwner}){
  const $=s=>document.querySelector(s),demoMode=document.body.dataset.demo==='true',currentPath=()=>demoMode?(location.pathname.slice(5)||'/dashboard'):location.pathname,routePath=p=>demoMode?'/demo'+p:p;
  const routes={
    '/demo':{page:'personal-demo',title:'Welcome back, John!',description:'A fictional day with Sidekick. See how your goals, deadlines and saved progress shape a personal plan.'},
    '/dashboard':{page:'dashboard',title:'Your school day.',description:'Deadlines, instructor updates and a clear place to begin.'},
    '/notes':{page:'notes',title:'Your course library.',description:'Keep notes, course text and transcript exports together.'},
    '/learning':{page:'learning',title:'Learning that builds on you.',description:'Your study preferences and explicitly saved learning progress.'},
    '/tutor':{page:'tutor',title:'Your tutor, in one place.',description:'Learn from selected course materials and resume your saved session.'},
    '/calendar':{page:'calendar',title:'See what’s coming.',description:demoMode?'John’s fictional classes, study time and club plans.':'Your school feeds, selected Google calendars and imported events.'},
    '/onboarding/profile':{page:'profile',title:'Make this workspace yours.',description:'Start with your profile. School details and study preferences are optional.'},
    '/onboarding/courses':{page:'courses',title:'Add your classes.',description:'Keep each course, section and term separate from the start.'},
    '/onboarding/connections':{page:'connections',title:'Choose what to connect.',description:'Connect only the sources you want. Each connection asks for its own permission.'},
    '/onboarding/demo':{page:'demo',title:'Take a quick look around.',description:'Three sample steps from an empty workspace to a school-day dashboard.'},
    '/settings':{page:'settings',title:'Your workspace, your control.',description:'Manage your data and review the optional tools available to you.'}
  };
  const legacy={'#today':'/calendar','#daily':'/dashboard','#setup':'/onboarding/profile','#sources':'/onboarding/connections','#materials':'/notes','#tools':'/settings','#privacy':'/settings'};
  if(new URL(location.href).searchParams.has('calendar'))history.replaceState(null,'','/onboarding/connections');
  let active='',defaultEntry=currentPath()==='/'&&!legacy[location.hash],learningGeneration=0,owner=null;
  function renderRoute({focus=false}={}){
    let path=legacy[location.hash]||currentPath();
    if(path==='/'||path==='/onboarding')path=path==='/onboarding'?'/onboarding/profile':'/dashboard';
    if(!routes[path])path='/dashboard';
    if(location.pathname!==routePath(path)||legacy[location.hash])history.replaceState(null,'',routePath(path));
    if(demoMode)for(const a of document.querySelectorAll('a[href^="/"]')){if(!a.hasAttribute('data-demo-exit')&&!a.pathname.startsWith('/demo'))a.href='/demo'+a.getAttribute('href');}
    const route=routes[path];active=path;
    for(const element of document.querySelectorAll('[data-page-section]'))element.hidden=!element.dataset.pageSection.split(' ').includes(route.page);
    if(demoMode||!workspace()?.capabilities?.study_connector)$('#material-relay').hidden=true;
    $('#onboarding-nav').hidden=!['profile','courses','connections'].includes(route.page);
    $('#dashboard-start').hidden=route.page!=='dashboard'||!workspace()||Boolean(workspace().profile)||workspace().deleted;
    $('#page-title').textContent=route.page==='dashboard'&&workspace()?.profile?'Welcome back, '+(workspace().profile.preferred_name||workspace().profile.display_name)+'!':route.title;$('#page-description').textContent=route.description;document.title=route.title.replace(/\.$/,'')+' · Sidekick';
    for(const link of document.querySelectorAll('nav a')){if(new URL(link.href).pathname===routePath(path))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
    if(focus){$('#page-title').focus({preventScroll:true});window.scrollTo(0,0);}
  }
  function navigate(path){if(!routes[path])return;defaultEntry=false;if(location.pathname!==routePath(path))history.pushState(null,'',routePath(path));renderRoute({focus:true});}
  document.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest('a[href]');if(!link||link.target||link.hasAttribute('download')||link.hasAttribute('data-demo-exit'))return;
    const target=new URL(link.href);if(target.origin!==location.origin||target.search)return;
    if(!demoMode&&target.pathname.startsWith('/demo'))return;
    const path=legacy[target.hash]||(demoMode?target.pathname.replace(/^\/demo/,''):target.pathname);
    if(!routes[path])return;event.preventDefault();navigate(path);
  });
  window.addEventListener('popstate',()=>{defaultEntry=false;renderRoute({focus:true});});
  window.addEventListener('hashchange',()=>{defaultEntry=false;renderRoute({focus:true});});
  function update(data,materials){
    if(owner!==data.workspace_id||data.deleted){owner=data.workspace_id;++learningGeneration;$('#learning-handoff').replaceChildren();}
    if(defaultEntry){defaultEntry=false;history.replaceState(null,'',routePath(data.profile?'/dashboard':'/onboarding/profile'));}
    $('#setup-progress').textContent=(data.profile?'Profile saved':'Profile not saved')+' · '+data.courses.length+' course(s) added · Connections are optional and checked separately.';
    $('#learning-preferences').replaceChildren();row($('#learning-preferences'),'Study goals',data.profile?.study_goals||'No goals saved yet.');row($('#learning-preferences'),'How you like to learn',data.profile?.learning_preferences||'No preferences saved yet.');

    if(!$('#learning-handoff').children.length)row($('#learning-handoff'),'Choose a course','Load its saved progress to see what was actually recorded.');
    renderRoute();
  }
  $('#learning-course').addEventListener('change',()=>{++learningGeneration;$('#learning-handoff').replaceChildren();});
  $('#learning-load').addEventListener('click',async()=>{
    const course=$('#learning-course').value,expected=workspace()?.workspace_id,generation=++learningGeneration,button=$('#learning-load');if(!course){notice('Choose a course first.',true);return;}button.disabled=true;
    try{assertOwner(expected);const result=await api('/api/learning?course_id='+encodeURIComponent(course),'GET',undefined,expected);assertOwner(expected);if(generation!==learningGeneration||$('#learning-course').value!==course)return;
      const box=$('#learning-handoff');box.replaceChildren();if(result.tutor_resume){const t=result.tutor_resume;row(box,'Website tutor · saved '+t.updated_at,t.summary.correct+' independently correct practice checks · '+t.summary.assisted_correct+' with help · '+t.summary.incorrect+' incorrect. '+(t.pending_question?'Next: '+t.pending_question:'Open Tutor to continue.'));}if(!result.record){row(box,'Other saved learning handoffs','Open Tutor to begin or resume a website study session.');return;}
      row(box,'Last saved handoff',result.record.resume||'No resume note was saved.');
      for(const observation of result.record.observations)row(box,observation.topic_id,observation.outcome+' · '+observation.assistance+' · '+observation.evidence+' — '+observation.next_step);
      const summary=result.course_summary;row(box,'Recorded evidence',summary.independent_observed_correct+' independently correct · '+summary.assisted_observed_correct+' correct with assistance · '+summary.observed_partial+' partial · '+summary.observed_incorrect+' incorrect. These counts cover saved observations only.');
    }catch(error){if(generation===learningGeneration)notice(error.message,true);}finally{button.disabled=false;}
  });
  const samples=[['1 · Your profile','Choose your name, time zone and optional study preferences.','Example student: John · America/New_York · “Practice questions, then a worked example.”'],['2 · Your courses','Add the classes and terms you want to organize.','Example course: BIO 101 · Section A · Sample fall term'],['3 · Your connections','Choose a calendar or course feed and give permission separately. You can also begin with manual notes.','Sample only: no account access requested. Your own dashboard will use only the sources you actually connect.']];let sample=0;
  function demo(){const [title,description,example]=samples[sample];$('#demo-title').textContent=title;$('#demo-description').textContent=description;$('#demo-example').textContent=example;$('#demo-back').disabled=sample===0;$('#demo-next').textContent=sample===2?'Start again':'Next step';}
  $('#demo-back').addEventListener('click',()=>{sample=Math.max(0,sample-1);demo();});$('#demo-next').addEventListener('click',()=>{sample=(sample+1)%samples.length;demo();});
  demo();renderRoute();return {update,navigate,clear(){++learningGeneration;$('#learning-handoff').replaceChildren();$('#learning-preferences').replaceChildren();$('#tutor-readiness').replaceChildren();$('#dashboard-start').hidden=true;}};
}
