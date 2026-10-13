import {SchoolFeedState} from './school-feed-state.js';
import {schoolFeedsEnabled} from './school-feed.js';
// Copyright 2026 Daksh Breja. All rights reserved.
import { DurableObject } from 'cloudflare:workers';
import { StudentStore } from './store.js';
import { GoogleConnectionState } from './google-connection-state.js';
import { googleConfiguration, googleConfigured, createGoogleOAuthClient, GoogleOAuthError } from './google-oauth.js';
import { ContractError, object, id } from './validation.js';
import { createGoogleCalendarClient, CalendarProviderError } from './google-calendar.js';
import { GoogleCollectionState } from './google-collection-state.js';
import { GoogleScheduler, collectionEnabled } from './google-scheduler.js';
import { collectGooglePage } from './google-collector.js';
import {GoogleRevocationState,runRevocation,expireRevocations,revocationExpiry} from './google-revocation.js';
import {createRevocationClient} from './google-revoke-client.js';
import { withGoogleAccess } from './google-access.js';

export class StudentState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.store = new StudentStore(ctx.storage);
      this.collection = new GoogleCollectionState(this.store);
      this.scheduler = new GoogleScheduler(this.store,{includeFeeds:schoolFeedsEnabled(env),includeCollections:collectionEnabled(env),includeRevocations:googleConfigured(env)&&Boolean(env.COLLECTION_BUDGETS)});
    });
  }

  // This RPC is called only by the authenticated same-service Worker. The
  // permanent binding also catches accidental routing to another student's DO.
  async reschedule(replace=false) {
    const times=[this.scheduler.nextTime(),revocationExpiry(this.store)].filter(value=>value!==null);
    const next=times.length?Math.max(Date.now()+1000,Math.min(...times)):null;
    if(next===null){await this.ctx.storage.deleteAlarm();return;}
    const existing=await this.ctx.storage.getAlarm();
    if(replace || existing===null || next<existing)await this.ctx.storage.setAlarm(next);
  }
  async dispatch(message) {
    if(!['google_selection.put','account.delete'].includes(message?.op))return this.store.dispatch(message);
    return this.store.dispatch(message,{commit:callback=>this.ctx.storage.transaction(async()=>{
      const result=callback();
      if(result.ok && !result.replayed && message.op==='google_selection.put')this.scheduler.selectionChanged();
      await this.reschedule();return result;
    })});
  }
  async alarm() {
    // Commit the reservation and recovery wakeup together, before external I/O.
    const plan=await this.ctx.storage.transaction(async()=>{
      expireRevocations(this.store,Date.now());
      const result=this.scheduler.reserve();await this.reschedule(true);return result;
    });
    if(plan.kind!=='reserved')return;
    let result,failed=false,timer;
    try {
      const budget=await Promise.race([
        this.env.COLLECTION_BUDGETS.getByName('google-calendar-v1').reserve({reservationId:plan.reservationId}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('collection_budget_unavailable')),5000);})
      ]);
      if(!budget.allowed || budget.valid_until<=Date.now())result={kind:'global_wait',retry_at:Math.max(Date.now()+60000,budget.retry_at??0)};
      else {
        const pending=this.scheduler.state().pending;
        if(this.scheduler.account()?.deleted || pending?.id!==plan.reservationId || pending.expires_at<=Date.now())result={kind:'stopped'};
        else if(plan.operation==='school_feed'){result=await new SchoolFeedState(this.store,{key:this.env.GOOGLE_CREDENTIAL_KEY}).collect(plan.tenantId,plan.connectionId);}
        else {const config=googleConfiguration(this.env);result=plan.operation==='revoke'?await runRevocation({...plan,state:new GoogleRevocationState(this.store,{key:config.key}),client:createRevocationClient()}):await collectGooglePage({...plan,collection:this.collection,state:new GoogleConnectionState(this.store,{key:config.key}),config});}
      }
    } catch { failed=true; }
    finally {clearTimeout(timer);}
    await this.ctx.storage.transaction(async()=>{this.scheduler.finish(plan.reservationId,result,failed);await this.reschedule(true);});
  }

  async school(message){
    try{
      object(message,['tenantId','op','data']);
      if(!schoolFeedsEnabled(this.env))return {ok:false,error:'school_feeds_disabled',status:409};
      const state=new SchoolFeedState(this.store,{key:this.env.GOOGLE_CREDENTIAL_KEY});
      const commit=callback=>this.ctx.storage.transaction(async()=>{const result=callback();this.scheduler.selectionChanged();await this.reschedule();return result;});
      if(message.op==='put')return await state.put(message.tenantId,message.data,commit);
      if(message.op==='remove')return await state.remove(message.tenantId,message.data,commit);
      return {ok:false,error:'unknown_operation',status:404};
    }catch(error){return {ok:false,error:error instanceof ContractError?error.code:'school_feed_unavailable',status:error instanceof ContractError?error.status:503};}
  }

  // Narrow internal operations. Verifiers, tokens and leases never cross RPC.
  async google(message) {
    try {
      object(message, ['tenantId', 'op', 'data']);
      const config = googleConfiguration(this.env);
      const state = new GoogleConnectionState(this.store, { key: config.key });
      const { tenantId, op, data } = message;
      if (op === 'status') {
        object(data, ['connectionId']);const connectionId=id(data.connectionId),connection=state.status(tenantId,connectionId);
        if(collectionEnabled(this.env)){
          await this.ctx.storage.transaction(async()=>{await this.reschedule();});
          const collection={...this.collection.status(tenantId,connectionId),automatic_enabled:true,scheduler:this.scheduler.status()};
          const complete=collection.calendars.length>0 && collection.calendars.every(calendar=>calendar.snapshot_complete);
          Object.assign(connection,{status:connection.status==='authorized_not_synced'?'authorized':connection.status,collection,live_sync:complete && collection.calendars.every(calendar=>calendar.freshness==='recent'),last_successful_sync:complete?collection.calendars.map(calendar=>calendar.last_successful_sync).sort()[0]:null});
        }
        return {ok:true,connection};
      }
      if(op==='upcoming'){
        if(!collectionEnabled(this.env))return {ok:false,error:'google_collection_disabled',status:409};
        object(data,['connectionId','calendarId']);return {ok:true,...this.collection.upcoming(tenantId,data)};
      }
      if(op==='events'){
        if(!collectionEnabled(this.env))return {ok:false,error:'google_collection_disabled',status:409};
        object(data,['connectionId','calendarId','limit','cursor','snapshotId']);
        return {ok:true,...this.collection.snapshot(tenantId,data)};
      }
      if (op === 'begin') {
        object(data, ['connectionId', 'expectedRevision', 'attemptId', 'browserBinding']);
        return { ok: true, intent: await state.beginAuthorization(tenantId, { ...data, redirectUri: config.redirectUri }) };
      }
      if(op==='revoke'){
        if(!this.env.COLLECTION_BUDGETS)return {ok:false,error:'google_revocation_unavailable',status:503};
        return await this.ctx.storage.transaction(async()=>{const revocation=new GoogleRevocationState(this.store,{key:config.key}).start(tenantId,data);await this.reschedule();return {ok:true,revocation};});
      }
      if (op === 'disconnect') return await this.ctx.storage.transaction(async()=>{const connection=state.disconnect(tenantId,data);await this.reschedule();return {ok:true,connection};});
      if (op === 'calendars') {
        object(data, ['connectionId', 'pageToken']);
        const connectionId = id(data.connectionId);
        if (data.pageToken !== undefined && (typeof data.pageToken !== 'string' || !data.pageToken.length || data.pageToken.length > 8192 || /[\u0000-\u0020\u007f]/.test(data.pageToken))) return { ok: false, error: 'calendar_provider_invalid_input', status: 400 };
        const accessed = await withGoogleAccess({ state, tenantId, connectionId, config, oauth: createGoogleOAuthClient(),
          task: accessToken => createGoogleCalendarClient().calendarsPage({ accessToken, ...(data.pageToken === undefined ? {} : { pageToken: data.pageToken }) }) });
        state.assertActiveGeneration(tenantId, connectionId, accessed.generation);
        this.store.cacheGoogleChoices(tenantId, connectionId, accessed.generation, accessed.value.items);
        return { ok: true, page: accessed.value, connection: state.status(tenantId, connectionId), collection_scope: 'calendar_choices_only', live_sync: false };
      }
      if (op !== 'callback') return { ok: false, error: 'unknown_operation', status: 404 };
      object(data, ['connectionId', 'state', 'browserBinding', 'code', 'denied']);
      if (typeof data.denied !== 'boolean' || (!data.denied && (typeof data.code !== 'string' || data.code.length > 4096 || !/^[\x21-\x7e]+$/.test(data.code)))) return { ok: false, error: 'invalid_callback', status: 400 };
      const claim = await state.consumeAuthorization(tenantId, { connectionId: data.connectionId, state: data.state, browserBinding: data.browserBinding });
      const lease = { connectionId: data.connectionId, generation: claim.generation, lease: claim.lease };
      if (data.denied) return { ok: true, connection: await state.failAuthorization(tenantId, { ...lease, denied: true }) };
      try {
        const credentials = await createGoogleOAuthClient().exchange(config, { code: data.code, verifier: claim.verifier, redirectUri: claim.redirect_uri });
        return { ok: true, connection: await state.finishAuthorization(tenantId, { ...lease, credentials }) };
      } catch (error) {
        // A disconnected/deleted generation must not be changed by failure cleanup.
        if (error instanceof GoogleOAuthError) {
          await state.failAuthorization(tenantId, { ...lease, denied: false });
          return { ok: false, error: error.code, status: 502 };
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof CalendarProviderError) return { ok: false, error: error.code, status: 502 };
      if (error instanceof ContractError || ['google_oauth_disabled', 'google_oauth_not_configured'].includes(error.code)) return { ok: false, error: error.code, status: error.status };
      return { ok: false, error: 'google_connection_unavailable', status: 503 };
    }
  }
}
