# Local and cloud development handoff

Updated October 12, 2026. Copyright 2026 Daksh Breja. All rights reserved.

The owner requested this existing local chat to handle Mac/browser setup while retaining the cloud chat for cloud development. Both work on the same private community repository, with separate Git branches. Neither is the personal School Bridge.

| Role | Chat and branch |
|---|---|
| Local Mac and signed-in browser setup | [Audit School Bridge readiness](codex://threads/01a127fb-eadc-70b1-a69b-efcd27e7f3a5), `codex/local-community-20261012` |
| Cloud development and Linux checks | [Continue the School Bridge Community foundation in the sele…](https://chatgpt.com/local/01a12ecc-b450-7532-914b-3a763fecc0d0), latest reviewed branch `codex/plugin-foundation-20261012` |

The local branch starts at cloud commit `1dc5d248d1654a6fd47c2736dfb42f1feadfbd92`, incorporating recovery PR #1, private sign-in preparation PR #2 and plugin PR #3. All three PRs remain open and unmerged. Local work must push its own branch, never overwrite a cloud branch or implicitly merge into main. Fetch and review new commits before transferring later changes. Credentials, browser sessions and runtime data do not travel between these environments through Git.

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

## Next hosted step

Follow PRIVATE-SIGNIN.md to prepare a separate community Worker and dedicated whole-app Access policy. Before making the hosted change, review the exact Worker/address, operator-only allowlist, session duration and dedicated secret handling. Existing account-wide policies and personal applications remain outside the change. Real sign-in, revocation, source connectors and pilot admission are still outstanding; local success does not establish them.
