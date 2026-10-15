# Sidekick: personal day and collection path

Working product name chosen by the owner: **Sidekick**, a friendly study companion. This is a product label, not a trademark-clearance claim. Existing deployment names, OAuth clients and plugin identifiers stay stable.

## Available now

The authenticated dashboard greets the student by their chosen name. Their own deadlines, reported progress, exam-preparation window and saved non-test study checkpoints produce a small, explainable plan. Overdue work and deadlines within one day take priority, then explicitly classified exams inside the chosen preparation window, then nearest deadlines. Students can select a 10–90 minute study session, 1–30 day preparation window and optional score target. A score target is the student's goal, not a prediction or inference from grades. Completing a requirement through the existing reported-submission flow removes it from recommendations. Calendar entries without an explicit deadline classification are not silently made into assignments or exams.

A reviewable study handoff includes selected goals/preferences and the exact course ID. It tells the connected assistant to resume normal learning, refresh changed source versions, stop on unavailable access/material, preserve assistance and check reasoning. Copying remains manual; the dashboard does not secretly call another assistant or inspect its chat history. The in-site tutor's existing source/practice behavior is unchanged; profile preferences are included in the reviewed handoff, not silently added to an existing provider consent. No new inference calls or paid fallback were added.

`/demo` is a read-only fictional John Doe day, clearly dated October 14, with a Physics II exam, a design project in progress and an 85% chosen goal. Rendering it does not seed or change the signed-in workspace. The fictional handoff explicitly prohibits real Bridge reads/writes. Simulation checkpoints do not influence normal dashboard recommendations.

Source status uses actual successful-feed timestamps and warns about stale or unsuccessful sources. Matching Bridge material versions does not establish freshness in the original portal. No claim is made about a rubric comparison, whole-portal sweep, hidden chat access, independent mastery or actual time since the student's last visit.

## Getting eLC data without Codex on every student's computer

1. **Feed-first pilot:** UGA documents [external calendar subscriptions](https://help.elc.uga.edu/course-tools/calendar/). The existing bounded cloud collector can retrieve an explicitly connected supported feed while the student's computer is closed. Calendar and announcement feed adapters only cover published feed entries; they do not supply all materials, grades, quizzes or submission receipts. The community adapters have synthetic tests, but this milestone did not connect or verify a real UGA feed. Students add permitted course materials manually for now.
2. **Institution-supported OAuth:** Brightspace has an [OAuth authorization-code API](https://docs.valence.desire2learn.com/basic/oauth2.html). Registering/managing applications needs the institution's [Manage API Applications permission](https://community.d2l.com/brightspace/kb/articles/27522-manage-extensibility-permissions). A student's ID/email alone does not provide this. Request an approved scoped integration before implementing full LMS collection. No university request has been sent and no institutional access is claimed.
3. **Optional browser helper:** If institutional integration is unavailable, a narrowly scoped helper could collect approved course pages while the student's authenticated browser is running. This is a future design, not an installed extension. It should use explicit course/page consent, redact unrelated information and never export passwords or session cookies. It cannot promise collection while the laptop is closed or silently bypass SSO/MFA. Whole-computer control and a Codex subscription should not be onboarding requirements.

The cloud feed route is the practical first path; university OAuth is the reliable wider-coverage path. Existing free-tier budgets remain hard caps. No promise of unlimited free hosting or inference at public scale is made. Two operator accounts remain the release boundary until the existing readiness gates are met.

## Verification boundary

Synthetic checks cover prioritization, stale/empty feed wording, reported submission removal, larger preparation windows, validation, legacy save replay and signed-owner separation through real workerd/SQLite. Browser checks cover the rendered hosted fictional page, prepared handoff and real dashboard/profile navigation. No real coursework, collector, provider grant or personal Bridge record is changed by this milestone.
