// Copyright 2026 Daksh Breja. All rights reserved.
import { DurableObject } from 'cloudflare:workers';
import { StudentStore } from './store.js';
import { GoogleConnectionState } from './google-connection-state.js';
import { googleConfiguration, createGoogleOAuthClient, GoogleOAuthError } from './google-oauth.js';
import { ContractError, object, id } from './validation.js';

export class StudentState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.store = new StudentStore(ctx.storage);
    });
  }

  // This RPC is called only by the authenticated same-service Worker. The
  // permanent binding also catches accidental routing to another student's DO.
  async dispatch(message) { return this.store.dispatch(message); }

  // Narrow internal operations. Verifiers, tokens and leases never cross RPC.
  async google(message) {
    try {
      object(message, ['tenantId', 'op', 'data']);
      const config = googleConfiguration(this.env);
      const state = new GoogleConnectionState(this.store, { key: config.key });
      const { tenantId, op, data } = message;
      if (op === 'status') { object(data, ['connectionId']); return { ok: true, connection: state.status(tenantId, id(data.connectionId)) }; }
      if (op === 'begin') {
        object(data, ['connectionId', 'expectedRevision', 'attemptId', 'browserBinding']);
        return { ok: true, intent: await state.beginAuthorization(tenantId, { ...data, redirectUri: config.redirectUri }) };
      }
      if (op === 'disconnect') return { ok: true, connection: state.disconnect(tenantId, data) };
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
      if (error instanceof ContractError || ['google_oauth_disabled', 'google_oauth_not_configured'].includes(error.code)) return { ok: false, error: error.code, status: error.status };
      return { ok: false, error: 'google_connection_unavailable', status: 503 };
    }
  }
}
