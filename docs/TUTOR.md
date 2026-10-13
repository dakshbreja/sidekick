# Private website tutor

The community implementation reuses the personal Bridge's evidence distinctions and receipt/revision principles, not its records, credentials or fixed course allowlists. Each student has one durable session per immutable course/section/term identity, in the existing student SQLite object.

## Teaching and memory

Select one to three saved text materials and explicitly consent to Cloudflare AI. A lexical excerpt selector retrieves at most four passages from those materials only, with IDs, revisions, offsets and source labels. No calendar data, profile email, other courses, credentials or other chats are sent. The request includes the student's question, recent exchanges and outstanding question; it does not contain the whole conversation forever. Prior exchanges remain readable in the saved session.

The model teaches one idea and supplies a four-choice practice check. A flat provider schema explicitly requests the teaching explanation, correct answer and three distractors. The server validates source labels, minimum explanation length and four distinct options (including whitespace/case normalization), places the correct answer itself and derives the saved option index. The source hint is the actual selected excerpt attached by the server, not a quotation retyped by the model. This fixes heading-only lessons, answer-index drift and paraphrases misrepresented as exact quotes. Unsupported requests remain terminal failures without changing the session or practice counts. These checks establish structure and provenance, not semantic correctness; the model can still generate an incorrect answer or an ambiguous distractor. Students can inspect the saved source excerpts; the model is fallible. Materials and messages are framed as untrusted data, and the model has no tools or write authority.

Only a submitted option is assessed against the saved key. Wrong answers remain incorrect; hints produce assisted results. A lesson, free-text request, incomplete choice or self-report never adds a successful practice check. Multiple-choice recognition is not a mastery score or an independent free-response assessment. Tutor results appear separately from other explicit learning observations on Learning. The existing coursework/progress records are never modified by tutoring.

Each request has an operation ID and expected session revision. The pending reservation is saved before external inference. Exact replay reads the same outcome and never calls the model again. Saves commit the session, receipt and account revision together. GET operation status and session readback recover a lost response; reopening the course resumes the latest saved question. Concurrent turns are refused. An interrupted turn becomes terminal after two minutes and is not automatically reissued. Account deletion clears tutor tables and fences late replies; changed source revisions also prevent late publication. Exports omit unrevealed answer keys and include sessions and source excerpts. A maximum of 120 saved turns per course, 1,000 operations per workspace and a bounded session-storage total apply in this private preview; reaching the cap stops writes rather than pruning history silently.

## Free-only operation

Provider: Cloudflare Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. This uses the existing community deployment, not a student's ChatGPT subscription or the personal Bridge's credentials. No provider keys are accepted from the browser.

Cloudflare's current [pricing documentation](https://developers.cloudflare.com/workers-ai/platform/pricing/) gives the Workers Free plan 10,000 neurons daily and requires upgrading for paid overage. The operator's Workers Free plan was observed October 13, 2026. Do not upgrade that account or enable paid/unified-billing fallbacks while promising free-only tutoring. Disable tutoring and review the configuration before any account-plan change. Other account workloads can exhaust the shared allowance earlier.

Activation requires `TUTOR_ENABLED=true`, `TUTOR_FREE_TIER_CONFIRMED=true`, an `AI` binding and the existing community budget binding. Repository/default deployments stay off and have no remote AI binding. Synthetic tests use a separate fixture Worker, never the live provider.

Service limits: 10 model attempts per student per UTC day, 12 globally; one in flight per student and two globally; 18,000 UTF-8 bytes of input messages; 1,000 maximum output tokens; 45-second provider timeout. Reservations count even if the provider fails or the response is invalid. There are no automatic inference retries. The anonymous global ledger stores random reservation IDs, day and expiry, not student IDs or content. Durable collection budgets are separate. Saved lessons, answer checks, hints and resume do not call the model.

Cloudflare's [model page](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) documents the current input/output rates and parameters; [data-use policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/) describes provider processing. The public privacy notice describes the selected-content transfer before activation. This preview is access-controlled service storage, not end-to-end encryption.

## Other assistants

The Tutor page prepares a bounded, reviewable study handoff containing selected material excerpts and recent saved exchanges. It sends nothing to another service. A student can manually paste it into their chosen assistant, subject to that provider's limits and privacy terms. It is not OAuth account linking, a live connector, reply import or automatic progress sync. Provider API adapters and scoped external-client grants remain future work; ordinary chat subscriptions do not automatically authorize/fund API use.


## October 13 repair verification

The prior union schema reproduced invalid JSON/heading-only output. Merely switching to JSON-object mode did not fix it. A flat schema with an explicit teaching field produced a full lesson; separating the answer from distractors and deriving the index in application code addressed a second observed index mismatch. The provider grammar rejected `uniqueItems`, so duplicate detection stays in the server validator. No automatic retry, second inference pass or paid fallback was added.

Bounded real-provider evaluations using the exported production prompt and format covered correction of a previous incorrect numerical answer, a conceptual correlation/causation lesson, and refusal to invent instructor/exam details from inventory notes. The two substantive lessons passed structural/provenance validation and manual review; the unsupported request returned the expected refusal. This small synthetic sample is not broad pedagogical validation. Automated tests additionally verify malformed output does not replace an existing saved session, answer placement follows the actual answer text, altered-case duplicates are rejected, and recent error/assistance context is retained within the existing input limit.
