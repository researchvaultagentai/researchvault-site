# Paper resolution Stage 2

Status: implementation and local validation; production rollout stays disabled until remote verification. Stage 1 files and public website files are unchanged. This directory replaces the nine isolated scaffold services using private `/v2/*` contracts; Stage 1 `/v1/*` remains in its original sources for rollback.

## Resolution path

The DOI coordinator claims an expiring D1 lease, gets independently DOI-matched Crossref metadata (DataCite for missing Crossref DOIs), then calls the PDF finder. The finder ranks relevant specialists using publisher family, actual verified success, latency and bounded provider cooldown. It calls at most two discovery specialists together and never indiscriminately fans out to all seven. OA locations, biomedical repositories, DOI-addressed preprints, three publisher families and HAL/Zenodo supply alternate candidates. Optional OpenAlex is skipped without an existing key.

A discovery URL, landing-page title, publisher domain, HTTP 200 or `%PDF` header is never sufficient proof. Each delivered v2 file needs independent frontmatter title/DOI evidence, with author/year checks for short titles or DOI-free manuscripts. Reference-only DOIs, supplementary files, HTML, malformed/truncated or unreadable files stay rejected/uncertain. Proof is bound to DOI, verifier version, byte length and SHA-256 of the exact downloaded bytes. An expiring URL cache always re-downloads and hashes; changed bytes require new verification. No PDF bytes are put into D1 or transferred as base64.

Production uses the native Cloudflare `AI.toMarkdown` **PDF text parsing** API with document metadata disabled and a constant filename. It does not invoke `AI.run`, a language model, image conversion or OCR. The independently parsed first-page PDF.js oracle (`unpdf`) is test-only and is absent from production bundles. Conversion API availability, real provider access, wall time and Free CPU limits still need production measurement; local workerd does not enforce production CPU limits. Uncertain conversion never becomes approval.

## Resource ceilings

- Coordinator: 2 external metadata requests; finder: 16 total external requests across its discovery/download work, including redirects; source: 1–3 assigned external requests.
- Finder: up to 4 selected source calls, at most 2 concurrent, up to 8 download requests within the shared 16; maximum 3 text conversions; 16 MiB PDF cap.
- At most 6 pipeline Worker invocations before the bot's optional separate legacy verification call; well below Cloudflare's 32-per-original-request limit. Conversion is separate platform work and is tracked separately.
- Coordinator 18s, finder 13s, source 5s maximum, shortened by the caller's deadline. Bot canary supplies a 7.5s deadline and an 8s boundary timeout, retaining the remainder of its original 22s legacy resolution allowance. Existing outer bot timeout is unchanged.
- New state is confined to four `rv_paper_*` tables in the existing D1 database. Claims expire after 25s; failed jobs cool down. Admin tasks and all existing retry scheduling/notification functions stay unchanged.

Limits are per invocation and service calls also consume caller subrequests; splitting services is not unlimited budget. The bot bridge charges its own service calls, while child consumption is reported as telemetry. Existing legacy counters become request-scoped with `nodejs_als` so concurrent requests cannot reset each other's budget.

## Checks and deployment

From `paper-infra`, with Node 24:

```sh
npm ci --ignore-scripts
npm run check:static
npm run check:stage2
```

The suite tests real authored PDF fixtures, independent evidence, wrong/blocked-first fallback, cache byte changes, concurrent DOI leases, provider rate limits, strict migration isolation, and all nine real workerd services sharing local D1 and private service bindings. The native converter is mocked at its RPC boundary in local integration; this does not demonstrate live conversion success. All nine Wrangler configurations are bundled without deployment.

From a checkout of branch `infra/paper-resolution-stage2`, in the existing operator environment already signed into the correct Cloudflare account:

```sh
cd paper-infra
npm ci --ignore-scripts
npm run deploy:stage2
```

This validates/tests/builds first, checks login, applies only the idempotent four-table SQL, then deploys seven sources, finder, coordinator in dependency order. The script pins the account/database, preserves existing vars/secrets, creates no public routes or cron triggers, and does not deploy or enable the bot. No API token should be pasted into a chat or committed. A failure stops subsequent deployment; with bot v2 disabled, isolated service changes do not receive customer traffic.

## Production activation gate

1. Confirm deployment versions and private `/health` responses for nine services. Coordinator must report all four tables; finder must have D1, seven sources and PDF conversion configured.
2. Exercise private bindings from the signed-in Cloudflare testing environment using several known openly accessible DOIs spanning publishers and biomedical repositories, a wrong-PDF fixture, a missing paper, and simultaneous requests for one DOI. Verify exact PDF identity, actual conversion output, source fallback and reported usage.
3. Check live CPU/errors, success rate and latency against the legacy path. Local tests alone are insufficient. Verify existing pending/admin behavior using the normal bot workflow.
4. Only then deploy the companion bot PR with `PAPER_PIPELINE_ENABLED="true"` and `PAPER_PIPELINE_PERCENT="1"`. Keep the current `false`/`0` configuration until steps 1–3 pass. Increase 1 → 5 → 25 → 100 only when observed quality and latency are acceptable. Cohorts are deterministic by DOI, with no customer identity sent to specialist services.

No automated canary promotion is configured. Enabling is an operational action, not a side effect of deploying these private workers.

## Rollback

First set the bot flag to `false` and percent to `0` and redeploy the same bot version/config with existing vars preserved, or use its previous Cloudflare deployment version. This restores legacy resolution immediately for new invocations; admin/manual delivery is unchanged. In-flight requests can finish. Keep additive `rv_paper_*` tables; do not drop or restore the shared database. If needed roll the nine private services back to their recorded previous Cloudflare versions, in reverse caller order. Original Stage 1 sources/configs remain available at commit `29b626c49a6edaf176c823d3eda4da25326df814`.

## Primary references

- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/
- https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/

## One-command live smoke after deployment

With the existing Wrangler login on the operator's machine, from this directory:

```sh
git pull --ff-only
npm run smoke:stage2
```

This uses `getPlatformProxy` with nine explicitly remote service bindings in `stage2/wrangler.smoke.jsonc`. The local Node tool calls the already deployed services through a temporary Wrangler remote binding session; it does not deploy a public endpoint, import a database, send Telegram messages, or enable the bot. The config has no main entrypoint and is excluded from the deployment script.

The test checks all nine private health endpoints, live PDF text conversion on a matching authored fixture, rejection/uncertainty for a different authored PDF, and exact-byte proof for two known OA PLOS articles. Real DOI calls can update only the pipeline's existing cache/lease/health tables through normal resolution. It reports timings, source, proof reason and request usage without printing tokens, PDF bytes or private URLs. It stops if infrastructure/conversion checks fail, and exits unsuccessfully if any real DOI fails; a green local unit suite is never substituted for this live result. Other DOI samples can be passed with `npm run smoke:stage2 -- 10.xxxx/example` (maximum five).

The smoke is an initial live check, not a claim of broad publisher coverage or acceptable production CPU/latency. Check Cloudflare live CPU/errors and representative publisher cohorts before enabling the bot.

References for the two default openly accessible samples:
- https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0020124
- https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000308
- https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy
- https://developers.cloudflare.com/workers/local-development/#remote-bindings

Live health probes retry transient connection/HTTP failures at most three times (500ms and 1000ms pauses). Each failed attempt reports the service, HTTP status, response type, request path and a short sanitized error excerpt. Authentication failures are not retried. POST verification/resolution requests are never automatically replayed; a failed health probe still prevents later stages and never counts as a pass.
