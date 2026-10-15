# Near-term private release

Copyright 2026 Daksh Breja. All rights reserved.

The owner's chosen sequence is **the existing two operator accounts first, then a few specifically invited users**. There is no public signup or permission to invite students yet. The private operator service, Google connection and scoped Claude path already exist; do not recreate them. Current evidence is at the top of STATUS.md.

## What this release includes

The existing website provides separate academic profiles, courses, notes/materials, calendar imports and consented source views, a daily view, private source-grounded study continuation, scoped Claude checkpoints and explicit save recovery/export/deletion. Existing website inference must stay free-only and fail when its free-tier guard or quota does not permit it. The plugin remains instruction-only. This release does not promise every personal Bridge feature or universal school/provider support.

Real eLC onboarding still needs the user's consent and signed-in provider check locally. Other providers' manual handoffs are not account linking. No additional connector, paid model, automatic personal collection or new secret access is needed for this code review.

## Finish the operator release first

1. Fetch `codex/cloud-pilot-smoke-20261014` and review draft PR #6 against the local branch. Preserve newer local work and all earlier PRs. This continuation is tests/docs only; it does not itself require a production deployment.
2. Use the latest reviewed local product head, not an older cloud calendar branch. Confirm the installed private Worker/connector versions against that reviewed head. If an actual product update is needed, build/deploy only through the existing protected local configuration; repository defaults intentionally omit live settings. Never change account-wide protection or personal Workers.
3. Keep Access on all traffic with exactly the two existing operator accounts. Confirm denied sign-in from an unapproved identity and check session expiry/removal behavior. Test with disposable records, not personal schoolwork.
4. Exercise the actual operator journey: separate sign-in, notes/course save, reload/readback, source status, recent calendar checks, source-limited study feedback, checkpoint receipt and fresh-chat resume. Check response-loss recovery, export and deletion on a disposable identity; deletion permanently retires it, so do not delete an account containing wanted records.
5. Record the exact version, check outcomes and unresolved limits outside Git if they contain identity/source information. Link a sanitized summary in STATUS.md. Keep Google/Claude grants scoped; revoke temporary test access afterward.

Cloud has no Cloudflare identity, deployment credentials, protected configuration or signed-in local browser. It can prepare and test code while the laptop is closed. Final hosting readback, any reviewed deployment and signed-in provider checks must run through the existing local setup when it is available. Do not copy credentials into chat/cloud just to bypass this boundary.

## Before the first invited users

Use PILOT-CHECKLIST.md to close the remaining gates with actual evidence. In particular:

- Establish the independent deletion/revocation record and protected restore procedure. The local negative-control drill proves an old backup can resurrect deleted content. Reopening a restored service without reconciling later deletions is unsafe.
- Set and publish actual retention, backup/log/support and consent terms, including historical receipts, browser remnants, external assistant copies and OAuth KV. Draft text is not an implemented retention schedule.
- Verify the hosted two-owner failure/recovery and denied/expired access cases; measure the intended small cohort's usage against free quotas, with graceful outages and no paid fallback.
- Review provider admission/verification rules and consent for each live source. eLC remains local/user-dependent; the operator Google test does not automatically admit other Google users.
- Choose the named small cohort, support contact and stop criteria. Review those concrete settings with the owner before adding exact individual email addresses to this app's allowlist. Do not use a whole-domain or Everyone rule.

Each invited person gets their own verified identity and initially empty workspace. They approve their own sources and selected-course assistant grants. Do not clone an operator workspace, share tokens or seed personal materials. Confirm each fresh workspace is empty and cannot read another person's fixture before entering real coursework. Expand only after that first small pilot has evidence.

A near-term operator checkpoint is distinct from finishing the full product. Schedule the first student invitations from the remaining evidence and provider prerequisites rather than promising a date those dependencies may prevent.
