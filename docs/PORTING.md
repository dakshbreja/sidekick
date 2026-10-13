# Clean successor and reuse inventory

This project starts as new source code with an explicit, small allowlist of reusable files. It is not a recursive copy followed by deletion. No personal records, class materials, credentials, cloud bindings, browser profiles, production logs, source subscriptions, GPT definitions, or deployment history are imported. The existing personal system remains separate. New students begin with empty workspaces.

Copyright remains with the author; see [COPYRIGHT](../COPYRIGHT). There is no open-source license grant. Dependencies retain their own licenses. Private repository hosting and deployment configuration are separate from this source foundation.

## Exact copied code

The machine-readable [porting manifest](porting-manifest.json) records source-relative paths, destination-relative paths and SHA-256 values. It contains no source-machine paths or private account identifiers.

| Original module | Destination | Treatment |
|---|---|---|
| `bridge/src/ics.js` | `src/core/ics.js` | Only initial verbatim port. Standalone calendar parser with bounded immutable timezone configuration cache. Caller supplies the student's timezone; recurrence coverage warnings are preserved. |

Before admitting another source file, inspect the entire file and its dependency graph, identify fixed personal configuration, remove or replace it in the new implementation, document the decision here, and add synthetic isolation tests. Passing a string scan alone is insufficient evidence that code is independent of the personal system.

## Patterns retained in new implementations

The following source modules were inspected for useful behavior. They are **not** on the copy allowlist.

| Original area | Preserve | Replace before adoption |
|---|---|---|
| `identity.js` | Exact source identity, course, term and due occurrence; ambiguity is an error | Fixed term and course imports; student ownership must come from verified authentication. |
| `record-store.js` | Revision conflicts, exact-retry receipts, transactional record/receipt writes | Personal migrations, shared record location, legacy imports and global initialization. |
| `learning-store.js` | Observed correct responses count separately from partial/incorrect work; assistance and evidence stay explicit; bounded handoffs | Personal course allowlist, fixed term and any existing learning records. |
| Collection and recovery stages | Stage-specific outcomes, exact source versions, retry state, hashes and confirmed readback | Browser ownership, local login assumptions, hardcoded destinations, existing schedules and account credentials. |

The initial successor implements a deliberately smaller runnable foundation. Reusing invariants is not evidence of feature parity with the personal system.

## Remaining feature ports and product work

- Independent identity-provider configuration, real student account onboarding and operational access revocation.
- Consented Google authorization, provider token vault, refresh/revoke paths and connection health. Saving a site URL only records intended setup.
- A supported eLC integration strategy, institution review where required, course/section discovery and original-source verification.
- Automatic collection, extraction, lecture transcription, source reconciliation, background queues, retries and isolated destination delivery.
- Complete deadline and announcement reconciliation, daily briefings, reminders and calendar synchronization. Manual calendar import does not establish fresh provider coverage.
- Source-backed teaching and private retrieval, model-provider integration, usage limits and verified resume behavior through the intended client.
- Cross-tenant adversarial tests for every new path, backup/restore drills, deletion/retention policy, incident response, cost controls and sustained load testing.
- A full onboarding experience and deployment. No automatic population from real sites is represented as working in this milestone.

## Source-export privacy gate

Run `node scripts/privacy-scan.mjs` before a commit or remote push. It scans candidate source files plus all tracked files, including accidentally tracked generated artifacts. Untracked dependency/build/runtime directories are excluded; build outputs are not treated as independently reviewed source. Symbolic links are rejected rather than followed. Binary course artifacts, private runtime files, secret assignments, known provider-key forms, personal filesystem paths, private GPT identifiers, live Worker hosts and Google source identifiers fail the gate. It reports only file/rule names, never matched content; detected private identifiers in filenames are redacted.

An additional `--denylist` JSON array may be provided from **outside the repository** to catch known private identifiers that have no general pattern. Do not put that list into source control. The scan is a conservative export check, not a proof that every possible credential or private fact is recognizable. Review the exact candidate file list and Git diff as well. Synthetic test records and copyright notices are intentional. Dependency lockfiles and generated environment declarations may be included when free of private values.

## October 13: school-feed and daily-dashboard reuse

Reused the already allowlisted standalone ICS parser and the community receipt, credential-envelope, isolation, persisted alarm and collection-budget contracts. Selectively inspected the personal announcement collector's RSS validation and date-review patterns as references only; no additional personal file was copied. The new `school-feed.js`, `school-feed-state.js`, `daily-dashboard.js` and `daily-ui.js` are independent implementations. Their fixed UGA host/path restrictions identify the institution, not a student's feed, organization or course. All course IDs, terms, subscription URLs and data are supplied separately per workspace.

Announcement RSS behavior is documented by [D2L's subscription guide](https://community.d2l.com/brightspace/kb/articles/1800-subscribe-to-an-announcements-rss-feed); calendar subscription availability by [UGA's Calendar help](https://help.elc.uga.edu/course-tools/calendar/). Neither reference verifies any particular student's access or feed completeness. XML parsing uses pinned fast-xml-parser with dependency notices in THIRD-PARTY-NOTICES.md; DOCTYPE and ENTITY declarations are rejected before parsing.
