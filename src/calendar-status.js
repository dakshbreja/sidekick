// Copyright 2026 Daksh Breja. All rights reserved.
// Presentation only: never upgrades a permission or treats registration as sync.
export function calendarStatus(capabilities = {}, state, selection, agenda = []) {
  const result = (stage, title, detail) => ({ stage, title, detail });
  if (!capabilities.google_calendar_oauth) return result('setup_pending', 'Google Calendar setup pending', 'The site owner still needs to finish Google setup. Live calendar access is unavailable, and no connection status has been checked. You can import a calendar file below meanwhile.');
  if (!state) return result('consent_pending', 'Connect Google Calendar', 'Save Google Calendar as a source below using https://calendar.google.com, then review and approve read-only access. Saving its address alone does not connect it.');
  if (state.unavailable) return result('unavailable', 'Calendar status unavailable', 'We could not check this connection. Refresh to try again; do not assume it is connected or submit consent again yet.');
  if (state.revocation?.state === 'pending' || state.status === 'revoking') return result('removing', 'Google permission removal pending', 'Collection has stopped. Refresh to check whether Google confirmed removal.');
  if (state.status === 'disconnected') return result('disconnected', 'Google Calendar disconnected', state.revocation?.state === 'confirmed' ? 'Google confirmed permission removal. Review read-only consent below if you want to reconnect.' : 'Saved access has been removed. Google permission removal is not confirmed; review Google Account connections before reconnecting.');
  if (state.authorization_blocked && !state.authorized) return result('removing', 'Waiting for permission removal', 'Another connection is still removing Google permission. Refresh to check before reconnecting.');
  if (!state.authorized) {
    if (state.status === 'exchanging') return result('consent_pending', 'Finishing Google connection', 'Refresh to check the result before starting another consent attempt.');
    const detail = state.status === 'reauthorization_required' ? 'Google access expired or was removed. Review and approve read-only access again below.' : state.status === 'authorizing' ? 'Finish permission approval in Google, then return here and refresh. If it expired, restart consent below.' : 'Review and approve read-only access below. Permission alone will not select or sync any calendars.';
    return result('consent_pending', 'Google permission needed', detail);
  }
  if (!selection) return result('unavailable', 'Calendar choices unavailable', 'Permission is saved, but your saved choices could not be checked. Refresh before changing them.');
  const ids = selection.active ? selection.record?.calendar_ids || [] : [];
  if (!ids.length) return result('unselected', 'Choose your calendars', 'Google permission is saved. Show Google calendars below, choose the ones you want, and save your selection. No calendars are being collected.');
  if (!capabilities.google_calendar_collection || !state.collection?.automatic_enabled) return result('setup_pending', 'Automatic calendar checks pending', 'Your choices are saved. The site owner still needs to enable calendar checks; a saved selection does not mean events have synced.');
  const calendars = state.collection.calendars || [];
  const incomplete = calendars.length !== ids.length || calendars.some(c => !c.snapshot_complete || !c.last_successful_sync);
  const problem = state.refresh_error || state.collection.scheduler?.status === 'paused' || calendars.some(c => c.error || ['backoff', 'paused'].includes(c.status));
  if (problem || (incomplete && calendars.some(c => c.snapshot_complete))) return result('partial', 'Calendar checks need attention', 'Some calendars are incomplete or waiting to retry. Review the check status below and use the original calendar for anything important.');
  if (incomplete) return result('syncing', 'First calendar sync in progress', 'Your choices are saved. Waiting for the first complete download; refresh to check progress. An empty view does not mean nothing is due.');
  if (calendars.some(c => c.freshness !== 'recent')) return result('stale', 'Calendar data may be out of date', 'Showing the last complete download. Review the last-check dates below and check the original calendar.');
  if (agenda.length !== ids.length || agenda.some(s => s.unavailable || s.displayLimited || !s.data?.snapshot_complete || s.data?.freshness !== 'recent' || !s.data?.coverage?.complete) || agenda.reduce((count, s) => count + (s.data?.events?.length || 0), 0) > 100) return result('partial', 'Calendar view has limited coverage', 'Some events could not be shown or checked completely. Review coverage below and check the original calendar.');
  return result('ready', 'Selected calendars are up to date', 'Each selected calendar has a recent complete check. The view covers the next 31 days; calendar events do not prove assignment completion.');
}
