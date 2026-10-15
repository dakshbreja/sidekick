# Course-file relay

An optional free, standard-library Python publisher copies verified extracted course text from an existing local collector into one explicitly selected Sidekick workspace. It does not download from the LMS, run the personal collector, connect to its API, import grades or change progress. A computer that is asleep cannot publish new files. The hosted calendar/announcement collectors remain independent.

## Consent and configuration

On Connections, select exact courses, then enable the relay. The signed-in website creates a random 256-bit credential bound to that owner's selected course IDs. Only its SHA-256 digest is stored server-side. Download the connection once and keep it outside the repository with owner-only file permissions. The credential expires after 180 days; revoke it under Connections. Revocation stops publication and metadata access immediately and keeps already imported materials. Account deletion also clears the grant. John demo workspaces cannot create grants. No new AI assistant access is implied.

The command takes five external arguments: `--config` (downloaded connection JSON), `--state` (private recovery state), `--source-root` (existing collector project), `--term` (exact Sidekick term ID), and `--source-term` (exact collector term identifier). Source revision metadata must match that source term and course, preventing a later semester from silently populating an old course. `--dry-run` checks the selected server courses and local files without publishing. Never put configuration, pending packets, collected documents or logs in Git. Install a reviewed copy outside a changing checkout; schedule that copy hourly while the computer is awake. The publisher uses an exclusive lock, so manual and scheduled runs cannot overlap. No Codex/ChatGPT session is needed.

## Import contract

- Read only `.manifest.json`, `.material-delivery.json`, `.fetched.json` and the referenced files within each selected course's `collect/<course>/text` and `raw` directories. Require current topic membership and one exact course-code/term match; ambiguity fails closed. The legacy trailing `E` course suffix maps to the registered base code.
- Require completed extraction and verify both the original raw SHA-256 and extracted text SHA-256. Stream raw-file hashing. Pending, changed, oversized, unreadable or out-of-scope files are skipped and counted. No missing-source deletion is inferred.
- Normalize PDF/slide line/page controls into line breaks; represent null/missing glyphs visibly with the replacement character. Reject remaining unsupported control characters. Hash the actual normalized payload independently. Diagrams, equations, spreadsheet behavior and transcription accuracy still require checking the original file.
- Use stable opaque topic/course identities across content revisions. Do not send source URLs, local paths, portal cookies or collector credentials. Only explicitly authorized course material and provenance timestamps leave the computer.
- A local pending packet is saved atomically with owner-only permissions before transmission. An uncertain response is recovered by the same operation receipt or exact retry. Check operation, resource, revision and request fingerprint before clearing it. Never retry an uncertain save with a newly generated ID.
- Updates use compare-and-swap revisions. Manual edits detach a record from automatic updates; archived/detached records and older extraction snapshots cannot be overwritten. Status includes detached relay metadata so repeated runs recognize the conflict rather than reporting an old replay as a new save.
- Unchanged material does not generate another save. A verified later original-byte check may update provenance. Recent relay contact alone does not assert portal freshness; legacy files without byte-check timestamps remain explicitly unknown.

## Bounds and tutor behavior

The dedicated endpoint accepts bounded POST JSON, rejects cross-origin browser requests and requires the scoped credential. It cannot read full source text, list unrelated courses, write learning/progress, access other owners, or use the general Bridge API. It returns only selected-course metadata and matching material receipts. Authenticated calls are capped at 1,200 per UTC day per owner. The publisher refuses redirects carrying credentials.

The library supports 500 material records, retains the 10 MB active-workspace and 20 MB receipt ceilings, and fetches all material-list pages before presenting the library. The relay limits each canonical write packet below 295 KB. Imports do not activate paid AI or change existing free-tier caps. These bounds are not a multi-student capacity benchmark.

Notes can filter by course and display extraction/source-check timestamps. The tutor and AI connector read the same versioned material records. Existing continuation checks flag changed or missing Bridge revisions and require refreshed excerpts; they cannot prove an upstream portal is current. Importing files does not assess learning or mark coursework complete.

## Verification and recovery

Run `node --test test/material-relay.test.mjs` and `python3 test/material-relay-python.py`. The real workerd/SQLite test covers invalid credentials, owner/course isolation, demo denial, hash checks, exact replay, receipts, revision updates, manual edit protection, pagination beyond 100 records and revocation. Fictional local files cover extraction gating, paths, hashes, layout normalization and lost-response recovery. The full `npm run check` includes both suites.

If authorization is revoked or expires, stop automatic retries and reconnect through the website when desired. If a pending save exists, preserve its state; do not blindly delete it or generate a replacement operation. No public student launch, source crawling, automatic removals, provider permission expansion or personal Bridge modification is part of this relay.
