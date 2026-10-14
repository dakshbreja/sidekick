# Private-pilot smoke check and release gates

Copyright 2026 Daksh Breja. All rights reserved.

This is a review checklist, not permission to invite students. Current live operator evidence is in STATUS.md; historical setup instructions do not mean Google or Claude needs configuring again. This cloud pass contacts neither provider nor deployment.

## Run the bounded synthetic smoke

With Node 24, from this repository:

```sh
npm ci --ignore-scripts --include=dev --include=optional
XDG_CONFIG_HOME=/tmp/school-bridge-pilot-config CI=true WRANGLER_SEND_METRICS=false npm run test:pilot
```

Use a writable configuration directory outside Git. The command runs nine synthetic suites with two concurrent files, generated A/B identities, disposable SQLite/workerd, intercepted HTTP and a synthetic AI response. It accepts no hostname or credential arguments. A failed assertion or abnormal child exit fails the command; the final summary always marks external verification and student admission false. Tests remove their temporary stores during normal cleanup. If the process is forcibly killed, remove only its synthetic temporary test directories; never use a live store as a fixture. Normal suite output contains generated fixtures only; keep any captured logs outside Git.

| Covered path | Reused evidence |
|---|---|
| Two empty accounts, distinct records despite identical IDs, foreign reads/receipts denied, fresh exports | `runtime.test.mjs` |
| Durable record/receipt replay across restart; fresh-revision deletion; deleted A stays retired across another restart while B survives | `runtime.test.mjs` |
| Quiesced snapshot restored into a new directory; post-deletion tombstone and B receipts survive; old snapshot negative control exposes resurrection | `recovery-runtime.test.mjs` |
| Calendar consent-state consumption, private-row deletion across restart, staged atomic collection, interrupted provider work | `google-state-runtime.test.mjs`, `google-collection-runtime.test.mjs` |
| Bounded provider-removal retries, pending/confirmed/unconfirmed distinction, deletion during provider I/O | `google-revocation.test.mjs` |
| Feed alarm survives restart, progress survives restart, private URL excluded from export, removal/deletion | `school-feed-runtime.test.mjs` |
| Course-scoped OAuth, checkpoint save/receipt, fresh-client resume after restart, read-only denial, revoke/reconnect, deleted-account access/refresh denial | `connector-oauth.test.mjs` |
| Client response loss, receipt-first recovery, identity switch, deletion cleanup and failed local cleanup | `outbox.test.mjs` |
| Tutor exact retry without repeat inference, restart/readback, deletion/changed-source late-response fences and quotas | `tutor.test.mjs` (synthetic AI only) |

This smoke is API/storage/contract evidence. It does not run a rendered browser or a real Claude/Google/eLC session. For final source validation run `npm run check` once; the existing CI separately runs `npm run test:browser` against the actual dry-run deployment bundle. No public deployment command is part of the smoke.

## Clean-directory recovery drill

Run `npm run test:recovery` for the four-check local snapshot drill. It shuts down workerd before copying synthetic SQLite state, restores into a new path and verifies A deletion plus B data/receipts/ownership. Generated identity material stays in the test process; only generated persistence is copied, and the temporary trees are removed afterward. No production configuration or live backup is accepted.

The negative control deliberately restores the pre-deletion snapshot in an isolated fixture and confirms it contains A again. This is a passing test of a known unsafe recovery procedure, **not a fix or permission to use it**. The drill demonstrates snapshot portability with the same generated identity/key configuration. It does not implement Cloudflare point-in-time recovery, independently retained deletion records, key migration or restore after loss of keys. Keep restored services inaccessible until later deletions and revoked grants have been reconciled from an independent record and both accounts verified. If that record is missing, do not reopen the old backup to users.

## Retention and deletion inventory

| Location | Current behavior and remaining limit |
|---|---|
| Active workspace SQLite | Current records, source snapshots/choices, study checkpoints, grants, tutor sessions/operations and private Google/feed rows are cleared with the deletion tombstone. Old saves cannot recreate the identity. Historical receipt bodies retain earlier edited/cleared text until deletion; export contains current records, not every historical receipt. |
| Minimal deletion recovery | Pseudonymous owner binding, deletion time/revision and one deletion receipt persist so an uncertain deletion can be reconciled. Identity remains retired. This is intentional retention, not total physical erasure. |
| Google/feed secrets | Server-side encrypted rows are excluded from normal records/exports. Google permission removal can retain an encrypted removal-only token for bounded retries, up to 24 hours; deletion clears that job and cannot prove provider revocation. Revoke first and confirm, or use the provider's account controls. |
| Connector OAuth KV | Immediate access checks use the student-local grant/tombstone. Access expires after 15 minutes; independent/refresh grants expire after seven days. Local deletion rejects further reads, writes and refresh, but does not establish physical erasure of provider-library KV entries or copies. Verify/document that retention separately. |
| Browser recovery | Pending plaintext packets remain until receipt reconciliation or confirmed deletion; no timed expiry. Another identity's queue stays separate. Offline profiles, exports, screenshots and provider conversations cannot be remotely erased by deleting the server workspace. |
| Shared budgets | Anonymous collection/tutor counters and OAuth request limits are separate from student content. They are neither exports nor backup/retention proof. |
| Hosting logs, backups and external assistants | Retention and support access need explicit policy. Runtime restart is not restoration from backup. Deletion cannot recall material already sent to an assistant or remove an external provider grant automatically. |

Archiving material withdraws it from new teaching and creates a revision; it is reversible and preserves historical source evidence. It is not erasure. Changed-source resume checks do not regrade history, and assistant feedback remains unverified with mastery false.

## External gates before a student pilot

Keep each gate open until its actual evidence and responsible operator are recorded. Existing operator simulations are useful evidence but do not establish an independent student journey.

- **Private access:** independently controlled consenting test identities; hosted denied/expired/revoked access, stale-account reads/writes and cross-account receipt/export probes. Do not widen the allowlist as part of this script.
- **Hosted recovery:** disposable response-loss/reload/deletion checks, interrupted jobs, clean-environment restore with deleted identities still retired, protected identity/encryption-key recovery and migration. A process restart with the same SQLite files is insufficient for disaster recovery.
- **Privacy/support:** understandable consent, source permissions, historical-receipt retention, plaintext browser remnants, OAuth KV and backup/log retention, deletion propagation, incident contact and support-access rules. No retention deadline is invented here.
- **Live sources:** preserve completed operator Google/Claude setup; verify the remaining hosted failure/recovery cases, prolonged freshness, expiration and permission removal. Real eLC feed consent and signed-in browser verification remain local/user-dependent. A registered URL is not connection evidence; an empty calendar does not prove nothing is due.
- **Free-only capacity:** verify free-tier configuration, concurrent pilot usage, collection fairness, throttling and graceful quota exhaustion with no paid fallback. Current bounds and one healthy observation are not a sustained capacity/cost study.
- **Teaching/product:** independent observed pilot feedback, truthful source coverage and assistance, fresh-client resume and save receipts. Existing bounded fictional Claude checks do not establish broad grading quality or mastery. Additional providers remain provider-neutral/manual until separately verified.
- **Admission decision:** named small cohort, owner approval and explicit evidence review after the above gates. No invitations, school collection, deployments or grants are authorized by passing this smoke.

## Bring the cloud result back

Fetch `codex/cloud-pilot-smoke-20261014`, based on `ae95090526d276885233a5ec828587c89e18781e`, and review its draft PR against `codex/local-community-20261012`. Merge only after local review; if the local branch advanced, preserve its changes and resolve conflicts. Never reset or force-push either branch. This pass adds no production behavior and requires no deployment/provider setup. Continue local/user-dependent checks using the existing protected configuration, without transferring credentials or private evidence into cloud or Git.
