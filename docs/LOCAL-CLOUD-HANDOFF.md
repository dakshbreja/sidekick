# Local and cloud development handoff

Updated October 14, 2026. Copyright 2026 Daksh Breja. All rights reserved.

The owner requested this existing local chat to handle Mac/browser setup while retaining the cloud chat for cloud development. Both work on the same private community repository, with separate Git branches. Neither is the personal School Bridge.

| Role | Chat and branch |
|---|---|
| Local Mac and signed-in browser setup | [Audit School Bridge readiness](codex://threads/01a127fb-eadc-70b1-a69b-efcd27e7f3a5), `codex/local-community-20261012` |
| Cloud development and Linux checks | [Continue the School Bridge Community foundation in the sele…](https://chatgpt.com/local/01a12ecc-b450-7532-914b-3a763fecc0d0), current continuation `codex/cloud-pilot-smoke-20261014` (earlier calendar branch preserved) |

The local branch starts at cloud commit `1dc5d248d1654a6fd47c2736dfb42f1feadfbd92`, incorporating recovery PR #1, private sign-in preparation PR #2 and plugin PR #3. All three PRs remain open and unmerged. Local work must push its own branch, never overwrite a cloud branch or implicitly merge into main. Fetch and review new commits before transferring later changes. Credentials, browser sessions and runtime data do not travel between these environments through Git.

## Current continuation — October 14, 2026

The owner requested moving ongoing work back to the existing cloud chat before laptop closure. Fetch `origin/codex/local-community-20261012` at this checkpoint and create a new continuation branch from it. Do not resume from the old calendar branch or repeat the historical provider setup below. The private website, Google Calendar and scoped Claude connector are deployed; current evidence and explicit limits are at the top of STATUS.md. The live source-gap, assistance-preservation, save/receipt and fresh-chat regression passed; its temporary grant is revoked. No live credentials, browser sessions or private evidence are included in Git.

Next cloud-sized milestone: prepare a bounded private-pilot readiness pass using synthetic data only. Review the existing retention/deletion and restart/recovery behavior for concrete gaps; prioritize one reproducible failure or, if none is found, a concise executable two-student pilot smoke test and release checklist. Reuse existing tests, avoid broad refactors and repeated full-suite runs, and keep free-only/provider-neutral operation. Run focused tests and one final appropriate check, commit/push a separate continuation branch, and create a draft PR against `codex/local-community-20261012`. Update this handoff with the result. No deployment, new student access, live OAuth grants, personal Bridge reads or real school collection is authorized by this handoff. Real eLC consent and signed-in provider checks remain local/user-dependent. Existing public-release gates remain open.

## Cloud pilot-smoke result — October 14, 2026

Continuation `codex/cloud-pilot-smoke-20261014` starts at exact pushed checkpoint `ae95090526d276885233a5ec828587c89e18781e` and targets `codex/local-community-20261012` in a separate draft PR. All older branches/PRs are preserved. The checkpoint's 358-check validation and live Claude results remain prior local evidence; this pass does not retest provider setup or contact a model.

A bounded read of deletion/retention, OAuth retirement, source/tutor late-response fences and recovery found no reproducible material implementation failure. Added `npm run test:pilot`, reusing eight existing synthetic suites rather than changing production behavior. It passed **79 checks** in actual local workerd/SQLite and contracts, including a new deleted-account restart check: same tombstone/identity and deletion receipt, exact deletion replay, old receipts/reads/writes denied, B unchanged, and only the deletion receipt left in A's SQLite. This is a restart with the same storage, not a backup restore. The smoke summary never marks external gates verified or authorizes admission. The one final `npm run check` passed **359 checks**, built-in privacy scan (122 files, no findings), plugin audit, dry-run build and executable deployment bundle. No external private-reference denylist was supplied; no rendered-browser result is inferred from this command.

[PILOT-CHECKLIST.md](PILOT-CHECKLIST.md) documents the executable command, test map, retention locations, free-only operation and remaining hosted/local/user-dependent gates. It distinguishes active-data cleanup from OAuth KV/backups, provider grants and offline-browser remnants, and archive from erasure. No new client storage, retention timers, deployment or provider setup was introduced. Synthetic logs remain outside Git at `/workspace/work/pilot-smoke-20261014.log` and `/workspace/work/pilot-final-check-20261014.log`; no personal denylist was requested or copied into cloud.

Bring back by fetching this continuation and reviewing the draft diff against the local branch. Merge only after local review, preserving newer local changes; never reset or force-push either branch. Locked install and `npm run test:pilot` reproduce the bounded check locally. No deployment is needed for this test/documentation pass. Preserve completed Google/Claude configuration; real eLC consent/browser tests, hosted recovery/retention, independent student admission and measured free-tier capacity remain external gates. The laptop can stay closed while cloud/CI runs.

## Operator-release continuation — October 14, 2026

The owner chose the existing **two operator accounts first**, with a few specifically invited users later. No access change or public signup is authorized now. OPERATOR-RELEASE.md gives the concrete local release/readback sequence and invitation prerequisites. Cloud still has no hosting credentials or local signed-in browser; do not transfer them here. The latest local head remains `ae95090526d276885233a5ec828587c89e18781e`.

Continuation stays on `codex/cloud-pilot-smoke-20261014` / draft PR #6. Added `npm run test:recovery`: four passing synthetic checks copy only quiesced local state into a different directory, verify deleted A stays retired and B data/receipts/owner survive, and expose the **pre-deletion backup resurrection hazard** as an isolated negative control. That negative control is not a production recovery fix. Independently retained deletion/revocation records, key recovery and hosted restoration remain gates before student admission. The pilot smoke now includes this ninth suite; no production behavior or provider setting changed. One final `npm run check` passed **363 checks**, built-in privacy scan (124 files/no findings), plugin audit, dry-run and executable bundle. The focused four-check recovery run passed first. Logs remain outside Git in `/workspace/work/recovery-drill-20261014.log` and `/workspace/work/operator-release-check-20261014.log`.

## Weekend Atlanta demonstration — latest owner instruction

The immediate goal is a working private demonstration for the owner's father this weekend, rather than admitting students or finishing every planned feature. Keep the two existing operator accounts and demonstrate together through the owner's signed-in session using fictional material. Do not add the father/student identities or public signup unless separately requested.

**Local chat: take over hosting/readback now.** Fetch and review draft PR #6 / `codex/cloud-pilot-smoke-20261014`; preserve any newer local work. Its latest additions are tests/docs only, with 363 full checks and 22 CI browser scenarios passed at `e3234c403854f9e873f29c19a3caeb869237b040`. Merge the reviewed continuation into the local branch if appropriate, without resetting branches or merging main. Read the current STATUS.md and use the latest reviewed local product source for any deployment.

Stay on the existing separate **Cloudflare** deployment and protected external configuration. The product already uses Durable Objects, SQLite, alarms, Access and a service-bound connector; Railway would require adaptation and is not needed for this demo. Confirm the existing free plan/quota and keep free-only inference controls; no plan upgrade, paid fallback or new provider grant is authorized. Do not deploy blank repository defaults or recreate Google/Claude setup. No domain purchase is needed for the existing protected address.

First inspect the currently deployed versions and open the existing private app. If the latest product code is already deployed and works, no redundant deployment is necessary. If a product update is missing, build/dry-run it, review the exact dedicated Worker/connector targets and existing bindings/settings, then deploy through the existing authorized local setup. Preserve all-traffic Access, preview restrictions, storage/keys, logging and personal services. Verify actual hosted behavior afterward; CI alone is insufficient.

Prepare a five-minute demo using a fictional course/material and disposable calendar: show separate workspace identity, course/notes save and reload, upcoming/daily view with source freshness, and study continuation with a receipt and fresh-session readback if the existing connection is available. Use a previously verified synthetic checkpoint if a live assistant is unavailable; label it saved evidence rather than a new inference. Demonstrate that source-limited/assisted answers do not imply mastery. Avoid destructive deletion of wanted operator records. Give the owner the actual protected URL through the local chat and explain sign-in, visible available features, and still-planned features in plain English. Keep real URLs, secrets, exports, browser evidence and source content outside Git.

Cloud cannot directly forward a chat message or deploy: no tool here controls the local thread/browser, and this runtime has no Cloudflare identity, protected deployment config or secrets. This committed handoff and PR are the transfer mechanism. Do not request credentials in chat to work around that limit. Student invitation, retention/recovery and real eLC gates remain before a later student pilot; they do not require a public launch for a fictional family demonstration.

## Run locally

With Node.js 24 or newer, run from the repository:

```sh
npm ci --ignore-scripts --include=dev --include=optional
npm run demo
```

On the Mac, `scripts/start-local.command` is a double-clickable launcher. It installs locked dependencies only if `node_modules` is missing. After changing branches or dependency versions, rerun the installation command above. Use one server at a time; if port 8766 is already in use, use the existing demo or stop its original terminal before starting another.

Open **http://127.0.0.1:8766** on the same Mac. Student A and Student B are disposable fictional identities. The server binds only to loopback. Control-C stops it and discards server-side demo state; browser pending-save storage can outlive that server, so never enter real student information in this simulation. This launcher does not install an automatic startup job.

## Local evidence

The October 12 Mac checkout reproduced all **167 tests**, the plugin scope audit, privacy scanning and Wrangler dry-run build. The external private-reference denylist also passed for all 55 source files. The running demo returned HTTP 200 for its page, styles, scripts and health endpoint; both students started with distinct empty workspaces, and a foreign-Origin request returned 403.

Chrome automation returned `ERR_BLOCKED_BY_CLIENT` when opening the loopback address. Therefore rendered interaction on this Mac is not verified by this run. The cloud branch's separate rendered-browser evidence remains recorded in STATUS.md. The owner was asked to open the local address manually; that is not yet recorded as a successful check.

The local chat could read the owner's authenticated Cloudflare browser tab at Create an app. This verifies available browser access, not a deployment or Access configuration. No provider setting was changed by this local setup.

## Calendar delivery continuation, October 13

The local handoff reports that source commit `7469cd0995a25e9c3790b749959f2dc6828eef29` is deployed to the separate private community Worker, including its scheduler binding and safe logging. Two operator-controlled accounts retained separate synthetic records after reload. Exact-head push CI [38325896709](https://github.com/dakshbreja/school-bridge-community/actions/runs/38325896709) and PR CI [38325900567](https://github.com/dakshbreja/school-bridge-community/actions/runs/38325900567) passed. These are local-chat reported checkpoints, not new cloud inspection of hosting. Do not repeat the old hosting setup above.

Cloud continuation branch: `codex/cloud-calendar-status-20261013`, based on **that exact commit**, targeting `codex/local-community-20261012` in a separate draft PR. Original branches and PRs are preserved. This pass makes calendar progress visible in Today and Sources even with Google disabled, using existing capabilities, authorization, saved selection, completed collection and actual projection coverage. It fixes connector-read outages blocking unrelated workspace refresh and adds individual saved-calendar removal after reload without another provider discovery. It adds no new data storage, provider permissions, collection enablement, deployment or AI spending.

Verification: `npm ci --ignore-scripts --include=dev --include=optional`; full `npm run check` passed **301 tests**, built-in privacy scan, plugin audit, Wrangler dry-run and deployment-artifact execution. Rendered deployment-bundle Chromium **154.0.8037.57** passed **18 scenarios**, including visible disabled setup, consent/choice/sync/current/stale/partial/removal states, connector outage with usable courses, identity-error rejection, individual saved-choice removal, response-loss receipt recovery, restart, A/B separation, export and deletion. Google browser responses are intercepted synthetic fixtures; they are not live-provider evidence. Synthetic screenshots/report are outside Git under `/workspace/work/calendar-browser-final`; CI publishes its own private seven-day browser evidence. No personal denylist was requested or imported into cloud.

### Bring the code back locally

Fetch only this repository and review the draft diff against `codex/local-community-20261012`. If local work advanced, merge the continuation branch into the local branch after reviewing/resolving conflicts; never reset or force-push either branch. Rerun locked install and checks locally. The cloud branch does not deploy and must not be deployed using blank repository defaults. Use the existing protected external deployment configuration only after local review. The new status copy will not appear on the hosted page until that reviewed update is deployed locally.

### Local provider setup still required

The owner approved a dedicated community Google project/client, read-only Calendar scopes, Production mode and a disposable test calendar. The local handoff reports the project/web client already created and the exact protected-host `/api/google/callback` registered; its downloaded credential remains securely on the Mac outside Git. **Do not send credentials, cookies, actual host configuration or personal Bridge data to cloud/chat.**

Continue locally: finish Google consent-screen Production mode, Calendar API and the two documented read-only scopes; install dedicated community client/encryption settings in the existing protected Worker configuration and verify flags/bindings/logging. Then exercise real consent through Access, reviewed calendar selection, initial and incremental sync, recurring/all-day coverage, refresh, revoke, reconnect and two-account isolation with disposable events. Verify disabled/expired/denied access, response loss, deletion and removal propagation. Do not label a registration, saved permission, selection or synthetic test as successful live sync. Broader student admission, restore/load controls and the rest of PRODUCT-PLAN.md remain unfinished.
