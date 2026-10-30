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

The operator smoke now first sends two tiny deliberately invalid PDF inputs (a JSON string body and a binary body) to the private verifier. Each must return its normal format rejection without invoking conversion. These distinguish upload transport from the subsequent valid-PDF conversion check. All known bodies are snapshotted with exact byte lengths; timeout diagnostics identify waiting-for-headers versus reading-response-body.

During this operator check only, a temporary `wrangler tail rv-pdf-finder --format json` subprocess uses the existing login to report execution outcome, method, status and sanitized exception messages. It never prints raw request headers/URLs or stack traces, and is stopped when the check ends. A missing trace is reported separately and never counts as successful PDF verification. No production code, deployment or schema change is needed for these diagnostics.

## Publisher redirect and column-order correction

The two default PLOS DOI URLs currently use three redirects before the article page (four fetches), exceeding a source's three-request allowance. Recognized legacy PLOS journal DOI prefixes now produce the publisher's HTTPS printable-PDF candidate directly, spending zero discovery requests; byte-level verification remains mandatory. The matching DOI/title is never inferred from that URL.

Some old multi-column PDFs serialize title/citation details late on page one. An additional bounded leading-text check (8000 characters/1000 words) requires exact DOI, near-exact title, matching author, matching year, and no competing DOI. Numbered Introduction/References headings stop evidence collection. The original early-window rules remain; reference-only and wrong-article tests still fail verification. Both actual default PLOS PDF files were downloaded from the publisher and independently verified with the local PDF parser after this correction. This is not a substitute for the subsequent live Cloudflare check.

### Separator-free PDF text

The next operator smoke reached real PDF identity checks, but both default articles were rejected as `first_page_doi_mismatch`. Parsing each real publisher PDF locally and concatenating its text objects without inserting separators reproduces that rejection: the observed strings become `10.1371/journal.pmed.0020124SummaryThere` and `10.1371/journal.pone.0000308INTRODUCTIONSharing`. Some title words are joined too. This reproducer does not establish the exact live converter output; failed-identity diagnostics now include allowlisted comparison booleans/counts and the exact downloaded file's SHA-256/length, without converted text or observed DOI strings.

Only a recognized fixed-width PLOS article DOI immediately followed by `Summary` or `INTRODUCTION` and an uppercase start of body text can have that boundary restored. This path needs an exact full title after ignoring whitespace/punctuation, plus author and year **before** the DOI, a non-generic title, and no competing DOI. Generic DOI suffixes, figure/supplement suffixes, wrong numeric identifiers and arbitrary trailing words are never trimmed. Missing evidence stays unverified. Both real first-page reproductions pass with and without inserted text-object separators after this correction; live conversion still needs the operator smoke gate.

This change requires only a finder update, with no schema import, source/coordinator deployment or bot activation:

```sh
git pull --ff-only &&
npx wrangler deploy --config stage2/wrangler.pdf-finder.jsonc &&
npm run smoke:stage2
```

To update already initialized private services without repeating the D1 import:

```sh
git pull --ff-only
npm run deploy:stage2:workers
npm run smoke:stage2
```

This tests/bundles and redeploys the nine private Workers, preserving vars and leaving bot rollout disabled. It performs no schema operation. Failed real-article checks now include bounded discovery/download/identity diagnostics with counts/status/reason only, excluding document text, source URLs and credentials. Wrangler tail uses its default sampling; an explicit sampling-rate of 1 is rejected by the installed CLI and has been removed.
