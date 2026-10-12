# Security boundary and deployment checklist

This is a private development foundation. Do not add real students until the pilot gates in STATUS.md have evidence. No public deployment or school-account access is configured.

## Identity and storage

Cloudflare Access must protect the entire deployed hostname. Configure a human-user allowlist, the exact Access issuer, and the application audience. The Worker independently verifies the signed Access application token; forwarded email, request-supplied tenant IDs and arbitrary bearer strings cannot select a workspace. An Access sign-in does not establish university enrollment.

Generate a dedicated random 32-byte base64url TENANT_ID_KEY in the hosting secret store. Preserve it securely: changing this key or the issuer changes workspace addresses. Rotation requires an explicit migration and recovery plan. Never reuse a personal Bridge key. Never commit tokens, real access configuration, .dev.vars or provider credentials.

Each student has a separate SQLite-backed Durable Object, bound to the server-derived identity. Record IDs can coincide across students without sharing content. The public health route checks HTTP availability only. It does not attest to authentication, collection, source freshness or storage recovery.

The service can process plaintext student information. This is not end-to-end encryption. Before a real pilot, publish the actual operator, data uses, hosting region/retention, deletion behavior and incident contact. Apply a retention policy to request logs; do not log student content, tokens or source URLs carrying credentials.

## Data lifecycle

Export includes current workspace records. Account deletion removes active records and prior receipt bodies atomically, retaining the identity tombstone and deletion receipt. This milestone retires the identity rather than reusing it. Hosting-provider recovery copies, including point-in-time recovery, have a separate retention period. Prove and document that policy before claiming complete erasure. Never restore deleted users from a backup without applying deletion records.

Server receipts survive a Worker/runtime restart and prevent exact replays from applying twice. Browser recovery now persists pending intent; it does not establish disaster recovery or any other pilot gate.

## Browser recovery outbox

Only pending packets are stored in localStorage under `school-bridge-outbox-v1:<verified workspace ID>`. Each entry includes its operation ID, resource ID, expected revision, pending payload, route/method, logical-input digest and a minimal receipt acknowledgement. Pending material text and ICS input may therefore exist in plaintext on disk. No Access assertions, signing keys, cookies, completed workspace cache or provider tokens are stored in the outbox. Browser disk durability and quotas are outside the application's control.

After reload/restart or reconnection, the recovery panel offers an explicit receipt check. No background or automatic retry occurs. The original packet is replayed only after an authenticated, account-guarded `receipt_not_found`; ambiguous errors retain it. Existing acknowledgement hashes and revisions must match readback. Web Locks serialize operations across tabs for the same account, and the server checks workspace guards on receipts, exports and mutations. An identity change hides the prior account's queue without replaying or deleting it; returning to that identity permits recovery.

Matching receipt verification removes the pending packet immediately. Confirmed deletion removes all pending data for the deleted workspace; reload after a lost deletion response can verify its deletion receipt or retired-account export and clean up the outbox. Other accounts' pending packets remain. There is no timed expiry: uncertain operations must be reconciled rather than silently forgotten. At most six packets and 2,000,000 serialized UTF-16 code units are retained per account, subject to browser quota. A storage failure prevents a new request from being sent.

Account scoping protects application behavior, not access by another person using the same browser profile or same-origin script. Use a private browser profile on shared devices. To remove local remnants, reconcile or confirm account deletion first, then clear this site's browser storage. Clearing site data before reconciliation loses client recovery intent; server receipts and active records must be inspected before recreating a save. An account deleted elsewhere is cleaned locally when that profile returns and explicitly reconciles; deletion cannot erase data on an offline device remotely. Browser history, downloads, screenshots and provider backups have separate cleanup behavior.

## Connectors

A registered site is metadata only. No source URL is fetched, no credential is accepted, and no automatic integration is active. Future adapters must validate destinations, separate credentials per student, use least-privilege OAuth and protect state/PKCE, encrypt stored refresh credentials under a managed key, support disconnect/revocation, and report reauthorization honestly. Redirect and private-network protections must be tested before any user-supplied URL can cause an outbound request.

## Safe development

`npm run demo` starts a loopback-only, disposable simulation using generated keys and two synthetic identities. Never enter real records into it or expose it through a tunnel. The production entrypoint does not import the demo. Tests intercept outbound requests; no real account is contacted.

Run `npm run check` before committing. The privacy scanner flags credential patterns, personal paths, source references and binary/data exports without printing matched values. An external private reference denylist can supplement the scan; do not commit that list. This is a conservative gate, not a guarantee that arbitrary private prose can be identified automatically.

Report security findings privately to the repository owner. Do not publish student records in an issue or test fixture.
