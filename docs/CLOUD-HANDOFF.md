# Codex cloud handoff

## Intended location and boundary

Continue development of this clean community repository in a private Codex cloud environment. The personal School Bridge remains separate. This file is the handoff; it does not claim a cloud task or deployment exists.

The private [GitHub repository](https://github.com/dakshbreja/school-bridge-community) is published, and its initial GitHub Actions Linux validation passed. Connect only this repository to a new private cloud environment. The Codex cloud repository picker currently requires the owner's separate GitHub App repository authorization; a cloud task has not been launched. Do not attach personal source repositories, existing account sessions or production secrets.

## Environment setup

- Node.js 24 or newer on Linux, with npm.
- Install: `npm ci --ignore-scripts`.
- Verify: `npm run check`.
- Network: package registries for setup; no real school/provider connection is needed for the synthetic checks.
- Secrets: none for this milestone. Tests generate disposable signing keys and intercept the synthetic identity-provider endpoint.
- No deployment script. `npm run build` performs a Wrangler dry run only.

Local macOS validation is recorded in STATUS.md. Repeat the complete checks on the cloud Linux image before treating the environment as ready. Workerd must be able to start local subprocesses and listen on loopback for its test harness. Record the actual cloud test result separately.

OpenAI's current [Codex cloud guide](https://learn.chatgpt.com/docs/cloud) describes creating an environment from GitHub repositories, reviewing setup, publishing it, and then starting a task. [Cloud environment configuration](https://learn.chatgpt.com/docs/environments/cloud-environments) controls environment access and dependencies. The local app handoff tool cannot move this existing task to a cloud host; start a scoped new cloud task once the repository/environment is available.

## Initial cloud task prompt

Continue the School Bridge Community foundation in this repository. Read AGENTS.md, README.md, docs/STATUS.md, docs/ARCHITECTURE.md and docs/SECURITY.md first. Preserve the proprietary copyright and empty-by-default student workspaces. This is separate from the owner's personal Bridge; do not seek or copy its private data, credentials, GPTs or deployed configuration.

First reproduce `npm ci --ignore-scripts` and `npm run check` in this cloud environment. Fix environment portability issues, then complete the browser onboarding checks that the local Chrome restriction prevented. Use only generated synthetic identities and disposable records. Verify student A/B separation, course and material saves, source status honesty, calendar replacement, receipt retries, export and deletion. Report the actual results; do not infer browser success from API tests.

Next implement a persistent, account-scoped browser recovery outbox with explicit receipt reconciliation after reload or reconnect, preserving the existing no-duplicate and stale-account protections. Include tests for response loss, browser restart, identity change and deletion. Keep stored client data minimal and document its cleanup and privacy behavior. Return a reviewable diff or draft pull request with test evidence.

Do not deploy publicly, admit real students, grant new provider access, enable automatic collection, or claim that registered URLs are connected. Real Google/eLC authorization, token isolation, provider revocation, recovery drills, rate/cost controls and source-backed teaching remain subsequent milestones in ARCHITECTURE.md. If external access is required, describe the specific missing setup instead of substituting personal credentials.
