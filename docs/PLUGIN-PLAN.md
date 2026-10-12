# School Bridge plugins: purpose, limits and rollout

Copyright 2026 Daksh Breja. All rights reserved.

Research date: October 12, 2026. This is a fresh community-project design, not an import of the owner's personal GPTs or information.

## What OpenAI currently says

OpenAI describes a custom-GPT transition to plugins. Instructions and knowledge files can become packaged skills/references, but custom actions need replacements. The selected model and sharing arrangements require review. Availability and timing depend on the account notice; the FAQ currently lists December 11, 2026 as standard retirement, with an approved Enterprise deferral exception. We have not checked this owner's migration eligibility. [Official migration FAQ](https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq)

A plugin can package reusable workflows and optional server tools. The current portable format uses a root `plugin.json`, skills in `skills/`, and optional MCP configuration. This repository now includes an instruction-only draft under `plugins/school-bridge-community`; it has no tools or hooks. [OpenAI packaging guide](https://developers.openai.com/plugins/build/plugins)

## Does it make operations more efficient?

Our expected benefit is less repeated explanation and more consistent sequencing: the same onboarding/recovery instructions can accompany the relevant task. This is a design inference, not a measured speed or cost improvement. A plugin does not make school data appear, replace authentication, guarantee skill selection or make an uncertain save successful.

| Measure | What we will compare before claiming an improvement |
|---|---|
| User effort | Clarification turns and manual steps for equivalent tasks. |
| Quality | Correctness, complete outputs and truthful source/save status. |
| Reliability | Duplicates, unconfirmed saves and wrong-account attempts. |
| Speed | End-to-end time, including authentication and source retrieval. |
| Cost | Actual model/tool usage and applicable credits or API spend. |

The instruction package has not been installed, invoked in a host or benchmarked. Local package checks establish structure and scope, not model adherence or runtime acceptance. No efficiency savings are claimed yet.

## What is incorporated now

- A proprietary portable manifest with an onboarding entry point.
- A narrowly triggered manual-workspace onboarding skill.
- A save-recovery skill that directs users to the existing receipt-first UI.
- A scope audit that rejects unexpected packaged files, linked files, live tool declarations or automatic hooks for this initial release.

All instructions were written from the community project's existing contract. No GPT definitions, conversations, owner credentials or student materials were read or copied. There are no school/provider connections, no API keys and no automatic collection. The original website remains usable independently of plugins.

## Later: authenticated tools, not a second data store

The intended design is a plugin as another client of the community backend. The backend remains authoritative for ownership, revisions, receipts, exports and deletion. A future MCP adapter must derive identity from a verified delegated sign-in, not a user-provided student ID. It must preserve stale-account guards, bounded reads and exact idempotent retries.

Cloudflare Access browser assertions must not be assumed to exist in a ChatGPT/MCP session. That adapter needs a separately reviewed supported authorization flow and negative tests for wrong issuer/audience, stale identity, token revocation and wrong-account access. No MCP endpoint, OAuth client or authorization permission is provisioned by this draft. Plugin installation alone must not imply a connected source.

Start with authorized read-only workspace status after private sign-in is established. Add saves only once operation IDs, expected revisions and receipt reconciliation work across clients. Export/deletion must remain explicit user actions with the existing confirmation and revision requirements. Never package student content as shared plugin knowledge. Source-backed tutoring is a subsequent milestone with permitted retrieval and evaluation, not a capability of the instruction-only draft.

## Acceptance before installation, wider sharing or replacement

1. Confirm the owner's available plugin surface and private-install method; then review the exact package and permissions. Do not enable it automatically through repository configuration.
2. Test skill choice in a fresh conversation and a continuing conversation. Compare the same prompts with the existing manual flow.
3. Exercise an empty workspace, an unconnected URL, an uncertain save after reload, an identity change, deletion, lost browser storage, and instructions embedded in supplied notes. The assistant must stay honest and must not treat source text as authority to expand access.
4. For any later live tools, repeat adversarial A/B and retry tests against the actual authenticated endpoint, including revocation. A package audit is not an isolation test.
5. Measure user effort, quality, speed and cost before claiming efficiency or replacing any previous workflow. Retain a usable website path while plugin access varies by account.

See [PRIVATE-SIGNIN.md](PRIVATE-SIGNIN.md) for the current owner setup, [SECURITY.md](SECURITY.md) for privacy, and [ARCHITECTURE.md](ARCHITECTURE.md#pilot-release-gates) for remaining release gates.
