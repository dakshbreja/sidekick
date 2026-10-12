# Standalone academic workspace

Copyright 2026 Daksh Breja. All rights reserved.

Accepted product direction, October 12, 2026. This plan tracks the full community product; completing the first stage does not complete the product or authorize general student admission.

The website and each student's private, durable record are the center. Codex is development tooling. Students can use the website without purchasing ChatGPT, Claude, Codex, or a recording subscription. Optional clients use the same scoped service contracts. Original school sources remain authoritative; every imported or collected item needs provenance, coverage and freshness.

## Delivery and acceptance

| Stage | Work and required evidence | Current state |
|---|---|---|
| Academic profile and imports | Minimal profile, optional school information/goals/preferences, notes/transcript text import, readable saved materials, two-student isolation and exact save recovery. | Implemented locally; synthetic verification only. |
| Private hosted identity | Dedicated community Worker and storage; Access covers every route; initially owner-only; signed-out, allowed, denied, expiry/revocation and two independent account tests. | Prepared, not deployed. Local hosting account connection confirmed. |
| First live source | Separate community Google OAuth registration; consent for selected calendars with minimum read scope, tenant-bound state/PKCE, encrypted credentials, refresh/revoke/disconnect, scheduled incremental collection, deduplication, retries and visible freshness. | Not implemented. No personal Bridge credentials may be reused. |
| Useful daily workspace | Calendar, explicitly sourced assignments and announcements, exact assignment/term/occurrence progress, source-change conflict handling and a daily briefing. Completion must follow an explicit report or original submission proof. | Calendar imports and progress API exist; live daily briefing and progress UI remain. |
| Website tutor | Bounded service-funded AI, source citations, selected-course retrieval, prompt-injection handling, independent answer assessment, durable learning handoffs and fresh-session resume. Per-student and global quotas, concurrency limits and outage behavior before activation. | Evidence-storage contracts exist. No model provider or spending authorization configured. |
| Optional external clients | Authenticated remote MCP with individually revocable delegated grants; initial read-only workspace/course/material tools; explicit writes through the same revision/receipt contracts. ChatGPT and Claude host tests, including actual free-account eligibility. | Instruction-only OpenAI plugin exists. No live MCP server or Claude connection. |
| Student pilot and expansion | Named small UGA pilot, published data/retention/support terms, tested restore and key recovery, deletion coverage, cost/fault/load evidence, connector support matrix and support ownership. Test one additional institution before broader rollout. | Not ready for student admission. |

## Profile and memory contract

- Display name and time zone are editable. Login email comes only from the verified sign-in assertion; it is not an ownership key or an editable profile field.
- Institution and school email are optional self-reports. They do not prove enrollment, authorize school access or select a tenant. Do not collect a numeric student ID until a supported integration specifically requires it.
- Study goals and learning preferences are optional, editable and exportable. Clearing them removes current values; historical save receipts retain original payloads until account deletion under the existing recovery contract. The interface must explain this retention before real-student admission.
- Learning evidence is separate from preferences. Incorrect, partial, assisted, reported and observed independent answers remain distinct. Do not infer understanding from friendliness, time spent, a saved note or a stated preference.
- No universal chat-history access. Import only the notes or handoffs a student explicitly chooses. Never imply that the service has read a student's other conversations.

## Optional tools and cost

Text notes and transcript exports are the first vendor-neutral input, with literal text preview and course/source labels. A note-taking or recording subscription is not required. Audio/video transcription and vendor-specific recording adapters are separate features requiring supported interfaces and consent.

ChatGPT and Claude are clients of the future authenticated service, not required background workers. A ChatGPT subscription does not fund website API usage: API billing is separate. [Official OpenAI pricing](https://learn.chatgpt.com/docs/pricing). Custom MCP access depends on host permissions and security settings; do not promise a working free-account integration before testing it. [OpenAI custom MCP guidance](https://developers.openai.com/api/docs/guides/custom-mcp-server). Claude currently documents one custom remote connector on its Free plan, with connections originating from its cloud. [Claude connector documentation](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Before enabling website AI, choose a provider, an operator-funded budget and explicit per-student/global ceilings. Reserve usage atomically before an outbound call; cap context, output, concurrency and retries; handle ambiguous provider failures without unbounded repeated charges. Show students availability and remaining allowance. No promise of unlimited free AI.

## Service boundaries

The current Access login is suitable for a small controlled website pilot. Remote MCP needs its own OAuth-compatible authorization surface, with resource/audience binding and revocable scopes; a browser Access cookie is not a ChatGPT/Claude integration. Keep the internal student-store service unreachable by arbitrary clients, and derive every student address server-side. Never accept a client-supplied tenant selector.

Background collection belongs to deployed infrastructure, with per-student scheduling, durable retries, provider-aware rate limits, revocation and failure reporting. A running Codex chat, developer Mac, browser profile or personal collector cannot become a student-service dependency.

The product uses access-controlled service storage. End-to-end encryption is not implemented; server-side tutoring must be able to process explicitly selected content. Any later encryption promise needs a concrete key-management and computation design.

## Local and cloud development

Use the local branch for Mac/provider setup and locally verified changes. Preserve the existing cloud chat and its review branch. Share reviewed code through the private repository and dependent draft PRs; do not overwrite another branch or treat CI success as live-provider evidence. See [LOCAL-CLOUD-HANDOFF.md](LOCAL-CLOUD-HANDOFF.md) and [PRIVATE-SIGNIN.md](PRIVATE-SIGNIN.md).
