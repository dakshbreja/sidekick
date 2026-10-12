# Foundation status

Status date: October 12, 2026.

The clean community foundation is implemented locally. It supports separate, initially empty student stores and manual onboarding/imports. It is not deployed for real students and does not provide the full feature set of the personal School Bridge.

## Implemented

| Area | Current behavior |
|---|---|
| Identity | Server verification of signed Cloudflare Access end-user assertions, pinned issuer/audience and HMAC-derived student ownership. Unconfigured authentication fails closed. |
| Isolation | One SQLite Durable Object per student; permanent owner binding, strict fields and scoped resources, receipts, retries and exports. |
| Onboarding | Empty profile, arbitrary courses/sections/terms and source metadata. No personal data or account connections are preloaded. |
| Materials | Manual course text with scoped metadata listings and individual retrieval. |
| Calendar | Bounded ICS file import, recurrence coverage warnings, stable exact retries and revision-safe replacement of a course/source calendar. Imports remain explicitly dated and non-live. |
| Coursework | API for reported progress with a submission requirement for `done`. Source-verified completion is unsupported. |
| Learning | API for bounded saved sessions and fresh reads. Independent observed-correct work, assisted work, wrong/partial responses and discussion remain distinct. No model calls or automatic evaluation. |
| Saves | Atomic record/receipt/revision transactions; stale writes and conflicting operation reuse fail. Browser save intents use receipt readback. |
| Privacy controls | Current-workspace export, active-data deletion and permanent identity tombstones. No end-to-end-encryption claim. |
| Development checks | Contract tests, real SQLite unit tests, actual local workerd integration, privacy scanning and a dry-run Worker build. |
| Local demonstration | `npm run demo` serves two disposable synthetic workspaces at loopback. Its keys and assertions are generated for the run; it is not production authentication. |

## Verification evidence

The October 12 local gate passed **140 tests**, the privacy scan with an external private-reference denylist, and the Wrangler dry-run build. An independent code review rechecked the retry fixes and isolation boundaries. The synthetic HTTP demo served its assets and empty onboarding successfully and rejected a cross-origin request. Chrome blocked the loopback page with `ERR_BLOCKED_BY_CLIENT`, so rendered-browser interaction and visual QA remain unverified.

The source is published in the private [school-bridge-community repository](https://github.com/dakshbreja/school-bridge-community). GitHub Actions independently passed the complete gate on Linux for commit `b0d98eef83ae2c20f04f165c535688bf3a07f12a`: [verified run](https://github.com/dakshbreja/school-bridge-community/actions/runs/38211864844). This is source publication and CI validation, not a deployment of the student service. The requested move to Codex cloud is prepared in [CLOUD-HANDOFF.md](CLOUD-HANDOFF.md). Its repository picker currently requires the owner's separate Codex connector repository authorization; no cloud coding task has been launched.

Synthetic tests exercise two independently signed identities with the same resource IDs, distinct material and learning records, guessed IDs, hostile tenant selectors, forged tokens, stale account screens and cross-origin writes. They exercise exact receipt replay, revision conflicts and competing writes in the real local Worker/SQLite runtime.

The runtime suite restarts workerd using the existing synthetic SQLite files and confirms that records, receipts and ownership persist. It checks account deletion against SQLite itself and verifies that the other student's workspace remains unchanged. Storage fault-injection tests check transaction rollback for both saves and deletion. Learning tests reject unobserved correctness claims and confirm that replacing a saved session does not inflate understanding counts.

Authentication tests cover issuer/audience and lifetime errors, wrong signing algorithms, forged signatures, unavailable or oversized signing-key responses and stalled response bodies. The runtime uses generated test keys and an intercepted synthetic key endpoint. This verifies implementation behavior; it does not establish that a real Access deployment has been configured or tested.

Run the current gates with:

```sh
npm test
npm run check
```

The commands print test counts for the current checkout. A passing suite establishes the covered contracts, not sustained service uptime or whole-system recovery.

## Not implemented or not established

- Cloud deployment, real-student sign-in setup, university admission rules or public availability.
- Google Calendar/eLC OAuth, provider credential storage, refresh/revocation and automatic source population.
- Browser collectors, background queues, Drive delivery, lecture transcription or source-verified assignment reconciliation.
- Complete deadline/announcement reconciliation, automatic daily briefings, reminders or proactive teaching.
- AI-provider integration, source-backed tutoring, cross-client GPT/plugin rollout or access to other chats.
- Production rate limits, spending controls, concurrency targets, backup restoration, key migration or sustained fault/uptime testing.
- A finalized consent, support-access, retention, deletion-backup and incident-response policy suitable for real students.

The student interface supports setup and manual data entry. Coursework and learning currently expose APIs, without a teaching or progress-management UI. Calendar entries are imports, not proof of current portal coverage. Saving a URL leaves its connector unavailable or needing authorization.

The browser pending-write queue survives only within the current page. Reloads or crashes lose its pending intent, so uncertain writes require receipt or record reconciliation before being recreated. The durable server receipts remain available; a persistent client recovery outbox is not implemented.

## Data handling and ownership

Only synthetic records belong in test fixtures. New runtime stores start empty. The copied-code allowlist and privacy scan are documented in [PORTING.md](PORTING.md); the personal system remains separate. Proprietary copyright is retained in [COPYRIGHT](../COPYRIGHT), with dependency licenses preserved.

Deletion removes active records and old save receipts while retaining a minimal tombstone and deletion receipt. Provider point-in-time recovery or backups may retain earlier copies under their own policies. Identity-key rotation requires a migration. See [ARCHITECTURE.md](ARCHITECTURE.md#storage-lifecycle-and-deletion) for the full contract and current limits.

## Next milestone

Configure a separately protected deployment, connect one real source through a supported per-student authorization flow, and prove that two consenting students can onboard independently without source edits or shared credentials. Complete the [pilot release gates](ARCHITECTURE.md#pilot-release-gates) before admitting real students; expand automatic collection and teaching after that evidence exists.
