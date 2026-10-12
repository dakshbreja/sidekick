# Foundation status

Status date: October 12, 2026.

The clean community foundation is implemented locally. It supports separate, initially empty student stores and manual onboarding/imports. It is not deployed for real students and does not provide the full feature set of the personal School Bridge.

## Implemented

| Area | Current behavior |
|---|---|
| Identity | Server verification of signed Cloudflare Access end-user assertions, pinned issuer/audience and HMAC-derived student ownership. Unconfigured authentication fails closed. |
| Isolation | One SQLite Durable Object per student; permanent owner binding, strict fields and scoped resources, receipts, retries and exports. |
| Onboarding | Empty academic profile with optional institution, self-reported school email, study goals and learning preferences. Login email comes from the signed identity. Arbitrary courses/sections/terms and source metadata; no preloaded personal records. |
| Materials | Pasted course text or optional UTF-8 text exports of notes/transcripts, preview before save, source/type labels and inert text reading. No recording subscription needed; audio/video/PDF extraction is unavailable. |
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

- Real-student admission, university verification or public availability. An approved two-account operator-controlled hosted test is active; its actual evidence is recorded below.
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

## OpenAI plugin preparation

[PLUGIN-PLAN.md](PLUGIN-PLAN.md) records official OpenAI migration guidance researched on October 12, 2026 and the community-specific rollout. `plugins/school-bridge-community` contains a proprietary instruction-only manifest plus onboarding and save-recovery skills, freshly authored from this repository's contracts. No personal GPT, conversation, student material or credential was imported. No plugin was installed, published or connected.

The synthetic gate passed **162 tests**, the repository privacy scanner, the new instruction-only package audit and Wrangler dry-run. Four added package tests exercise live-tool/hook rejection, onboarding path confinement, unexpected files/symlinks and honest host-verification status. `npm run check` now includes `npm run check:plugin`. These checks establish package scope; they do not establish OpenAI host acceptance, skill selection, model adherence or faster/cheaper operations. Host tests and comparative task/latency/cost measurements remain pending, as do all live-access and teaching gates.

The sign-in preparation parent independently passed [GitHub Actions run 38308979915](https://github.com/dakshbreja/school-bridge-community/actions/runs/38308979915), including rendered synthetic browser QA. The plugin preparation is a new stacked draft with separate CI results to verify.

## Private plugin tryout package

The owner reports that plugin creation/migration options are visible in ChatGPT. Actual ZIP upload availability, successful installation and model behavior have not yet been verified. [PLUGIN-TRYOUT.md](PLUGIN-TRYOUT.md) explains the private download/upload path, seven short acceptance prompts and an effort/quality/time comparison without collecting student data.

`npm run package:plugin -- --output <external path>` now builds the reviewed four-file instruction package after auditing it. It refuses outputs inside the repository, including symlinked paths, uses a unique temporary file and produces a stable ZIP/checksum. The gate passed **164 tests**, privacy scan, package scope audit and dry-run. Two added archive tests check exact file contents/reproducibility and output confinement. The archive was opened successfully and contained only the manifest, copyright and two skills; this is archive verification, not an OpenAI-host test.

CI now retains `school-bridge-plugin-test-package` privately for seven days alongside the separate synthetic website evidence. It does not install, submit, publish or authorize the package. The owner can download the artifact, extract the inner plugin ZIP and try the supported private upload when available. Host acceptance and efficiency benchmarks remain pending.

## Owner-observed plugin tests and sign-in readiness

Owner-provided screenshots show a private personal School Bridge Community plugin listed as installed, with Save Recovery and Workspace Onboarding enabled. The observed recovery answer directed the user to the original account and receipt-first recovery, did not suggest an immediate duplicate save, and admitted it could not inspect live receipts. The observed fictional-onboarding answer distinguished drafts from saved records and explained source registration honestly. These two manual instruction scenarios behaved as expected; they do not establish backend access, package byte-equivalence, automatic skill selection, complete host validation or efficiency savings. The screenshots contain unrelated personal UI and were not copied into Git or CI artifacts.

The onboarding response referred to a nonexistent “Manual entry” source. Draft package **0.1.1** now names the actual source choices and separates manual material text from calendar file import. The already-created host plugin has not been updated by this session; that requires its supported creator/update flow.

The owner reports being signed in to Cloudflare and owning no custom domain. A built-in Worker address protected with scoped Access is the documented private-test alternative; no purchase is required for that path. This execution environment still has no Cloudflare provider connection or secrets. The actual address, Access application, dedicated settings and test-account policy remain pending. `npm run check:signin` correctly reports the three absent setting names and makes no network requests. It validates format only and never marks identity, policy, hostname or revocation as verified.

The updated gate passed **167 tests**, privacy scanning, plugin scope audit and Wrangler dry-run. Three added preflight tests cover missing names, safe invalid-configuration handling and valid synthetic format without network access or value disclosure. No deployment, provider permission, real sign-in or school authorization was performed.

## Next milestone

Configure a separately protected deployment, connect one real source through a supported per-student authorization flow, and prove that two consenting students can onboard independently without source edits or shared credentials. Complete the [pilot release gates](ARCHITECTURE.md#pilot-release-gates) before admitting real students; expand automatic collection and teaching after that evidence exists.

## Standalone profile and optional imports, October 12, 2026

The local branch implements the first stage of [PRODUCT-PLAN.md](PRODUCT-PLAN.md). The gate passes **171 tests**, including actual workerd/SQLite save, replay, profile-clearing, export, restart, deletion and two-student isolation checks with extended profile/material fields. Absent new fields remain absent from normalized legacy requests, preserving old save fingerprints. Login email is taken from the signed assertion; profile requests cannot spoof login email, verified enrollment or a student ID. No real student records were used.

The Codex in-app browser independently verified synthetic profile save/receipt confirmation, course creation, `.vtt` file preview, transcript save/readback with script-looking content rendered literally, an empty Student B workspace, and restoration of Student A after switching back and reloading. This is local UI evidence, not hosted identity or cross-client AI evidence.

The optional-tools screen distinguishes available text imports from planned ChatGPT/Claude connections and website AI. Editable preferences do not establish understanding or access to other chats. Current preferences can be cleared; historical save receipts retain earlier values until account deletion under the existing recovery contract. The signed-in Cloudflare account was confirmed locally through the official CLI without reading or displaying its credential. Provider deployment, Access setup, source authorization and model spending remain separate steps.

### Approved private hosting and deployment repairs

Source commit `2fc47bd` was uploaded to the new `school-bridge-community-dev` Worker on October 12. Wrangler reported **No targets deployed**; the dashboard independently showed **No URLs enabled**, zero domains/routes and a separate `STUDENTS` Durable Object binding. Version: `84a087ca-77de-4361-ad72-587a6d0d6140`. Existing services were not modified.

After explicit owner approval, a dedicated Worker Access application was applied to All traffic and narrowed to a single exact owner-email rule before routing was enabled. The separate tenant secret and pinned identity settings are installed. The default repository configuration remains unrouted; a protected external owner-test configuration enables the approved address. Browser admission reached the app through the existing owner account. Signed-out HTTP requests returned denial without workspace data, and browser navigation independently showed the Access login.

The first hosted page exposed `__name is not defined` in a serialized browser helper. Commit `4311cdb` fixes Wrangler build settings and adds an actual deployment-artifact check covering helper execution, text validation, save/receipt, lost-response restoration and separate student state. `npm run test:browser` now builds and tests that deployment artifact. Both GitHub runs passed: [push](https://github.com/dakshbreja/school-bridge-community/actions/runs/38317026288), [pull request](https://github.com/dakshbreja/school-bridge-community/actions/runs/38317030894).

A subsequent hosted backend check rejected a valid Access assertion because its optional JOSE header type was absent. Commit `05eb877` permits absence while rejecting an explicit wrong type and retaining all signature, pinned issuer/audience, lifetime, human identity and payload `type=app` requirements. The gate passed **174 tests** plus the deployment-artifact check. Opt-in diagnostics log only allowlisted validation categories; no credentials or identity values. Live owner authentication then passed. Synthetic profile, course and note saves each returned the UI’s receipt-confirmed success; a full reload restored all three, and Read material returned the exact saved source with script-looking text rendered literally. No real school data was entered. Opt-in authentication diagnostics were disabled after verification.

This establishes the owner-only hosted path, not a real-student pilot. Two independently controlled real accounts, denied-account sign-in, provider expiry/revocation, hosted failure/recovery/deletion and restore/load drills remain outstanding. School OAuth, automatic collection, website teaching and live external AI-client connections remain unimplemented.

The final verified code head is `05eb877`; [push CI](https://github.com/dakshbreja/school-bridge-community/actions/runs/38317403892) and [PR CI](https://github.com/dakshbreja/school-bridge-community/actions/runs/38317408381) both passed, including rendered deployment-bundle recovery. Final owner-test deployment version: `26687ec6-8fe3-44ef-97ef-5dc3614fc650`, with category diagnostics disabled.

### Two real accounts and calendar connector foundations, October 12

After explicit approval, the dedicated Access policy was expanded from one exact owner address to two addresses controlled by the same operator. Email-code authentication was added and selected for this app alongside the existing Cloudflare login. The application inventory showed one Access application; the policy readback showed exactly the two approved addresses and one application. No domain-wide student admission was enabled. Real addresses, screenshots and exports remain outside Git.

The operator completed the second account's email-code sign-in. Its workspace started empty. A distinct synthetic profile, course and note saved with receipt-confirmed UI success, survived full reload, and returned exact note text. The first account remained open in a separate browser session with its original records. Each account's material list excluded the other's marker. Downloaded exports independently showed different workspace identities, their respective profile/course/material records and no opposite-account marker. The second account is a test identity owned by the operator, not a second student pilot.

This verifies normal hosted admission, save/readback and export separation for two real sign-ins. It does not verify hosted forged-ID attacks, cross-account receipt queries, session expiry/revocation, account switching during pending writes, deletion or disaster recovery. Existing synthetic tests cover some of those contracts; live evidence remains a separate gate. The hosted Worker code/version was not changed in this step.

The new server-only Google read adapter and credential encryption components are documented in [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md). Twelve additional synthetic tests cover bounded and paginated collection, cancellations/recurrence identity, malformed input, token expiry, full-sync reset signals, throttling, timeout/body limits, redirect rejection, and encryption context separation/tamper detection. The components also execute in real local workerd with intercepted provider responses. The full local gate passes **186 tests**, privacy scanning (including the external private-reference denylist), plugin audit, dry-run build and actual deployment-artifact checks. The application still declares Google OAuth/background collection unavailable; these components have no live routes, provider credentials or scheduled jobs yet.
