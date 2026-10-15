// Public OAuth/MCP edge. The website remains behind Cloudflare Access.
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {OAuthProvider,getOAuthApi,OAuthError} from '@cloudflare/workers-oauth-provider';
import {json,readJSON} from './http.js';

import {connectorProvider} from './connector-clients.js';

const SCOPES=['study:read','study:write'];
const requestId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const pending=env=>env.CONNECTOR_REQUESTS.getByName('authorization-v1');
function options(env) {
  const origin=new URL(env.CONNECTOR_ORIGIN).origin;
  return {
    apiRoute:'/mcp',authorizeEndpoint:origin+'/authorize',tokenEndpoint:origin+'/oauth/token',clientRegistrationEndpoint:origin+'/oauth/register',
    accessTokenTTL:900,refreshTokenTTL:604800,clientRegistrationTTL:604800,
    scopesSupported:SCOPES,requiredScopes:SCOPES,clientIdMetadataDocumentEnabled:false,
    resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin]},
    clientRegistrationCallback:({clientMetadata:m})=>{
      if(!Array.isArray(m.redirect_uris)||m.redirect_uris.length!==1||!connectorProvider(m.redirect_uris[0]))return {description:'This private pilot supports only approved Claude or ChatGPT callbacks.'};
    },
    tokenExchangeCallback:async({props})=>{
      const active=await env.BRIDGE.grantActive(props?.owner,props?.grantId);
      if(!active)throw new OAuthError('invalid_grant',{description:'Bridge access was revoked or expired.'});
    },
    apiHandler:{async fetch(request,env,ctx){
      if(new URL(request.url).pathname!=='/mcp')return json({error:'not_found'},404);
      if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
      const message=await readJSON(request,40000);
      const result=await env.BRIDGE.protocol(ctx.props.owner,ctx.props.grantId,message,ctx.auth.scope);
      if(result?.error)console.warn('connector_protocol_rejected',JSON.stringify({method:['initialize','tools/list','tools/call','ping','notifications/initialized'].includes(message.method)?message.method:'other',params_keys:Object.keys(message.params||{}).filter(k=>['protocolVersion','capabilities','clientInfo','_meta','cursor','name','arguments'].includes(k)),code:result.error.code,reason:result.error.message}));
      return result===null?new Response(null,{status:202}):json(result);
    }},
    defaultHandler:{async fetch(request,env){
      if(request.method!=='GET'||new URL(request.url).pathname!=='/authorize')return json({error:'not_found'},404);
      const api=getOAuthApi(options(env),env);
      const auth=await api.parseAuthRequest(request);
      if(!connectorProvider(auth.redirectUri)||auth.codeChallengeMethod!=='S256'||!auth.codeChallenge||!auth.scope.includes('study:read')||auth.scope.some(s=>!SCOPES.includes(s)))return json({error:'invalid_authorization_request'},400);
      const client=await api.lookupClient(auth.clientId);
      const ticket=await pending(env).create({auth,client_name:(client?.clientName||connectorProvider(auth.redirectUri)).slice(0,200)});
      return new Response(null,{status:302,headers:{Location:env.BRIDGE_ORIGIN+'/ai-access?request='+ticket,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }}
  };
}

export class ConnectorRequests extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, expires INTEGER, body TEXT)');this.sql.exec('CREATE TABLE IF NOT EXISTS budget (bucket TEXT PRIMARY KEY,n INTEGER)');}
  budget(){
    return this.ctx.storage.transactionSync(()=>{
      const minute='m'+Math.floor(Date.now()/60000),day='d'+Math.floor(Date.now()/86400000);
      this.sql.exec('DELETE FROM budget WHERE bucket NOT IN (?,?)',minute,day);
      for(const bucket of [minute,day])this.sql.exec('INSERT INTO budget VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1',bucket);
      return this.sql.exec('SELECT n FROM budget WHERE bucket = ?',minute).one().n<=60&&this.sql.exec('SELECT n FROM budget WHERE bucket = ?',day).one().n<=100;
    });
  }
  create(data){return this.ctx.storage.transactionSync(()=>{
    this.sql.exec('DELETE FROM pending WHERE expires < ?',Date.now());
    if(this.sql.exec('SELECT COUNT(*) AS n FROM pending').one().n>=100)throw new Error('authorization_busy');
    const id=crypto.randomUUID();this.sql.exec('INSERT INTO pending VALUES (?,?,?)',id,Date.now()+600000,JSON.stringify(data));return id;
  });}
  read(id,consume=false){
    if(!requestId(id))return null;
    return this.ctx.storage.transactionSync(()=>{
      const row=this.sql.exec('SELECT body FROM pending WHERE id = ? AND expires > ?',id,Date.now()).toArray()[0];
      if(consume)this.sql.exec('DELETE FROM pending WHERE id = ?',id);
      return row?JSON.parse(row.body):null;
    });
  }
}

export default class ConnectorWorker extends WorkerEntrypoint {
  async fetch(request){
    try {
      const url=new URL(request.url);
      if(url.origin!==this.env.CONNECTOR_ORIGIN||!this.env.BRIDGE||!this.env.OAUTH_KV)return json({error:'connector_unavailable'},503);
      if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin){console.warn('connector_origin_denied');return json({error:'origin_denied'},403);}
      if(url.pathname!=='/mcp'&&!url.pathname.startsWith('/.well-known/')&&!await pending(this.env).budget())return json({error:'try_again_later'},429);
      if(Number(request.headers.get('content-length'))>40000||url.href.length>16000)return json({error:'request_too_large'},413);
      // Bound protocol request bodies even when Content-Length is missing.
      if(request.method==='POST'&&url.pathname!=='/mcp') {
        const reader=request.body?.getReader();let size=0;const chunks=[];
        if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>40000){await reader.cancel();return json({error:'request_too_large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
        request=new Request(request,{body:new Blob(chunks)});
      }
      return await new OAuthProvider(options(this.env)).fetch(request,this.env,this.ctx);
    }catch(error){console.warn('connector_request_failed',error?.constructor?.name||'Error');return json({error:'connector_request_failed'},400);}
  }
  async describe(id){
    const item=await pending(this.env).read(id);
    if(!item)return {ok:false,error:'authorization_expired'};
    return {ok:true,client_name:item.client_name,redirect_origin:new URL(item.auth.redirectUri).origin,write_requested:item.auth.scope.includes('study:write')};
  }
  async approve(id,owner,courseIds,write){
    // Only the Access-authenticated website can call this RPC. Claim once,
    // before external I/O; interrupted approval requires a new consent flow.
    const item=await pending(this.env).read(id,true);
    if(!item)return {ok:false,error:'authorization_expired'};
    if(write&&!item.auth.scope.includes('study:write'))return {ok:false,error:'scope_not_requested'};
    const grantId=crypto.randomUUID();
    const result=await this.env.BRIDGE.createGrant(owner,{grant_id:grantId,client_id:item.auth.clientId,client_name:item.client_name,course_ids:courseIds,write});
    if(!result.ok)return result;
    const authorization=await getOAuthApi(options(this.env),this.env).completeAuthorization({request:item.auth,userId:owner,metadata:{bridge_grant:grantId},scope:result.grant.scopes,props:{owner,grantId},revokeExistingGrants:false});
    return {ok:true,redirect:authorization.redirectTo};
  }
  async deny(id){await pending(this.env).read(id,true);return {ok:true};}
}
