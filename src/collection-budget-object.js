// Copyright 2026 Daksh Breja. All rights reserved.
import {DurableObject} from 'cloudflare:workers';
import {TutorBudget} from './tutor-budget.js';
import {ProviderBudgetStore} from './collection-budget.js';
export class CollectionBudget extends DurableObject {
  constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{this.ledger=new ProviderBudgetStore(ctx.storage);this.tutorLedger=new TutorBudget(ctx.storage);});}
  // Only the same service's alarm handler invokes this binding; no HTTP route.
  async reserveTutor(input){return this.tutorLedger.reserve(input);}
  async releaseTutor(input){return this.tutorLedger.release(input);}
  async reserve(input){return this.ledger.reserve(input);}
}
