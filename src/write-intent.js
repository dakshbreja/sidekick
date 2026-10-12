// Keep one packet for an uncertain logical write; never invent a new ID on retry.
export function createWriteQueue({storage, owner} = {}) {
  const pending = new Map();
  const storageKey = 'school-bridge-outbox-v1:' + owner;
  const durable = Boolean(storage && owner);
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  const routes = {'/api/onboarding':'PUT','/api/courses':'PUT','/api/connections':'PUT','/api/materials':'PUT','/api/calendar/import':'POST','/api/account':'DELETE'};
  const operations = {'/api/onboarding':'profile.put','/api/courses':'courses.put','/api/connections':'connections.put','/api/materials':'materials.put','/api/calendar/import':'calendar.put','/api/account':'account.delete'};
  if (durable) {
    const saved = storage.getItem(storageKey);
    if (saved) {
      if (saved.length > 2000000) throw new Error('Browser recovery data is invalid.');
      const parsed = JSON.parse(saved);
      if (parsed.version !== 1 || parsed.owner !== owner || !Array.isArray(parsed.intents) || parsed.intents.length > 6) throw new Error('Browser recovery data is invalid. Inspect stored receipts before clearing browser data.');
      for (const entry of parsed.intents) {
        if (!entry.key || pending.has(entry.key) || !entry.packet?.operation_id || !Number.isSafeInteger(entry.packet.expected_revision) || entry.packet.expected_revision < 0 || !entry.fingerprint || !Object.hasOwn(routes,entry.route?.path) || routes[entry.route.path] !== entry.route.method) throw new Error('Browser recovery data is invalid.');
        pending.set(entry.key, {...entry, logical: null, uncertain: true, packetPromise: Promise.resolve(entry.packet), flight: null});
      }
    }
  }
  const persist = () => {
    if (!durable) return;
    const intents = [...pending].filter(([,i])=>i.packet).map(([key,i])=>({key,packet:i.packet,fingerprint:i.fingerprint,route:i.route,ack:i.ack || null}));
    if (!intents.length) { storage.removeItem(storageKey); return; }
    const value = JSON.stringify({version:1,owner,intents});
    if (value.length > 2000000 || intents.length > 6) throw new Error('Browser recovery storage is full. Reconcile pending saves before saving again.');
    storage.setItem(storageKey,value);
  };
  const remove = (key, intent) => {
    if (pending.get(key) !== intent) return;
    pending.delete(key);
    try { persist(); } catch (error) { pending.set(key,intent); throw error; }
  };
  const matches = (receipt, packet, ack, route) => receipt?.operation_id === packet.operation_id && Boolean(receipt.request_hash) &&
    (!ack || receipt.request_hash === ack.request_hash && receipt.revision === ack.revision) &&
    (!durable || receipt.revision === packet.expected_revision + 1 && receipt.operation === operations[route?.path] &&
      receipt.resource_id === (packet.id || (route?.path === '/api/account' ? 'account' : 'profile')) &&
      Boolean(receipt.deleted) === (route?.path === '/api/account'));
  const definiteRejection = (error) => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 &&
    ![408, 425, 429].includes(error.status) &&
    ![error.code, error.error, error.message].includes('operation_id_conflict');
  return {
    clear() {
      const previous = new Map(pending);pending.clear();
      try { persist(); } catch (error) { for (const [key,intent] of previous) pending.set(key,intent);throw error; }
    },
    count() { return pending.size; },
    // Receipt lookup always precedes any explicit replay after reload/reconnect.
    // A missing receipt permits only the original packet, never a new operation.
    async reconcile(send, readReceipt) {
      for (const [key,intent] of [...pending].sort(([a],[b]) => (b === 'delete') - (a === 'delete'))) {
        if (intent.flight) throw new Error('A save is still running.');
        const packet = await intent.packetPromise;
        let readback;
        try { readback = await readReceipt(packet.operation_id); }
        catch (error) {
          if (error.code !== 'receipt_not_found' || error.status !== 404 || intent.ack) throw error;
          const result = await send(intent.route,packet);
          if (!result?.ok || !matches(result.receipt,packet,null,intent.route)) throw new Error('Save acknowledgement is unconfirmed.');
          intent.ack = {operation_id:result.receipt.operation_id,request_hash:result.receipt.request_hash,revision:result.receipt.revision}; persist();
          readback = await readReceipt(packet.operation_id);
        }
        if (!readback?.ok || !matches(readback.receipt,packet,intent.ack,intent.route)) throw new Error('Save verification is unconfirmed.');
        if (readback.receipt.deleted) { this.clear(); return {deleted:true}; }
        remove(key,intent);
      }
      return {deleted:false};
    },
    async run(key, input, buildPacket, send, readReceipt) {
      const logical = JSON.stringify(input);
      let intent = pending.get(key);
      if (durable && input.owner !== owner) throw new Error('Your sign-in changed. Refresh before saving.');
      if (durable && intent?.logical === null) throw new Error('A previous save is unconfirmed. Check receipts and recover saves before starting another save.');
      if (intent && intent.logical !== null && intent.logical !== logical) throw new Error('A previous save is unconfirmed. Retry the same values before starting another save.');
      if (!intent) {
        // Reserve synchronously: asynchronous builders (such as deletion's
        // revision read) must not let a second click allocate another packet.
        intent = { logical, uncertain: false, packetPromise: Promise.resolve().then(buildPacket), flight: null };
        pending.set(key, intent);
      }
      if (intent.flight) return intent.flight;
      intent.flight = (async () => {
        let sending = false;
        try {
          const packet = await intent.packetPromise;
          const fingerprint = await digest(logical);
          if (intent.fingerprint && intent.fingerprint !== fingerprint) throw new Error('A previous save is unconfirmed. Retry the same values before starting another save.');
          intent.fingerprint = fingerprint; intent.packet = packet; intent.route = {path:input.path,method:input.method};
          persist(); // Fail closed before sending if durable storage is unavailable.
          sending = true;
          const result = await send(packet);
          const receipt = result?.receipt;
          if (!result?.ok || !matches(receipt,packet,null,intent.route)) throw new Error('Save acknowledgement is unconfirmed. Retry the same values.');
          // Once sent ambiguously or acknowledged, later authentication or
          // validation errors cannot prove the original operation did not save.
          intent.uncertain = true;
          intent.ack = {operation_id:receipt.operation_id,request_hash:receipt.request_hash,revision:receipt.revision}; persist();
          const readback = await readReceipt(packet.operation_id);
          if (!readback?.ok || !matches(readback.receipt,packet,receipt,intent.route)) throw new Error('Save verification is unconfirmed. Retry the same values.');
          remove(key, intent);
          return result;
        } catch (error) {
          if ((!sending && !intent.uncertain) || (!intent.uncertain && definiteRejection(error))) remove(key, intent);
          else intent.uncertain = true;
          throw error;
        }
      })().finally(() => { intent.flight = null; });
      return intent.flight;
    }
  };
}
// Serialized functions must stay closure-free. Wrangler keep_names/minify are
// disabled; test:bundle executes the emitted module to catch compiler helpers.
export const WRITE_MODULE = 'export const createWriteQueue = ' + createWriteQueue.toString() + ';';
