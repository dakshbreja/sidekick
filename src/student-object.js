// Copyright 2026 Daksh Breja. All rights reserved.
import { DurableObject } from 'cloudflare:workers';
import { StudentStore } from './store.js';

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
}
