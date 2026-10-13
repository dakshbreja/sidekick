import {tutorConfigured} from './tutor.js';
import {studyProtocol} from './study-connector.js';
import {APP_PATHS} from './workspace-pages.js';
import {schoolFeedsEnabled} from './school-feed.js';
import {authenticate} from './auth.js';
import {HttpError,json,readJSON,mutationOrigin,queryData,writePacket} from './http.js';
import {calendarImport} from './calendar-import.js';
import {PAGE, CLIENT_SCRIPT, STYLE} from './ui.js';
import {WRITE_MODULE} from './write-intent.js';
import {TEXT_IMPORT_MODULE} from './text-import.js';
import {googleConfigured,GOOGLE_CALLBACK_PATH} from './google-oauth.js';
import {handleGoogleRoute,googleCallbackRedirect} from './google-routes.js';
import {collectionEnabled} from './google-scheduler.js';
import {CONNECTOR_PAGE,CONNECTOR_SCRIPT} from './connector-ui.js';
import {object} from './validation.js';
export {ConnectorBackend} from './connector-backend.js';
export {CollectionBudget} from './collection-budget-object.js';
export {StudentState} from './student-object.js';

const routes = Object.freeze({
  '/api/assignments':{get:'assignments.list',put:'assignments.put',query:['course_id']},
  '/api/courses': {get:'courses.list',put:'courses.put',query:['term_id']},
  '/api/materials': {get:'materials.list',put:'materials.put',query:['course_id']},
  '/api/progress': {get:'progress.list',put:'progress.put',query:['course_id','status']},
  '/api/learning': {get:'learning.get',put:'learning.put',query:['course_id','session_id']},
  '/api/connections': {get:'connections.list',put:'connections.put',query:['provider']},
  '/api/calendar': {get:'calendar.list',query:['course_id','source_id']},
});
const capabilities = Object.freeze({manual_course_setup:true,manual_materials:true,calendar_file_import:true,text_file_import:true,academic_profile:true,
  google_calendar_oauth:false,elc_sync:false,background_collection:false,ai_teaching:false});
const staticResponse=(body,type)=>new Response(body,{headers:{'Content-Type':type,'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});

export default {
  async fetch(request,env) {
    const url=new URL(request.url),path=url.pathname;
    try {
      if(env.CONNECTOR_ENABLED==='true'&&request.method==='GET'&&path==='/ai-access')return staticResponse(CONNECTOR_PAGE,'text/html; charset=utf-8');
      if(env.CONNECTOR_ENABLED==='true'&&request.method==='GET'&&path==='/connector-client.js')return staticResponse(CONNECTOR_SCRIPT,'text/javascript; charset=utf-8');
      if(request.method==='GET' && APP_PATHS.includes(path)) return staticResponse(PAGE,'text/html; charset=utf-8');
      if(request.method==='GET' && path==='/client.js') return staticResponse(CLIENT_SCRIPT,'text/javascript; charset=utf-8');
      if(request.method==='GET' && path==='/write-intent.js') return staticResponse(WRITE_MODULE,'text/javascript; charset=utf-8');
      if(request.method==='GET' && path==='/text-import.js') return staticResponse(TEXT_IMPORT_MODULE,'text/javascript; charset=utf-8');
      if(request.method==='GET' && path==='/style.css') return staticResponse(STYLE,'text/css; charset=utf-8');
      if(request.method==='GET' && path==='/health') return json({ok:true,service:'school-bridge-community',scope:'http_only'});
      if(!path.startsWith('/api/')) return json({ok:false,error:'not_found'},404);
      const identity=await authenticate(request,env);
      if(!env.STUDENTS) throw new HttpError('storage_unavailable',503);
      const student=env.STUDENTS.getByName('student-v1:'+identity.tenantId);
      const dispatch=async(op,data={},packet={})=>student.dispatch({tenantId:identity.tenantId,op,data,...packet});
      const respond=result=>json(result,result.ok?200:result.status||400);
      if(!['GET','PUT','POST','DELETE'].includes(request.method)) throw new HttpError('method_not_allowed',405);
      const expectedWorkspace=request.headers.get('X-Workspace-Id');
      if(expectedWorkspace && expectedWorkspace!==identity.tenantId) throw new HttpError('workspace_changed',403);
      if(request.method!=='GET') {
        mutationOrigin(request);queryData(url,[]);
      }
      if(path.startsWith('/api/ai-access')){
        if(env.CONNECTOR_ENABLED!=='true'||!env.CONNECTOR_AUTH)throw new HttpError('connector_not_configured',503);
        if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);
        if(path==='/api/ai-access'&&request.method==='GET'){queryData(url,[]);return respond(await student.connector({owner:identity.tenantId,op:'list',data:{}}));}
        if(path==='/api/ai-access/request'&&request.method==='GET'){const q=queryData(url,['request']);return respond(await env.CONNECTOR_AUTH.describe(q.request));}
        if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)throw new HttpError('cross_origin_write',403);
        const data=await readJSON(request,8000);
        if(path==='/api/ai-access/revoke'){object(data,['grant_id']);return respond(await student.connector({owner:identity.tenantId,op:'revoke',data}));}
        if(path==='/api/ai-access/approve'){object(data,['request','course_ids','write']);return respond(await env.CONNECTOR_AUTH.approve(data.request,identity.tenantId,data.course_ids,data.write));}
        if(path==='/api/ai-access/deny'){object(data,['request']);return respond(await env.CONNECTOR_AUTH.deny(data.request));}
        throw new HttpError('not_found',404);
      }
      if(path==='/api/study-connector-preview'){
        // Same-account developer preview only. Never interpret an Access
        // browser assertion as a delegated Claude/ChatGPT authorization.
        if(env.STUDY_CONNECTOR_PREVIEW!=='true')throw new HttpError('not_found',404);
        if(request.method!=='POST')throw new HttpError('method_not_allowed',405);
        if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);
        const result=await studyProtocol(await readJSON(request,40000),{dispatch,scopes:['study:read','study:write']});
        return result===null?new Response(null,{status:202,headers:{'Cache-Control':'no-store'}}):json(result);
      }
      if(path==='/api/study' && ['GET','PUT'].includes(request.method)){
        if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);
        if(request.method==='GET')return respond(await dispatch('study.get',queryData(url,['course_id','session_id'])));
        const packet=writePacket(await readJSON(request,40000));return respond(await dispatch('study.put',packet.data,packet));
      }
      if(path==='/api/tutor' && ['GET','POST'].includes(request.method)){
        if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);
        return respond(await student.tutor({tenantId:identity.tenantId,op:request.method==='GET'?'read':'turn',data:request.method==='GET'?queryData(url,['course_id']):await readJSON(request)}));
      }
      const tutorOperation=path.match(/^\/api\/tutor\/operations\/([A-Za-z0-9_-]{8,128})$/);
      if(tutorOperation&&request.method==='GET'){queryData(url,[]);if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);return respond(await student.tutor({tenantId:identity.tenantId,op:'operation',data:{operation_id:tutorOperation[1]}}));}
      if(path==='/api/daily' && request.method==='GET'){queryData(url,[]);return respond(await dispatch('daily.get'));}
      if(path==='/api/school-feeds' && ['PUT','DELETE'].includes(request.method)){
        if(expectedWorkspace!==identity.tenantId)throw new HttpError('workspace_changed',403);
        return respond(await student.school({tenantId:identity.tenantId,op:request.method==='PUT'?'put':'remove',data:await readJSON(request)}));
      }
      if(path.startsWith('/api/google/')) return await handleGoogleRoute({request,url,env,identity,student});
      if(path==='/api/onboarding' && request.method==='GET') {
        queryData(url,[]);
        const results=await Promise.all([dispatch('profile.get'),dispatch('courses.list'),dispatch('connections.list')]);
        const error=results.find(r=>!r.ok);if(error)return respond(error);
        return json({ok:true,workspace_id:identity.tenantId,login_email:identity.email,profile:results[0].record,profile_revision:results[0].revision,courses:results[1].records,
          connections:results[2].records,capabilities:{...capabilities,ai_teaching:tutorConfigured(env),study_connector:env.CONNECTOR_ENABLED==='true'&&Boolean(env.CONNECTOR_AUTH),daily_dashboard:true,school_feeds:schoolFeedsEnabled(env),google_calendar_oauth:googleConfigured(env),google_calendar_selection:googleConfigured(env),google_calendar_collection:collectionEnabled(env),background_collection:collectionEnabled(env)||schoolFeedsEnabled(env)}});
      }
      if(path==='/api/onboarding' && request.method==='PUT') {
        const packet=writePacket(await readJSON(request));return respond(await dispatch('profile.put',packet.data,packet));
      }
      if(path==='/api/account/export' && request.method==='GET') {queryData(url,[]);return respond({...await dispatch('account.export'),workspace_id:identity.tenantId});}
      if(path==='/api/account' && request.method==='DELETE') {
        const packet=writePacket(await readJSON(request));return respond(await dispatch('account.delete',packet.data,packet));
      }
      const receipt=path.match(/^\/api\/receipts\/([A-Za-z0-9_-]{8,128})$/);
      if(receipt && request.method==='GET') {queryData(url,[]);return respond(await dispatch('receipt.get',{operation_id:receipt[1]}));}
      const material=path.match(/^\/api\/materials\/([A-Za-z0-9_-]{1,100})$/);
      if(material && request.method==='GET') {queryData(url,[]);return respond(await dispatch('materials.get',{id:material[1]}));}
      if(path==='/api/calendar/import' && request.method==='POST') {
        const packet=writePacket(await readJSON(request));
        // Match the full original request before parsing against today's window.
        // A valid old import may exceed today's event limit as time advances.
        const replay=await dispatch('calendar.replay',packet.data,{operationId:packet.operationId,expectedRevision:packet.expectedRevision});
        if(!replay.ok)return respond(replay);
        if(replay.found)return respond(replay.result);
        const profile=await dispatch('profile.get');if(!profile.ok)return respond(profile);
        const data=calendarImport(packet.data,{timezone:profile.record?.timezone||'UTC'});
        return respond(await dispatch('calendar.put',data,{operationId:packet.operationId,expectedRevision:packet.expectedRevision,fingerprintData:packet.data}));
      }
      const route=routes[path];
      if(route && request.method==='GET' && route.get) return respond(await dispatch(route.get,queryData(url,route.query)));
      if(route && request.method==='PUT' && route.put) {
        const packet=writePacket(await readJSON(request));return respond(await dispatch(route.put,packet.data,packet));
      }
      throw new HttpError(route?'method_not_allowed':'not_found',route?405:404);
    } catch(error) {
      if(path===GOOGLE_CALLBACK_PATH) return googleCallbackRedirect(false);
      const safe=typeof error.code==='string' && /^[a-z_]{1,80}$/.test(error.code);
      return json({ok:false,error:safe?error.code:'service_unavailable'},safe&&Number.isInteger(error.status)?error.status:503);
    }
  }
};
