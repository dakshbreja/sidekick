// Keep one packet for an uncertain logical write; never invent a new ID on retry.
export function createWriteQueue() {
  const pending = new Map();
  const remove = (key, intent) => { if (pending.get(key) === intent) pending.delete(key); };
  const definiteRejection = (error) => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 &&
    ![408, 425, 429].includes(error.status) &&
    ![error.code, error.error, error.message].includes('operation_id_conflict');
  return {
    clear() { pending.clear(); },
    async run(key, input, buildPacket, send, readReceipt) {
      const logical = JSON.stringify(input);
      let intent = pending.get(key);
      if (intent && intent.logical !== logical) throw new Error('A previous save is unconfirmed. Retry the same values before starting another save.');
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
          sending = true;
          const result = await send(packet);
          const receipt = result?.receipt;
          if (!result?.ok || receipt?.operation_id !== packet.operation_id || !receipt.request_hash) throw new Error('Save acknowledgement is unconfirmed. Retry the same values.');
          // Once sent ambiguously or acknowledged, later authentication or
          // validation errors cannot prove the original operation did not save.
          intent.uncertain = true;
          const readback = await readReceipt(packet.operation_id);
          if (!readback?.ok || readback.receipt?.operation_id !== receipt.operation_id || readback.receipt?.request_hash !== receipt.request_hash || readback.receipt?.revision !== receipt.revision) throw new Error('Save verification is unconfirmed. Retry the same values.');
          remove(key, intent);
          return result;
        } catch (error) {
          if (!sending || (!intent.uncertain && definiteRejection(error))) remove(key, intent);
          else intent.uncertain = true;
          throw error;
        }
      })().finally(() => { intent.flight = null; });
      return intent.flight;
    }
  };
}
export const WRITE_MODULE = 'export const createWriteQueue = ' + createWriteQueue.toString() + ';';
