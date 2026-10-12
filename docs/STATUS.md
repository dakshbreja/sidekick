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
| Saves | Atomic record/receipt/revision transactions; stale writes and conflicting operation reuse fail. Account-scoped persistent browser outbox, explicit receipt-first recovery, original-packet replay and stale-account guards. |
| Privacy controls | Current-workspace export, active-data deletion and permanent identity tombstones. No end-to-end-encryption claim. |
| Development checks | Contract tests, real SQLite unit tests, actual local workerd integration, privacy scanning and a dry-run Worker build. |
| Local demonstration | `npm run demo` serves two disposable synthetic workspaces at loopback. Its keys and assertions are generated for the run; it is not production authentication. |

## Verification evidence

The October 12 local gate passed **140 tests**, the privacy scan with an external private-reference denylist, and the Wrangler dry-run build. An independent code review rechecked the retry fixes and isolation boundaries. The synthetic HTTP demo served its assets and empty onboarding successfully and rejected a cross-origin request. Chrome blocked the loopback page with `ERR_BLOCKED_BY_CLIENT`, so that local run did not verify rendered-browser interaction or visual QA. The cloud evidence below supersedes that browser limitation.

The source is published in the private [school-bridge-community repository](https://github.com/dakshbreja/school-bridge-community). GitHub Actions independently passed the complete gate on Linux for commit `b0d98eef83ae2c20f04f165c535688bf3a07f12a`: [verified run](https://github.com/dakshbreja/school-bridge-community/actions/runs/38211864844), and again for documentation commit `a371291730c0e3582a889f1a8e8ab5abe4a7455f`: [verified run](https://github.com/dakshbreja/school-bridge-community/actions/runs/38212010291). This is source publication and CI validation, not a deployment of the student service.

The owner completed Codex connector repository authorization on October 12. A private cloud development environment was published with only this repository, Only me access, package-manager network access and no secrets. Cloud setup independently passed all 140 tests, the privacy gate, dry-run build and synthetic HTTP/isolation/authentication checks using Node 24 and a writable Wrangler configuration directory. The [cloud development task](https://chatgpt.com/local/01a12ecc-b450-7532-914b-3a763fecc0d0) is running with browser verification and persistent account-scoped save recovery assigned. Rendered-browser verification and persistent recovery are now complete in this review branch; evidence follows below. Configuration and the setup record are in [CLOUD-HANDOFF.md](CLOUD-HANDOFF.md).

### Cloud task evidence, October 12, 2026

The selected Linux cloud environment reproduced `npm ci --ignore-scripts` and the unchanged baseline `npm run check`: **140 tests passed**, privacy scan passed, and Wrangler dry-run build passed. Node was **24.19.0** and npm **11.9.0**. Development and optional dependencies were retained. The package proxy required the executor's network capability, and npm needed a writable cache outside the repository. `CI=true` and `WRANGLER_SEND_METRICS=false` followed the startup instructions. The initial run used a writable external XDG directory; the final rerun used the published `XDG_CONFIG_HOME=/workspace/.config` path. No private-reference denylist was supplied or sought for this cloud task; its privacy result covers the repository scanner's built-in rules.

Rendered baseline onboarding passed in **headless Chromium 154.0.8037.57** against `npm run demo`: empty A/B stores, profile/course/material saves, dropped material response followed by exact retry and receipt verification, honest source authorization status, revision-safe calendar replacement, downloaded export and deletion without changing B. The prior local `ERR_BLOCKED_BY_CLIENT` is historical and did not block cloud Chromium.

After the recovery change, `npm run check` passed **150 tests**, the privacy gate and Wrangler dry-run build. The ten added checks cover persistent response loss/restart, receipt-first replay, identity change, restored-intent submission blocking, mismatched acknowledgement/authentication loss, acknowledged-but-missing receipts, deletion cleanup, storage failure, minimal retained fields, and real workerd stale-account read guards.

The separate **`npm run test:browser`** rendered and passed onboarding and recovery using generated identities and disposable data. It closed and relaunched the entire browser with the same synthetic profile after a committed save whose response was dropped; receipt reconciliation completed with **zero additional material writes**. For a request aborted before storage, reconnect required explicit recovery and replayed the identical packet once after receipt-not-found. It verified that B did not show or replay A's outbox, that a stale A tab could not write after another tab changed identity to B, that calendar reimport replaced rather than appended events, that export downloaded current materials, and that a dropped deletion response survived browser restart and cleaned local recovery data while B stayed unchanged. The rendered run reported **zero uncaught page errors**.

Screenshots, synthetic exports, browser profiles and logs were kept outside the repository. The deliverable evidence bundle contains the cloud logs, browser report and screenshots; the reproducible harness is `scripts/browser-check.mjs`. This establishes covered headless-browser behavior, not an observed real-student pilot, all-browser support, production authorization or disaster recovery. No public deployment, real source authorization, provider access, automatic collection or teaching was enabled.

### PR review and hardening, October 12, 2026

The original PR commit `525792dc5765974b3378a274c275b8ed17b48627` passed GitHub Actions: [run 38214656818](https://github.com/dakshbreja/school-bridge-community/actions/runs/38214656818). That workflow covered the 150-test gate, privacy and dry-run build; its browser evidence was local to the cloud task.

The follow-up review reproduced and fixed delayed-account response handling: an older A refresh could append A materials after B had loaded, and an account change during calendar file preparation could send the original A packet using B's current guard. Complete refresh snapshots now commit only for the newest refresh, and calendar preparation preserves the identity captured at submission. Delayed exports are likewise discarded after the active workspace changes. Confirmed deletion invalidates outstanding refreshes.

Four outbox regressions reproduced cleanup/clear failures that dropped the in-memory reservation, unexpected receipt fields accepted without an acknowledgement, and missing local route metadata accepted as valid. Cleanup now rolls back its in-memory changes on local-storage failure. Receipt reconciliation checks operation, resource, expected revision and deletion status as well as operation ID and acknowledgement hash. Invalid/oversized local data is rejected before recovery. A fifth test protects the screenshot boundary against repository directories whose names begin with two dots.

The reviewed cloud gate passed **155 tests**, privacy scan and Wrangler dry-run build. The expanded rendered Chromium 154.0.8037.57 suite passed the existing onboarding/recovery scenarios plus delayed A refresh versus a newer B screen, identity change while file text is pending, and delayed A export after B becomes active, with **zero uncaught page errors**. Synthetic screenshots and before/after logs remain outside the repository under the review evidence directory.

GitHub CI now runs the separate rendered suite with an installed Chromium/Chrome executable and retains only generated synthetic browser evidence as a private-repository artifact for **seven days**. A missing browser is a concrete CI failure, not an inferred browser pass. The updated head's CI result must be checked separately from the original run cited above. Public deployment, real-source access and all remaining pilot gates are unchanged.

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

The browser recovery outbox now persists pending packets across reloads and browser restart. Recovery after reconnect or reload is explicit and checks receipts before any exact replay. Its plaintext local-storage retention, per-account cleanup and shared-browser limitations are documented in [SECURITY.md](SECURITY.md#browser-recovery-outbox). Clearing site data loses recovery intent; receipt and record inspection remains necessary before recreating an uncertain write.

## Data handling and ownership

Only synthetic records belong in test fixtures. New runtime stores start empty. The copied-code allowlist and privacy scan are documented in [PORTING.md](PORTING.md); the personal system remains separate. Proprietary copyright is retained in [COPYRIGHT](../COPYRIGHT), with dependency licenses preserved.

Deletion removes active records and old save receipts while retaining a minimal tombstone and deletion receipt. Provider point-in-time recovery or backups may retain earlier copies under their own policies. Identity-key rotation requires a migration. See [ARCHITECTURE.md](ARCHITECTURE.md#storage-lifecycle-and-deletion) for the full contract and current limits.

## Private sign-in preparation

The next preparation branch adds [PRIVATE-SIGNIN.md](PRIVATE-SIGNIN.md), a plain-language owner guide, setup decisions and a hosted acceptance checklist. The owner's Cloudflare account readiness is not yet confirmed. No hostname, Access application, provider permission or secret was provisioned by this work.

The synthetic gate passed **158 tests**, privacy scanning and Wrangler dry-run. Three added identity tests check issuer separation for the same subject, audience changes that reject mismatched tokens without moving the subject's workspace, and per-request expiry/identity validation when public signing keys are cached. These are implementation contracts; real Access admission, session revocation and the deployed removal deadline remain unverified. Application behavior is unchanged from the reviewed recovery branch. The new preparation PR depends on that still-unmerged branch.

## Next milestone

Configure a separately protected deployment, connect one real source through a supported per-student authorization flow, and prove that two consenting students can onboard independently without source edits or shared credentials. Complete the [pilot release gates](ARCHITECTURE.md#pilot-release-gates) before admitting real students; expand automatic collection and teaching after that evidence exists.
