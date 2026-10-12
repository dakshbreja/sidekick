# Google Calendar connector

Copyright 2026 Daksh Breja. All rights reserved.

Implementation checkpoint, October 12, 2026. This is an unfinished connector. The website still reports Google authorization and background collection unavailable. No live Google request, OAuth client, credential, source selection or alarm is enabled by this checkpoint.

## Implemented building blocks

`src/google-calendar.js` is a server-only read transport for calendar choices and event collection pages. It requests at most 100 items per page, reads at most 1 MB, applies a ten-second network/body deadline, rejects redirects, sends the access credential only in the Authorization header, and returns static error categories without provider payloads. It never follows arbitrary URLs, automatically retries, writes calendar events, chooses a student's calendars, or claims successful durable storage.

The planned consent scopes are `calendar.calendarlist.readonly` and `calendar.events.readonly`. These permit reading accessible calendars, not just calendars selected in our UI. The app must explain that distinction and collect only the selected IDs after consent. [Google's scope documentation](https://developers.google.com/workspace/calendar/api/auth).

Full and incremental event requests use the same fixed query parameters, preserve cancelled events and retain recurrence masters/original occurrence identities. Each call returns one page. A continuation is explicitly incomplete; only a final page supplies the next sync token. The adapter reports `recurrence_expanded: false`, so these objects cannot be presented as a fully expanded upcoming schedule. [Google synchronization contract](https://developers.google.com/workspace/calendar/api/guides/sync), [event list restrictions](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

401 requires token refresh before considering a new consent prompt. 410 on incremental collection requires a new full sync. Rate limits and server failures are separately retryable; remaining failures stop collection. A durable scheduler must honor Retry-After and exponential backoff. Errors do not overwrite the last successful collection time. [Google error guidance](https://developers.google.com/workspace/calendar/api/guides/errors).

`src/credential-envelope.js` supplies versioned AES-256-GCM encryption with random 96-bit IVs and authenticated student, connection, generation and purpose context. It rejects altered ciphertext, another student's context, another connection/generation/purpose, malformed keys and oversized plaintext. The encryption secret must be community-only and separate from the workspace-addressing key. This is server-side encryption at rest, not end-to-end encryption; key rotation is not implemented yet. The private live-row lifecycle is described below.

The new tests use only generated keys and synthetic provider responses. One integration test executes both components in actual local workerd and intercepts outbound HTTP, preventing live Google access. These transport tests do not establish provider authorization, scheduled refresh or live correctness.

## Durable authorization state, October 12

`src/google-connection-state.js` now implements internal, per-student authorization state in the same SQLite database as the workspace. The state table is separate from normal records, receipts and exports. The schema upgrade is idempotent; account deletion clears private connector rows atomically with the existing tombstone. Every state mutation also advances the account revision, so stale account-deletion requests must reread first.

An authorization attempt stores encrypted state/PKCE verifier/redirect data, hashes the browser binding, expires after ten minutes, and can return the original intent on an exact retry after restart. A different browser, owner, callback state or changed request cannot reuse it. The callback consumes the pending state before decryption or provider exchange and grants a one-minute internal exchange lease. A lost/ambiguous exchange is not replayed; start a new attempt. After a successful final save whose response is lost, read connection status instead of exchanging the code again.

Credential commits recheck the lease, generation, expiry and account tombstone after encryption. Disconnect persists a generation fence even if the first authorization is still awaiting encryption. It erases live local credentials and pending secrets, and reports provider revocation as **not attempted**. Reauthorization of an existing authorized connection requires explicit disconnect first. The state is bounded to eight registered Google connections and 40 KB per private row. Expired pending ciphertext remains bounded until a new attempt, disconnect or account deletion; it cannot be consumed after expiry.

A successful synthetic credential save reports `authorized_not_synced`, never successful collection. The internal class has no website route or public RPC and must not be exposed wholesale: its consume method returns a PKCE verifier exclusively for trusted server-side exchange. Future routing must derive identity from the verified session, supply a cryptographically random browser cookie, enforce its configured redirect URI exactly, and map errors to static categories. This component does not itself perform network requests or set cookies.

Sixteen added tests cover real SQLite close/reopen, exact retry, callback reuse, competing calls, expiry, owner/browser/state mismatch, contextual encryption, input/connection limits, rollback, generic-dispatch exclusion, and disconnect/deletion while encryption is paused. A separate real workerd/SQLite test restarts the runtime across pending, consumed, authorized and deleted states and blocks all external HTTP. These are synthetic lifecycle tests, not live Google consent or hosted deletion evidence. Live-row erasure also does not establish erasure from provider grants or infrastructure backups; revocation, restore handling and retention remain release gates.

## Next implementation and activation gates

1. Integrate the tested durable authorization state through narrowly scoped authenticated server operations; preserve its private storage and generation checks. Add safe visible status without leaking callback state, leases, credentials or provider responses.
2. Implement a separate community OAuth client using state, PKCE and a browser-bound nonce. Consume state once, bind the callback to the initiating verified workspace and exact redirect, and reject account switches, expiry and replay. Authorization-code exchange must not be blindly retried after an ambiguous response. Do not reuse the personal Bridge OAuth registration or credentials.
3. Add explicit calendar selection and durable refresh leases. Preserve a valid refresh token when a refresh response omits its replacement. Handle permission removal, revocation, scope changes and reconnect without overwriting a different generation. Review actual consent and hosting changes before activation.
4. Add bounded per-student alarms, resumable page staging and atomic snapshot publication. Do not advance the sync cursor or successful-sync timestamp until all pages are committed. Resume after eviction/crash without duplicate events; cancel stale runs after disconnect, changed selection or account deletion. Enforce event/byte/page budgets without silently marking truncated results complete.
5. Build a zone-aware, bounded upcoming-event projection for recurring series and exceptions. Keep original all-day dates, offsets and time zones; show coverage and unresolved recurrence cases. A calendar event is never completion evidence or an authoritative assignment deadline when another original source conflicts.
6. Test the complete path with synthetic failures in real SQLite/workerd, then an explicitly authorized separate Google account/calendar. Verify refresh, expired sync tokens, rate limiting, response loss, disconnect, revocation, account switching, deletion and recovery. Keep the feature disabled until the full path and user-visible freshness are proven.

The full product remains tracked in [PRODUCT-PLAN.md](PRODUCT-PLAN.md).
