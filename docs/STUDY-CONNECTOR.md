# Shared study connector — private local checkpoint

Copyright 2026 Daksh Breja. All rights reserved.

October 13, 2026: the first implementation reuses StudentStore, signed workspace identity, operation receipts, revisions, export and deletion. No provider model calls or personal data are required to test it. This is a local protocol/storage preview, **not a connected Claude, ChatGPT or Gemini integration**.

## Implemented

The seven tools list courses, list course material metadata, read versioned passages (2,000 characters per page), read saved course deadlines, resume a checkpoint, save a checkpoint, and recover its receipt. Tool arguments have no owner selector. Reads retain pagination and coverage limits. Material text is untrusted reference content; an assistant must not follow instructions embedded in it. No profile, calendar credential, arbitrary backend operation, coursework completion write, export or account deletion is exposed as a connector tool.

Checkpoints include course/session identity, topic, question, actual learner response, assistance, rubric criteria with response quotes, versioned source references, a next step, and an immutable test-only flag. The server attaches the exact saved source text and rejects stale versions, wrong-course materials and quotes absent from the response. It derives a conservative outcome from the reported criteria. These checks validate record structure and provenance, **not the truth of an AI judgment**. All assessments remain `assistant_report_unverified`, with mastery false; they never increment existing practice or coursework progress counts. Empty answers and absent evidence remain unassessed. Partial criteria remain partial. Semantically wrong but structurally valid judgments still require model evaluation.

The Tutor page reads the same checkpoint and displays its response, feedback and next step. The hosted-tutor prompt can include a newer non-test checkpoint when its source versions are among the selected passages. Older checkpoints, test checkpoints and mismatched source versions are excluded. This context wiring is covered with synthetic tests; real-model continuation from an external assistant has not been evaluated. The website still generates multiple-choice practice and does not implement an automatic written-response grader.

The existing transaction saves checkpoint, receipt and account revision together. Exact retries recover the original result even after a source changes. Changed packets with the same ID conflict; stale revisions fail. A process restart preserves the checkpoint. Account deletion removes current records and historical receipts. Checkpoint snapshots remain accessible in account exports until deletion, as do existing record histories.

## Local interfaces

- `GET /api/study?course_id=...&session_id=...` (session optional): resume through the normal authenticated website boundary.
- `PUT /api/study`: the same save contract as the connector, with `operation_id` and `expected_revision`.
- `POST /api/study-connector-preview`: JSON-RPC adapter for `initialize`, `ping`, `tools/list` and `tools/call`. Requires `STUDY_CONNECTOR_PREVIEW=true`, a verified Access assertion, exact `X-Workspace-Id`, existing origin protections, and a body no larger than 40 KB. Disabled by default and not enabled on the hosted site.
- No public `/mcp` route, OAuth client or live plugin configuration is created. Existing installed instruction-only plugin stays unchanged. The preview advertises MCP protocol `2025-06-18`; it is not a complete remote Streamable HTTP authorization/transport implementation.

Run `DEMO_STUDY=1 DEMO_PORT=8773 node scripts/demo.mjs`, then open the local `/tutor` page. The disposable demo seeds two synthetic accounts and saves a partial-reasoning checkpoint for A through the protocol. B stays separate. It uses no real AI or external school sources. Run `node --test test/study-connector.test.mjs` for the connector contracts, actual workerd/SQLite restart and two-identity isolation checks.

## Next: supported remote authorization and a real host test

Keep the current all-traffic Access protection on the website. A remote AI client does not inherit the user's browser Access cookie. Prepare a separately authenticated MCP route/service with supported OAuth 2.1, PKCE and resource discovery; use an established authorization implementation. The website login must establish an explicit per-user connector grant, rather than trusting a supplied email or school ID. Grant only study reads and separately consented study saves. Enforce token issuer, audience, expiry, client/grant ownership and scopes on every request, with bounded revocation and account-deletion behavior. Do not create a shared provider credential or pass browser identity tokens through to AI clients.

Before enabling that route, review the concrete hostname, grant screen, scope, storage and routing changes. Then prove two controlled identities, revocation, wrong audience/issuer, stale grant, lost response, source change and account deletion through the actual host. Only after that should the plugin package advertise a live connection. The protected website and personal Bridge should retain their existing configuration.

References: [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
