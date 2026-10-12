# Private sign-in: owner test

Copyright 2026 Daksh Breja. All rights reserved.

The owner approved a separate private test deployment on October 12. Its built-in HTTPS address is enabled behind an exact owner-email allow rule covering all Worker traffic. Real browser admission, independent backend identity validation, synthetic profile/course/material saves, receipt confirmation and reload/readback have passed. School connections remain unconfigured. Local demos use fake students and disposable information.

## What we are building

Think of sign-in as a locked front door. Cloudflare Access decides who may enter, and School Bridge independently checks the signed proof of who entered. Each approved person then gets their own workspace.

The coding environment's **Only me** setting protects that environment. It does not automatically protect a hosted School Bridge website.

Signing in will not connect Google Calendar or eLC. Those require separate permission and connector work later. The personal Bridge remains a separate project; its keys, accounts and settings must not be copied.

## What you handle, and what I handle

| You, the owner | Development work |
|---|---|
| Confirm which Cloudflare account will hold the community project. | Explain the setup and prepare changes for review. |
| Choose a separate hostname and which operator-controlled test accounts may enter. | Check the intended routing and identity settings before hosting changes. |
| Configure the new Access application and keep new secrets in the hosting secret store. | Validate configuration without reading or printing secret values. |
| Approve a separately scoped hosting/access change when its exact setup is ready. | Run deployment checks only within that approved scope. |
| Complete test sign-ins and decide who can join a later pilot. | Exercise isolation, account changes and removal of access; record actual results. |

No account password, identity token or secret should be pasted into chat, an issue or a committed file. Account readiness, intended hostname and intended test-account count can be discussed without sharing credentials.

## First: decisions we need

- [x] The local official CLI and dashboard confirmed the intended account. A new community-only secret is installed; the separate cloud coding environment remains without provider secrets.
- [x] Enable only the dedicated community Worker built-in HTTPS address after exact-owner access protection; no custom domain purchase needed.
- [ ] Name the project operator and who can administer hosting, identity and stored data.
- [x] Initial allowlist contains only the approved owner email. A second controlled account requires a separately reviewed addition; use synthetic course information.
- [ ] The test application session is 24 hours. Actual expiry and revocation timing still need hosted verification.
- [x] A new secret is stored in Cloudflare with an owner-readable local recovery copy outside Git. A recovery drill remains pending.

These choices prepare the next scoped setup. This guide does not grant access, create a hostname, change a provider account or authorize real-student admission.

## The future setup, in plain English

1. Create a new Cloudflare Access application for the dedicated hostname. Protect the whole hostname, including the app pages and `/api/*`, rather than just the homepage.
2. Allow only the agreed test accounts. Avoid broad rules that admit everyone or anyone with a school-looking email address. A sign-in does not prove enrollment.
3. Give this app its own trusted sign-in settings and a new workspace-addressing secret. The existing example settings are deliberately blank so the app refuses access until configured.
4. Review the exact hostname, Worker routing, storage and access policy before any hosting change. The supplied project disables public development/preview URLs; the loopback demo must stay a local simulation.
5. Once a separately protected test deployment is authorized and ready, perform the checks below with synthetic content. Passing local or GitHub tests does not prove this hosted setup works.

Cloudflare's labels can change. Its [Access application documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/) explains the hosting-side setup; the developer settings below describe what this repository expects.

## No owned domain: the built-in private test path

Cloudflare documents Access protection for a single Worker's production and preview addresses. Its built-in address does not require an owned custom domain. That address is public when merely enabled, so Access protection must be configured and verified before it is used for this project. [Official Worker Access guidance](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

The reviewed sequence is: prepare the new community Worker with URL routing disabled, apply a dedicated Worker-level Access policy covering **All traffic**, restrict it to the agreed operator-controlled testers, supply the new community settings securely, then enable only the protected test address and verify signed-out/unauthorized requests. Keep preview routes disabled unless separately included and tested. Do not use an account-wide policy or change any personal Worker's settings. New Worker-level Access identity behavior must still be checked against this project's signed-assertion verifier in the actual hosted tests.

This sequence was applied after explicit owner approval. The repository defaults remain `workers_dev: false` and `preview_urls: false`. A separate protected local owner-test configuration enables only the approved address and supplies the new issuer/audience. Never deploy the default blank configuration over a working hosted test; it deliberately disables routing and fails authentication closed.

The existing Zero Trust team was used without changing its issuer or other applications. Only the separate community Access application was configured.

## What we must prove before a real student pilot

| Test | What success means |
|---|---|
| Signed out | Pages and protected data require sign-in; no alternate public route exposes the app. |
| Allowed test account | Sign-in works through the new Access application and starts with an empty workspace. |
| Unapproved account | Access is denied. A supplied email or invented identity cannot select a workspace. |
| Two separate accounts | Each sees only its own synthetic courses, materials, calendars, receipts and export. |
| Change account while loading/saving | Old responses do not overwrite the new screen; uncertain saves stay with the original account. |
| Remove access | The removed account loses access within the documented deadline, including an already-open browser and outstanding saves. |
| Reconnect and retry | A missing response is reconciled with its receipt; the same save is not applied twice. |
| Delete | Active data and prior receipts disappear, the identity stays retired, local pending data is cleaned when that browser reconciles, and the other account is unchanged. |

Record only results, dates and anonymized labels such as Test A/Test B. Keep tokens, cookies, private provider settings and screenshots containing real account information out of Git and CI artifacts.

Removing an allowlist rule may not immediately invalidate a previously issued session. This Worker checks signed tokens and their expiry; it does not ask the provider whether a user has just been removed on every request. Session revocation, expiry, alternate routes and the maximum removal delay must be tested against the actual Access setup. Local tests cannot establish immediate provider revocation.

Real sign-in alone is insufficient for admitting students. Consent and retention terms, provider authorization, recovery drills, rate/cost controls and source-backed teaching remain in [ARCHITECTURE.md](ARCHITECTURE.md#pilot-release-gates).

## Developer settings and evidence limits

| Setting | Meaning and required format |
|---|---|
| `ACCESS_ISSUER` | The exact new Access team issuer: HTTPS on a supported `cloudflareaccess.com` hostname, with no trailing slash, path, credentials or port. |
| `ACCESS_AUDIENCE` | The application audience copied from the new Access application, not an arbitrary account ID; the verifier accepts a single configured string. |
| `TENANT_ID_KEY` | A new random 32-byte key encoded as canonical unpadded base64url. Store and back it up securely; never reuse the personal project's key. |

Changing the workspace-addressing key or the identity issuer changes where accounts are stored. This requires a tested migration, not a casual settings edit. A display email change alone should not move the workspace: ownership follows the signed subject. Changing the application audience must still reject tokens for the previous/wrong application; an audience value is not an ownership selector.

The current verification accepts signed human-user application assertions, rejects service identities and caller-selected owners, and fails closed for incomplete configuration. It caches public signing keys, not authenticated users or student data. This is access control, not user-held end-to-end encryption.

The cloud environment currently has no provider secrets or outbound provider identity. A real Access test needs the new application, approved hostname/routing, dedicated settings, operator-controlled test sign-ins and permitted access to that team's public signing-key endpoint. Any missing setup must be resolved through the intended configuration workflow; personal credentials are not a substitute.

Run `npm run check` for synthetic identity, storage and privacy contracts, and `npm run test:browser` for rendered synthetic behavior. Neither command configures or proves real Access admission, enrollment or provider revocation. See [STATUS.md](STATUS.md) for completed evidence.

`npm run check:signin` is a format-only preflight for an execution environment that intentionally supplies the three settings. It reports missing setting names, never their values, and makes no network requests. An empty foundation is expected to fail this check. Hosting-only Worker secrets are not automatically readable by this CLI; do not copy a secret into chat or CI to make it pass. Even a successful result leaves identity, hostname, Access policy and revocation verification explicitly false until actual hosted checks are performed.

## Approved owner hosting, October 12

The community Worker was first uploaded unrouted. After explicit approval, its dedicated Access application was created and restricted to the exact owner email before enabling the test address. Readback confirmed All traffic protection and one owner-only Allow policy. Preview URLs remain disabled. No personal service, credential, collector or school source was changed.

A new 256-bit workspace-addressing secret is stored in Cloudflare; its local recovery file is mode 0600 inside a mode 0700 directory outside the repository. Issuer/audience and routing live in a separate mode-0600 owner-test configuration. They are not copied into CI or the cloud coding environment. The owner controls hosting and recovery.

The live check uncovered two gaps absent from the original synthetic fixtures: deployment-introduced browser helper code and an Access assertion missing the optional JOSE `typ` header. The first is repaired and now guarded by an actual Wrangler artifact check and rendered CI. The second is repaired while retaining RS256 signature, pinned issuer/audience, expiry, required application payload type and human identity checks. Owner login, synthetic profile/course/material saves, receipt confirmation and reload/readback passed on the live host. Opt-in category-only diagnostics were disabled after the check. A second real account, unauthorized-account login, revocation/expiry, restore and deletion drills remain unverified. See [STATUS.md](STATUS.md).
