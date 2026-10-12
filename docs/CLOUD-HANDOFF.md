# Codex cloud handoff

## Intended location and boundary

Continue development of this clean community repository in a private Codex cloud environment. The personal School Bridge remains separate. This file records the cloud development handoff and verification. The student service has not been deployed.

The private [GitHub repository](https://github.com/dakshbreja/school-bridge-community) is published, and its GitHub Actions Linux validation passed. On October 12, the owner completed the separate GitHub App authorization; the repository picker then showed this repository. The published `school-bridge-community` environment contains only this repository, uses Only me access and package-manager network access, and has no secrets. Do not attach personal source repositories, existing account sessions or production secrets.

The [cloud setup task](https://chatgpt.com/local/01a12ec7-f15a-729b-b542-246407ae70d1?hostId=local) installed dependencies with Node 24 and passed all 140 tests, the privacy gate and dry-run build. Synthetic HTTP assets, empty A/B workspaces and fail-closed authentication were checked. Setup left repository files unchanged and explicitly did not establish rendered-browser QA. Its reusable configuration sets `XDG_CONFIG_HOME=/workspace/.config` and `WRANGLER_SEND_METRICS=false`; installation creates the writable configuration directory and runs `npm run check` with `CI=true`.

The [initial cloud development task](https://chatgpt.com/local/01a12ecc-b450-7532-914b-3a763fecc0d0) was launched and confirmed active on the cloud host. It is assigned browser verification and a persistent account-scoped recovery outbox using synthetic data. Its rendered-browser verification and recovery implementation are now complete in the review branch; results are recorded in STATUS.md.

## Environment setup

- Node.js 24 or newer on Linux, with npm.
- Install: `npm ci --ignore-scripts`.
- Verify: `npm run check`.
- Network: package registries for setup; no real school/provider connection is needed for the synthetic checks.
- Secrets: none for this milestone. Tests generate disposable signing keys and intercept the synthetic identity-provider endpoint.
- No deployment script. `npm run build` performs a Wrangler dry run only.
- Writable Wrangler configuration: `XDG_CONFIG_HOME=/workspace/.config`; create that directory before running commands. Set `WRANGLER_SEND_METRICS=false` and `CI=true` for checks.

Local macOS and cloud Linux validation are recorded separately in STATUS.md. Repeat the complete checks when the cloud image or source changes. Workerd must be able to start local subprocesses and listen on loopback for its test harness. Record the actual cloud test result separately.

OpenAI's current [Codex cloud guide](https://learn.chatgpt.com/docs/cloud) describes creating an environment from GitHub repositories, reviewing setup, publishing it, and then starting a task. [Cloud environment configuration](https://learn.chatgpt.com/docs/environments/cloud-environments) controls environment access and dependencies. The scoped cloud task is now running against this repository only.

## Verified cloud startup and browser checks

Honor the environment startup instructions. Wrangler needs writable configuration, telemetry must remain disabled, and npm must retain development and optional dependencies. This task used writable paths outside the repository:

```sh
export XDG_CONFIG_HOME=/workspace/.config
export npm_config_cache=/workspace/work/npm-cache
export CI=true
export WRANGLER_SEND_METRICS=false
mkdir -p "$XDG_CONFIG_HOME" "$npm_config_cache"
npm ci --ignore-scripts
npm run check
```

The first sandboxed install could not reach the configured package proxy and npm could not write its default cache. Retrying with the executor's network capability and writable cache succeeded; proxy settings and TLS verification were preserved. No provider access or credentials were added. If a future image has production npm defaults, use `npm ci --ignore-scripts --include=dev --include=optional`; omitting either dependency group can remove local tooling or the native runtime. Network capability is also needed for loopback subprocesses in the command sandbox. Verify the actual test count rather than treating a file-level runner result as the complete contract suite.

For rendered verification with an installed Chromium:

```sh
BROWSER_EXECUTABLE=/usr/bin/chromium \
  BROWSER_EVIDENCE_DIR=/workspace/work/evidence/browser \
  npm run test:browser
```

The harness starts a disposable `npm run demo` on loopback port 8767 by default, uses generated identities and restarts a fresh synthetic browser profile. Screenshots, export and report stay outside the repository. The harness removes its profile and terminates its demo process group on exit. Chromium 154.0.8037.57 rendered successfully in this cloud task; see STATUS.md for the actual evidence and limits.

## Initial cloud task prompt (historical scope)

Continue the School Bridge Community foundation in this repository. Read AGENTS.md, README.md, docs/STATUS.md, docs/ARCHITECTURE.md and docs/SECURITY.md first. Preserve the proprietary copyright and empty-by-default student workspaces. This is separate from the owner's personal Bridge; do not seek or copy its private data, credentials, GPTs or deployed configuration.

First reproduce `npm ci --ignore-scripts` and `npm run check` in this cloud environment. Fix environment portability issues, then complete the browser onboarding checks that the local Chrome restriction prevented. Use only generated synthetic identities and disposable records. Verify student A/B separation, course and material saves, source status honesty, calendar replacement, receipt retries, export and deletion. Report the actual results; do not infer browser success from API tests.

Next implement a persistent, account-scoped browser recovery outbox with explicit receipt reconciliation after reload or reconnect, preserving the existing no-duplicate and stale-account protections. Include tests for response loss, browser restart, identity change and deletion. Keep stored client data minimal and document its cleanup and privacy behavior. Return a reviewable diff or draft pull request with test evidence.

Do not deploy publicly, admit real students, grant new provider access, enable automatic collection, or claim that registered URLs are connected. Real Google/eLC authorization, token isolation, provider revocation, recovery drills, rate/cost controls and source-backed teaching remain subsequent milestones in ARCHITECTURE.md. If external access is required, describe the specific missing setup instead of substituting personal credentials.
