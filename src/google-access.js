// Copyright 2026 Daksh Breja. All rights reserved.
// Server-only orchestration. Credentials stay inside the student's object.
import { GoogleOAuthError } from './google-oauth.js';
import { fail } from './validation.js';

export async function withGoogleAccess({ state, tenantId, connectionId, oauth, config, task }) {
  let refreshed = false;
  async function access(rejectedTokenRevision) {
    const claim = await state.acquireAccess(tenantId, { connectionId, ...(rejectedTokenRevision === undefined ? {} : { rejectedTokenRevision }) });
    if (claim.kind === 'wait') fail('google_refresh_pending', 503);
    if (claim.kind === 'reauthorize') fail('google_reauthorization_required', 409);
    if (claim.kind === 'ready') return claim;
    const lease = { connectionId, generation: claim.generation, tokenRevision: claim.tokenRevision, lease: claim.lease };
    try {
      refreshed = true;
      const credentials = await oauth.refresh(config, claim.credentials);
      return await state.finishRefresh(tenantId, { ...lease, credentials });
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        const status = await state.failRefresh(tenantId, { ...lease, error: error.code, retryAfterSeconds: error.retryAfterSeconds });
        fail(status.status === 'reauthorization_required' ? 'google_reauthorization_required' : 'google_refresh_pending', status.status === 'reauthorization_required' ? 409 : 503);
      }
      throw error;
    }
  }
  let current = await access();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await task(current.accessToken);
      // A provider response arriving after disconnect/deletion is discarded.
      state.assertActiveGeneration(tenantId, connectionId, current.generation);
      return { value: result, generation: current.generation };
    } catch (error) {
      if (error.code !== 'calendar_authorization_required') throw error;
      if (refreshed || attempt === 1) {
        state.invalidateAccess(tenantId, { connectionId, generation: current.generation, tokenRevision: current.tokenRevision });
        fail('google_reauthorization_required', 409);
      }
      current = await access(current.tokenRevision);
    }
  }
}
