# School Bridge Community

A private, empty-by-default foundation for independent student workspaces. Each authenticated student has a separate SQLite Durable Object. A new student can configure courses, register intended sources, add course text and import a calendar without inheriting another student's data.

This is a clean successor with a deliberately smaller scope than the personal School Bridge. It is not a full feature clone. No personal records, credentials, class materials, browser sessions, GPT definitions or cloud bindings were copied. The explicit reusable-code inventory is in [PORTING.md](docs/PORTING.md).

## What works in this foundation

- Server-verified Cloudflare Access identities, with separate student ownership enforced in storage.
- Empty onboarding, arbitrary course/section/term records, and source registration metadata.
- Manual course text and bounded `.ics` calendar imports with explicit import dates and coverage limitations.
- APIs for reported coursework progress and saved learning handoffs. Incorrect, partial and explained answers do not count as independent observed understanding.
- Revision checks, exact-retry save receipts, current-workspace export and account deletion.
- A browser interface for setup, courses, sources, calendar imports, material text, export and deletion.

**Saving a source address does not connect it.** Google Calendar OAuth, eLC authorization, automatic collection, lecture processing, AI teaching, reminders and proactive daily briefings are not enabled. The progress and learning APIs store explicit reports; they do not call a teaching model or read other chats. No cloud deployment or real-student onboarding has been performed for this foundation.

## Local development

Use Node.js 24 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm test
npm run check
```

`npm test` includes isolated contracts and actual local workerd/SQLite integration with synthetic signed identities. `npm run check` also runs the source privacy gate and a Wrangler **dry-run** build. It does not deploy a Worker.

The synthetic loopback demonstration uses:

```sh
npm run demo
```

Open `http://127.0.0.1:8766`. The banner switches between Student A and Student B, each with an empty workspace. The runner generates disposable signing keys, supplies synthetic assertions on the server and keeps tokens out of the browser. Press Ctrl-C to stop it and discard the session's state. Set `DEMO_PORT` to an available port from 1024 through 65535 if needed.

Use only synthetic information. The runner is restricted to loopback with host/origin checks; it is separate from the production Worker and must never be exposed as a shared sign-in service. See [STATUS.md](docs/STATUS.md) for verification evidence.

Rendered browser QA is a separate, explicit command; `npm run check` does not run or imply it. GitHub CI runs both commands and retains synthetic browser evidence for seven days. Install a Chromium executable in the environment, then run:

```sh
BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The harness starts its own disposable `npm run demo` on loopback port 8767, generates a fresh browser profile, and deletes that profile on exit. Set `DEMO_PORT` if the port is occupied. Screenshots, a synthetic export and the browser report go to an external temporary directory; `BROWSER_EVIDENCE_DIR` can select another directory outside the repository. No browser download or real identity is required.

For the unconfigured application shell:

```sh
npm run dev
```

It binds to `127.0.0.1`. Protected API requests deliberately fail closed until authentication is configured. The public health endpoint reports HTTP service availability only; it does not prove sign-in, storage or source collection works.

## Authentication and deployment setup

Real sign-in requires a separately configured Cloudflare Access application and three new community-project values:

| Setting | Purpose |
|---|---|
| `ACCESS_ISSUER` | Exact trusted Access team issuer. |
| `ACCESS_AUDIENCE` | Audience of this application. |
| `TENANT_ID_KEY` | New random 32-byte secret, encoded as unpadded base64url; used to derive stable private student addresses. |

The empty example file `.dev.vars.example` documents these fields. Keep actual values in ignored local configuration or the deployment's secret store. Never reuse the personal Bridge's credentials or destinations. Changing `TENANT_ID_KEY` changes every student address and requires a tested migration; it is not a routine rotation that can be done independently of stored accounts.

No production identity provider, university integration, OAuth application or domain is provisioned by this repository. `workers_dev` and preview URLs are disabled in the supplied configuration. Before a deployment, complete the pilot gates in [ARCHITECTURE.md](docs/ARCHITECTURE.md#pilot-release-gates).

## Data and privacy

Ownership comes from a verified signed subject, not a submitted email or student ID. Every resource, receipt, retry, learning handoff and export stays inside the selected student's store. Connection records accept metadata only; they cannot contain authorization fields, passwords or access tokens.

The service can read stored content. This is **not user-held end-to-end encryption**. Export contains the current workspace; save receipts retain earlier saved versions for exact retries until deletion. Deletion clears active content and old receipts, retires the identity, and retains a minimal tombstone and deletion receipt. Provider recovery copies have separate retention behavior. Read the precise [storage and deletion contract](docs/ARCHITECTURE.md#storage-lifecycle-and-deletion) before using real student data.

The browser persists only unconfirmed save packets in an account-scoped recovery outbox. After reload, browser restart or reconnect, use **Check receipts and recover saves**. It reads stored receipts first and replays the exact original packet only when its receipt is explicitly missing. It never retries automatically. Confirmed saves and deletion remove the corresponding local data. Pending text and ICS contents remain plaintext in that browser profile until reconciliation; account separation is not protection from someone with access to the profile. See [SECURITY.md](docs/SECURITY.md#browser-recovery-outbox) for cleanup and limitations.

## Developer references

- [OpenAI plugin plan and efficiency evidence](docs/PLUGIN-PLAN.md)
- [Private sign-in: owner preparation and verification](docs/PRIVATE-SIGNIN.md)
- [Architecture and release gates](docs/ARCHITECTURE.md)
- [Codex cloud handoff](docs/CLOUD-HANDOFF.md)
- [Current status and evidence limits](docs/STATUS.md)
- [Security boundary and deployment checklist](docs/SECURITY.md)
- [API and data contract](docs/CONTRACT.md)
- [Clean-port inventory and privacy gate](docs/PORTING.md)
- [Repository operating rules](AGENTS.md)

Run `npm run check:privacy` and review the exact Git diff before a commit or push. The scan is a useful gate, not proof that every possible secret or private fact has been recognized.

## Copyright

Copyright 2026 Daksh Breja. All rights reserved. This is proprietary software; no open-source license is granted. See [COPYRIGHT](COPYRIGHT). Dependencies retain their own licenses and notices. This is an independent project; no university endorsement is claimed.
