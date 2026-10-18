# Patent Work connection preparation

This directory prepares the authorization and data boundary for the international
patent service. It includes four dedicated Worker entrypoints and their service
binding configurations; see [Worker deployment and support](workers/README.md).
They have **not been deployed or connected to the live Telegram bot or Work
account**. Existing backend routes, production resources and article-bot code are
unchanged. The website changes add an isolated bilingual support widget; intelligent
replies require a verified support endpoint and public Turnstile configuration.

The dedicated account is `researchvaultagent.ai@gmail.com`. A Pro subscription is
not required to run these local checks. Purchasing a subscription does not install
this connection or establish an unlimited automated backend. Confirm account
eligibility, available Work integrations, model selection and actual usage in a
pilot before choosing a subscription or promising a delivery deadline.

## Included

- `src/contracts.js` creates a case-specific, hashed package containing the approved
  private master-template version, explicit report language, technical document
  metadata and human-confirmed technical notes. Raw video/audio, identity records,
  payment evidence, private storage keys and customer profile fields are excluded.
  Technical files can themselves contain identifying information; this is data
  minimization, not anonymization.
- `src/workflow.js` requires the customer to confirm document completion, then the
  administrator to authorize the exact package revision. Every analysis checkpoint
  waits for human approval. The final PDF checkpoint ends automatic Work events.
- `src/d1-store.js` stores state, command receipts and an outbox atomically using
  D1 `batch()`. Compare-and-swap versions prevent two concurrent commands from both
  advancing a case. Command IDs make retries idempotent. Outbox wake-ups contain
  metadata only; current state and an atomic stage claim determine permission.
- `src/work-tools.js` provides three transport-independent handlers: read the
  approved package, claim an authorized stage, and submit a server-verified
  checkpoint. There is no model tool for admin approval, payment verification,
  password release or customer delivery.

Only trusted authenticated backend adapters may call the store or build an actor.
Never accept `role`, `ownerId`, `caseId`, `runId` or administrator identity from
model output, arbitrary MCP arguments, customer forms or unsigned Telegram data.

## Agreed configuration

| Item | Preparation value |
| --- | --- |
| International first-stage report | USD 1,111; independent of later stages |
| Submitted revision requiring a new run after processing starts | USD 111 per revision package |
| Draft edits before the first run | Free |
| Corrections to our mistakes and system retries | Free |
| Video | At most 20,000,000 bytes and 420 seconds; reviewed by Ata, never sent to Work |
| Audio | English only; human-approved transcript supplied to Work |
| Report language | Explicit `en` / LTR or `fa` / RTL per case |
| Requested execution | `gpt-6.1-sol`, reasoning effort `max` |
| Master-template version | `GP-MASTER-PLUS 1.1`, including the BQ language overlay |

These are library constants and validation rules, not changes to current customer
pricing, uploads or billing. The full master prompt, sample reports, passwords,
customer records and credentials must stay out of this repository. Supply the
approved private template by exact version and SHA-256 at runtime. File MIME,
size, duration, malware status, NDA evidence and customer submission records must
come from the trusted backend; the builder does not inspect media bytes or verify
a signature by itself. Legal/payment policy wording needs its own implementation.

Language is part of the package hash. Do not infer it from the administrator's
Persian messages, source-file language, IP address or nationality. Set and confirm
it in the intake form. Report language is separate from target jurisdictions.

## Approval sequence

1. The backend verifies NDA acceptance, file ownership and security review. It
   records the manifest and language when the customer confirms completion.
2. Ata reviews video, messages and documents. Explicitly confirmed technical notes
   can be included; private notes are excluded. Build and privately persist the
   immutable package. Record `inputs_changed`, then `client_submitted` using the
   verified customer action. Later admin notes can update the package while
   preserving the customer's document completion, but require a fresh admin grant.
3. Ata approves the displayed case, revision, language and package hash in Telegram.
   The authenticated admin adapter records `authorize_run` and a unique run ID.
4. A Work wake-up only points to that authorized run. The scoped Work handler
   retrieves the approved package and atomically claims the current stage.
5. The trusted artifact adapter verifies and hashes the stage output. Submission
   places the case in `awaiting_approval` and queues a notification for Ata. Ata
   approves the exact result hash and input revision to authorize the next stage.
6. Final approved PDF: stop automatic Work wake-ups. Existing human discussion may
   continue separately. Payment and password release remain separate server logic.

Stages are `intake_analysis`, `search_strategy`, `prior_art_review`,
`development_review`, `docx_review`, `pdf_qc`. They are execution gates, not a
replacement for the master prompt's complete research/report requirements.

Input or language changes before the first claim revoke an unused run grant and
make old wake-ups ineligible. After any stage starts, input changes fail with
`revision_workflow_required`; this preparation does not silently reset or bill the
case. A paid revision, free correction, failure recovery and explicit admin
cancellation need separate, reviewed commands before live use.

## Native Work transport to implement and verify

The intended route is an authenticated **personal MCP plugin with MCP Events**.
It does not require browser scripting or a worker logging into ChatGPT using a
stored password. The personal-plugin and event capabilities must be tested in the
dedicated account; a requested model/effort field is not evidence of the actual
Work execution configuration.

1. Implement HTTPS MCP transport and the account-supported authentication flow
   (normally OAuth), verified issuer/audience, token handling and server-side
   account-to-case/run authorization. Private documents must never use an exposed
   no-auth MCP endpoint. Do not assume a static-header login option is available.
2. Advertise the supported MCP protocol/events capabilities and implement the
   documented persistent subscription lifecycle. MCP Events wake a **subscribed
   Work chat**; automatic creation of a separate new Work chat for each client is
   an unresolved pilot requirement. Do not promise that capability from events
   alone. Never reuse one case's context or authorization for another case.
3. Implement signed webhook delivery and verification per the platform's current
   event specification, with replay protection, deduplication, bounded retries and
   expiry. Drain the outbox only after rechecking eligibility. Receivers must
   atomically claim current state even when a stale event arrives late.
4. Expose scoped tool schemas around `createWorkTools`. Read file bytes only from
   the approved package's document IDs, verifying private object ownership, version
   and SHA-256 before returning protected file handles. File access must be scoped
   to the case/run, expire, and stop after finalization/revocation.
5. Implement `verifyCheckpoint` using immutable case/run-bound artifact records.
   For final output it must verify the exact approved DOCX, deterministic PDF
   conversion, page/render checks, actual AES-256, open-password behavior,
   permissions and extraction checks. A model's assertion is not a QC result.

References checked 2026-10-18:

- [Personal plugins quickstart](https://developers.openai.com/plugins/quickstart)
- [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- [Custom MCP servers](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [ChatGPT plans and shared usage](https://learn.chatgpt.com/docs/pricing)
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## Other live integration work remains

- Add the dedicated Patent Queue menu and signed, case-bound admin callbacks to
  the existing Telegram bot without changing article-search behavior. Add case
  signup/completion/message/payment/deadline notifications and controlled replies.
- Wire authenticated existing portal records into this library and persist report
  language, versioned client completion and NDA evidence. The current backend's
  deposit gate and upload settings are not migrated by this change.
- Implement byte/container-verified upload limits and duration probing; an old
  frontend limit or a supplied MIME type cannot be the enforcement boundary.
- Implement payment-provider verification, revisions and ledger records. Release
  only the open password after both verified full payment and approval of the
  exact final PDF. This library stores no password and authorizes no release.
- Establish private package/artifact storage, access revocation and deletion
  policies that match the customer commitment, including backups and provider
  retention. An account subscription alone does not provide a deletion guarantee.
- Run one synthetic English case end to end, including an admin-edited DOCX,
  reconversion, encryption, human approval, verified test payment and automatic
  password release. Test Persian routing separately. Measure cost/capacity and
  turnaround before offering a general one-business-day commitment.

## Local validation

Requires Node 22.13+ (`node:sqlite` is used by tests); no dependencies or paid calls.

```sh
cd patent-work-bridge
npm test
```

Tests exercise case isolation, locale binding, media exclusion/limits, human
gates, package integrity, concurrent commands, replay handling, transaction
rollback and stale outbox suppression using real local SQLite. They do not claim
live D1, Telegram, OAuth, MCP Events, model execution or PDF QC has been tested.

The SQL migrations deliberately live here rather than in `patent-api/migrations`.
Do not apply them to production during connection preparation. Explicit deployment
scripts validate the fixed Worker names, private routes and dedicated databases;
they deploy helper targets before the orchestrator and leave live delivery disabled.
