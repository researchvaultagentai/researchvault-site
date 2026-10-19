# Dedicated Workers, support and deployment

Status: infrastructure rollout in progress. The private `researchvault-patent-work`
and `researchvault-patent-notifications` helpers deployed successfully from source
`3347a9788e5a5b95dd0969dd7de0dbb55072f8cd`, with Cloudflare versions
`396160cf-372e-42c6-8eb3-2d9f2a52e72a` and
`53de5edd-2fdc-4629-86bd-a0012e1b23ec` respectively. Support and orchestrator
still need their own successful build verification. Case execution, public support
and Telegram delivery remain disabled. Interactive Cloudflare sign-in was not
completed in this session; the account owner configured native Workers Builds.
No article-bot resource is a deployment target and no SQL migrations have been run
by these deployment scripts.

| Worker | Responsibility | Orchestrator binding / named entrypoint |
| --- | --- | --- |
| `researchvault-patent-orchestrator` | Case state, client completion, admin gates and leased outbox | Caller chooses a scoped orchestrator entrypoint |
| `researchvault-patent-work` | Validated, hashed case package; future native Work wake-ups | `PATENT_WORK` / `PatentWork` |
| `researchvault-patent-notifications` | Metadata-only private admin notifications | `PATENT_NOTIFY` / `PatentNotifications` |
| `researchvault-support` | Bilingual public service help and Telegram intent classification | `SUPPORT_AI` / `SupportAssistant` |

Bindings are declared in `orchestrator/wrangler.jsonc`. They are real Wrangler
service-binding declarations, not evidence that the services exist in the account.
The helpers have no return binding to the orchestrator, so the initial deployment
has no circular service dependency. Each Worker is deployed separately, targets
first. No protected article-bot Worker or database is a deployment target.

## State and delivery

Only the orchestrator binds `PATENT_DB`, the existing dedicated
`researchvault-patent-db`. The migrations add only `patent_work_bridge_*` tables.
The notification and Work helpers cannot query case databases. Input packets and
the private master template return to the trusted intake adapter for immutable
private storage; neither the delivery outbox nor Telegram receives their content.

Separate RPC entrypoints are exported:

- `PatentOrchestrator`: helper health, package preparation and bounded outbox drain.
- `PatentClientControl`: record a verified client's completed intake.
- `PatentAdminControl`: queue summaries and exact-hash human approval commands.

Only authenticated backend adapters may hold these bindings. The client adapter
must verify session ownership, NDA evidence and manifest completion before calling
`submit`. The admin adapter must derive the admin ID from verified authentication;
an allowlist is not a substitute for that authentication. Do not expose the admin
entrypoint to a browser, model tool, arbitrary proxy or unsigned Telegram update.
`PATENT_ADMIN_IDS` starts empty and blocks all admin commands until configured.

Delivery leases use atomic D1 updates. Failed destinations retain their events for
retry; another destination can continue. A stale Work authorization is dropped at
dispatch and must still fail a recipient's atomic stage claim. A restart can recover
expired leases. Delivery is at least once: a provider accepting a message followed
by a lost response can still produce a duplicate on retry. Include/preserve event
IDs and deduplicate in the eventual Work receiver. Telegram does not provide an
exactly-once send primitive here.

Work transport intentionally returns `work_connection_required`; it never reports
a successful delivery before the authenticated native MCP Events round trip exists.
PDF conversion/rendering, encryption verification, payment and password delivery
remain separate integration work. No placeholder is marked as successful QC.

## Support model and free usage

The fixed model is `@cf/qwen/qwen3-30b-a3b-fp8`. Cloudflare describes it as
multilingual. It is selected as a capable low-consumption starting point; Persian
and English answer quality still require a live pilot. No claim is made that it is
the best model or equivalent to the patent-report model.

Workers AI currently includes 10,000 neurons per UTC day, shared across the account.
Free-plan requests fail after the allocation; paid plans can incur overage. No paid
plan, credit purchase, gateway billing or paid fallback is activated by this code.

Support reserves a conservative 100 neurons per inference, capped at 7,500 reserved
neurons per UTC day (75 calls). Inputs are limited to 9,000 encoded bytes and output
to 512 tokens (128 for classification). This is an application reserve, not exact
provider metering or a guarantee about other workloads on a paid account. Verify
the account's plan, shared AI usage and actual usage before enabling. Known service
questions use a curated bilingual guide and consume no inference. Exhaustion or a
provider error falls back to human contact / the original Telegram route. No chat
messages, invention files, raw IPs or customer identities are stored in the support
database; it contains daily aggregate counters only.

The support Worker uses its own `SUPPORT_DB` / `researchvault-support-db`. The account
owner created this database and supplied ID `8953d374-1184-46e5-a34f-9860b32293a8`;
the config and deployment guard pin that ID, without automatic provisioning. Its
migrations are under `support/migrations`. The owner confirmed creating the
`researchvault_support_budget` counter table through the Cloudflare D1 Console.
This session has not executed or independently read back remote SQL; the deployment
scripts do not run migrations. Never apply support SQL to the article database.
It cannot approve cases, verify payments, open PDFs or read private patent records.

## Floating widget

`assets/rv-support-widget.js` and `assets/rv-support-faq.js` provide a responsive
Shadow DOM widget. The public homepage receives one module tag. Patent pages load
the same module through an additive loader after the existing `patent.js` code.
The original application logic is unchanged. It follows document language changes,
uses RTL/LTR, keyboard/Escape controls and plain-text rendering of all replies.
Conversation history stays in memory and is cleared on reload/language change.

Without a configured endpoint it provides the local service guide and human-contact
link; it does not pretend live intelligent support is connected. Configure only
after deploying/authenticating/testing the support endpoint:

```js
window.ResearchVaultSupportConfig = {
  endpoint: 'https://YOUR-VERIFIED-SUPPORT-HOST/v1/chat',
  turnstileSiteKey: 'YOUR-PUBLIC-TURNSTILE-SITE-KEY',
};
```

The endpoint is subject to exact-origin CORS, bounded request bodies and server-side
Turnstile validation with matching hostname/action. Set `TURNSTILE_SECRET` as a
Worker secret; never put it in HTML. Do not put confidential technical documents in
support chat. Public support is not an authenticated case-status channel.

The English production site uses a separate source branch. Carry the widget module,
FAQ and loader through its actual build before publishing that branch; changing
the main-branch sources alone does not deploy both sites. Existing page prices are
not changed by this patch. New pricing in support is explicitly described as planned
and must be reconciled with the live invoice/site before launch.

## Additive Telegram integration

The article-bot source is not present in this checkout. No attempt is made to replace
its webhook or deploy over its Worker. `integrations/telegram-support.js` is a tested
adapter to insert later after existing authentication, deduplication and state checks.

The bot's minimal additive binding would be:

```json
{ "binding": "SUPPORT_AI", "service": "researchvault-support", "entrypoint": "SupportAssistant" }
```

The adapter gives commands, callbacks, attachments and group messages back to the
original handler. DOI and active article-input mode reach the original article
handler directly. Only unclassified private-chat text needs the classifier.
Uncertain/model-failure results preserve the original path. Classifier calls have a
2.5-second deadline so a stalled model cannot hold the original route indefinitely.
A supplied `onPatents`
callback handles patent navigation without altering article queues/payments.
`onReply` errors propagate rather than silently re-running an older handler after
a send attempt. Wire the original handler exactly once when `handled` is false.

The persistent Patent Queue menu and callbacks still need the actual bot source and
a reviewed minimal integration. This code neither calls `setWebhook` nor resets
existing bot commands/keyboards. `PATENT_TELEGRAM_ENABLED` and outbox delivery start
disabled; secrets and a verified private admin chat are required for live sends.

## Validate and deploy in stages

```sh
cd patent-work-bridge
npm test
npm run check:workers
```

42 local tests currently cover case isolation, human gates, concurrent database
commands/delivery, support budget reservation, intent fallback and HTTP challenge
checks. Service bindings are exercised through the same service handlers in local
tests, not the Cloudflare RPC runtime. Worker source syntax/config topology pass.
GitHub-hosted Wrangler dry-run compilation passed for all four Workers in
[the preparation run](https://github.com/researchvaultagentai/researchvault-site/actions/runs/39178650230).
The deployment job in that run was skipped because the request is inactive.
Cloudflare RPC execution, browser visual QA, real inference and live account
integration still require their own validation.

After installing Wrangler from the package's development dependencies:

```sh
npm run build:workers
npm run dev:workers
```

Use an authenticated Cloudflare session scoped to the intended account. Recheck the
dedicated database IDs and existing Worker names. Apply only the appropriate new
migrations after backup/review. The explicit `deploy:workers` script validates a
fixed list of four new Worker names and deploys helper targets before the
orchestrator. Its first deployment is private and delivery-disabled. Enabling
public support, admin adapters, credentials or schedules requires a separate tested
configuration change; dashboard edits alone are not a durable source of truth.

There is no new cron or public route. An inactive GitHub Actions deployment path is
prepared in [GITHUB_DEPLOYMENT.md](GITHUB_DEPLOYMENT.md). It uses new repository
secrets and a separate exact-source activation commit; it does not use the chat
browser or an account password. No automatic remote migration is bundled into
deployment.

## Cloudflare Workers Builds (current setup)

The account owner configures Cloudflare; repository changes are maintained through
GitHub. This path uses the existing Cloudflare GitHub App connection and its own
Cloudflare build token, without adding GitHub repository secrets or activating the
alternative Actions deployment request.

For each new Worker, select the production branch
`feature/patent-work-connection-prep` under Settings > Build > Branch control.
Keep preview builds disabled, the build command empty and the root directory set to
`patent-work-bridge`. Selecting `main` fails before installation because this
preparation directory is not present on that branch.

The first target is `researchvault-patent-work`, with deploy command:

```sh
npx wrangler@4.147.0 deploy --config workers/work/wrangler.jsonc
```

Use a dedicated patent build token, not any existing article-platform token.
Later targets must each use their matching name and config from the table above,
helpers before orchestrator. A push affecting this directory after the branch
change triggers a new build. Retrying an older `main` commit is not verification
of the new branch. Inspect the new source commit and actual Cloudflare deployment
result before recording success; the four-service architecture is not live merely
because the first helper has deployed.

References checked 2026-10-18:

- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/local-development/multi-workers/
- https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://core.telegram.org/bots/api#sendmessage
