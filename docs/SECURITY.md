# Security boundary and deployment checklist

This is a private development foundation. Do not add real students until the pilot gates in STATUS.md have evidence. No public deployment or school-account access is configured.

## Identity and storage

Cloudflare Access must protect the entire deployed hostname. Configure a human-user allowlist, the exact Access issuer, and the application audience. The Worker independently verifies the signed Access application token; forwarded email, request-supplied tenant IDs and arbitrary bearer strings cannot select a workspace. An Access sign-in does not establish university enrollment.

Generate a dedicated random 32-byte base64url TENANT_ID_KEY in the hosting secret store. Preserve it securely: changing this key or the issuer changes workspace addresses. Rotation requires an explicit migration and recovery plan. Never reuse a personal Bridge key. Never commit tokens, real access configuration, .dev.vars or provider credentials.

Each student has a separate SQLite-backed Durable Object, bound to the server-derived identity. Record IDs can coincide across students without sharing content. The public health route checks HTTP availability only. It does not attest to authentication, collection, source freshness or storage recovery.

The service can process plaintext student information. This is not end-to-end encryption. Before a real pilot, publish the actual operator, data uses, hosting region/retention, deletion behavior and incident contact. Apply a retention policy to request logs; do not log student content, tokens or source URLs carrying credentials.

## Data lifecycle

Export includes current workspace records. Account deletion removes active records and prior receipt bodies atomically, retaining the identity tombstone and deletion receipt. This milestone retires the identity rather than reusing it. Hosting-provider recovery copies, including point-in-time recovery, have a separate retention period. Prove and document that policy before claiming complete erasure. Never restore deleted users from a backup without applying deletion records.

The browser retains uncertain save packets in memory until matching acknowledgement and receipt readback. Retry unchanged values in the same page. A page reload does not preserve that pending intent; a durable client recovery interface remains a pilot prerequisite. Server receipts survive a Worker/runtime restart and prevent exact replays from applying twice.

## Connectors

A registered site is metadata only. No source URL is fetched, no credential is accepted, and no automatic integration is active. Future adapters must validate destinations, separate credentials per student, use least-privilege OAuth and protect state/PKCE, encrypt stored refresh credentials under a managed key, support disconnect/revocation, and report reauthorization honestly. Redirect and private-network protections must be tested before any user-supplied URL can cause an outbound request.

## Safe development

`npm run demo` starts a loopback-only, disposable simulation using generated keys and two synthetic identities. Never enter real records into it or expose it through a tunnel. The production entrypoint does not import the demo. Tests intercept outbound requests; no real account is contacted.

Run `npm run check` before committing. The privacy scanner flags credential patterns, personal paths, source references and binary/data exports without printing matched values. An external private reference denylist can supplement the scan; do not commit that list. This is a conservative gate, not a guarantee that arbitrary private prose can be identified automatically.

Report security findings privately to the repository owner. Do not publish student records in an issue or test fixture.
