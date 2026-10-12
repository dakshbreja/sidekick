// Copyright 2026 Daksh Breja. All rights reserved.
// One bounded page. A durable scheduler owns when another step may run.
import {withGoogleAccess} from './google-access.js';
import {createGoogleCalendarClient} from './google-calendar.js';
import {createGoogleOAuthClient} from './google-oauth.js';
import {fail} from './validation.js';
const stopped=['account_deleted','google_access_changed','calendar_not_selected','collection_lease_stale','google_reauthorization_required'];
const handled=['calendar_provider_unavailable','calendar_provider_timeout','google_refresh_pending','calendar_collection_limit','calendar_cursor_repeated','calendar_provider_invalid_response','calendar_provider_redirect_rejected','calendar_provider_request_rejected','calendar_full_sync_required','calendar_not_accessible'];
export async function collectGooglePage({tenantId,connectionId,calendarId,collection,state,config,client=createGoogleCalendarClient(),oauth=createGoogleOAuthClient()}) {
  let claim;
  try {
    claim=collection.claim(tenantId,{connectionId,calendarId});
    if(claim.kind!=='page')return claim;
    const result=await withGoogleAccess({state,tenantId,connectionId,config,oauth,task:accessToken=>{
      // Check before each provider attempt as well as after it: a new consent
      // must never turn an old run into a request against another Google account.
      collection.assertCurrent(tenantId,claim);
      return client.eventsPage({accessToken,calendarId,...(claim.pageToken===null?{}:{pageToken:claim.pageToken}),...(claim.syncToken===null?{}:{syncToken:claim.syncToken})});
    }});
    if(result.generation!==claim.generation)fail('google_access_changed',409);
    return {kind:'committed',...await collection.commit(tenantId,claim,result.value)};
  } catch(error) {
    if(stopped.includes(error.code))return {kind:'stopped',error:error.code};
    if(!claim || claim.kind!=='page' || !handled.includes(error.code))throw error;
    let retryAfterSeconds=error.retryAfterSeconds??0;
    try {
      if(error.code==='google_refresh_pending')retryAfterSeconds=Math.max(0,Math.ceil(((state.status(tenantId,connectionId).retry_at??collection.now()+60000)-collection.now())/1000));
      return {kind:'failed',...collection.failure(tenantId,claim,{code:error.code,retryAfterSeconds})};
    } catch(failure) {
      if(stopped.includes(failure.code))return {kind:'stopped',error:failure.code};
      throw failure;
    }
  }
}
