// Copyright 2026 Daksh Breja. All rights reserved.
import {DurableObject} from 'cloudflare:workers';
import {ProviderBudgetStore} from './collection-budget.js';
export class CollectionBudget extends DurableObject {
  constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{this.ledger=new ProviderBudgetStore(ctx.storage);});}
  // Only the same service's alarm handler invokes this binding; no HTTP route.
  async reserve(input){return this.ledger.reserve(input);}
}
