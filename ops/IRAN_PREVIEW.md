# Iran VPS preview

The existing GitHub repository remains the source of truth. The target Iranian
frontend includes `/`, `/patent/`, and `/patent/en/`. The independent international
PCT Pages project stays separate.

## Current state

- The isolated preview is live at <https://iran-preview.researchvaultagent.ir/>.
  `/`, `/patent/`, and `/patent/en/` are served by the existing Iran VPS.
- Bootstrap and HTTPS installation succeeded on 2026-10-23. Both runs reported
  `existing_configs_unchanged: true`; nginx syntax validation and graceful reload
  succeeded.
- Only the new preview hostname has a DNS-only A record pointing to
  `89.44.241.208`. The production apex and `www` remain proxied to Cloudflare Pages.
- A separate Let's Encrypt certificate, `rv-iran-preview`, was issued using the
  existing account and webroot method. It expires on 2027-01-21.
- The deployed source was verified as commit
  `2cea6853ad9305f7662a07a29afe0d07033c2650`, with the same reviewed installer as
  the pinned commit below. Public page source remains at baseline
  `0dc29fc7f1beb6417eb0641b77df848f5a0c60bc`.
- Website source on `main` and the existing payment/tunnel configuration have not
  been changed by this work.

## Safety boundaries

The installer creates only a dedicated directory under
`/srv/researchvault-iran-preview` and a separate nginx vhost. Its vhost loads after
existing sites so their implicit default routing stays intact. It records hashes
of existing nginx, cloudflared, and systemd service configurations, and refuses to
proceed if they change. It does not install packages, restart services, edit a
payment/tunnel configuration, change DNS, or accept certificate authority terms.
After `nginx -t`, it requests a graceful nginx configuration reload.

The public directory excludes Worker code, Pages Functions, Git metadata, and
deployment scripts. The page HTML is copied unchanged from the repository.
Preview-only deployment transformations, also defined in this repository, make
the patent client use the preview's same-origin `/api/` path and recognize the
preview hostname for Iranian support scope.

## Initial installation

From an authenticated root SSH/PuTTY session on the intended existing VPS:

```sh
git -c http.version=HTTP/1.1 clone -q -b ops/iran-preview https://github.com/researchvaultagentai/researchvault-site.git /srv/rv-iran-stage-src &&
git -C /srv/rv-iran-stage-src checkout -q --detach f0eab65599d028ae790b0bfc23c5ae6587a608be &&
python3 /srv/rv-iran-stage-src/ops/iran-preview.py bootstrap
```

If the repository was already cloned with `--depth 1`, fetch the pinned installer
commit explicitly before checking it out. A shallow clone of the branch tip may
not contain that older commit:

```sh
git -C /srv/rv-iran-stage-src -c http.version=HTTP/1.1 fetch -q --depth 1 origin f0eab65599d028ae790b0bfc23c5ae6587a608be &&
git -C /srv/rv-iran-stage-src checkout -q --detach f0eab65599d028ae790b0bfc23c5ae6587a608be &&
python3 /srv/rv-iran-stage-src/ops/iran-preview.py bootstrap
```

The initial vhost serves only its ACME challenge directory; other requests receive
503 until a dedicated preview certificate is obtained and HTTPS mode is enabled.
Do not use `certbot --nginx`, which can edit existing vhosts.

Subsequent steps, after successful bootstrap output, are:

1. Create **only** `iran-preview.researchvaultagent.ir` as a DNS-only A record for
   the verified VPS address. Leave existing website/payment DNS records intact.
2. Obtain a new, separate `rv-iran-preview` certificate with Certbot's webroot
   method and the preview public directory. Reuse the existing account; stop if
   any new agreement or account setup is required.
3. Run `python3 /srv/rv-iran-stage-src/ops/iran-preview.py https`.
4. Verify HTTPS, all three page paths, images/fonts, anonymous `/api/me`, and
   unauthenticated access control. Compare several Iranian networks and a browser
   with VPN off. Short network probes alone do not prove full page load quality.

## Gates before a production cutover

- Preserve original client IP handling for API rate limits and signature evidence;
  current Workers see the VPS address when requests go through this preview.
- Investigate intermittent upstream latency: repeated `/api/me` checks succeeded
  everywhere but occasionally took approximately 5.4–5.7 seconds. Support config
  also had 5.5- and 10.3-second responses. Most of that time was before the first
  response byte; a German control also had one slow API response. This suggests
  checking VPS-to-Cloudflare connections/retries, but VPS logs are still needed
  to establish the cause. Do not treat fast static pages as proof that portal
  and support requests are fast.
- Prepare a dedicated Cloudflare support origin before changing production DNS.
  The preview currently forwards support requests to the unchanged production
  hostname; this must not become a loop after a cutover.
- The preview hostname may not be allowed by the existing Turnstile widget. This
  preview does not claim to validate support chat or alter Turnstile settings.
- Obtain valid certificates for the real hostnames and test their routing before
  pointing production DNS at the VPS.
- Verify a renewal reload hook for the new certificate; a webroot renewal alone
  does not prove that nginx will start serving the renewed certificate.
- Keep both frontend copies tied to the same reviewed GitHub release. An
  automatic GitHub-to-VPS update pipeline has not yet been configured.
- Retaining a Cloudflare copy does not implement automatic failover. The business
  backend remains on Cloudflare, so this frontend migration is not complete
  independence from Cloudflare outages.

## Validation completed

- Preview public-file copy check: 63 assets, private code excluded.
- Main and patent page HTML bytes unchanged by the preview copy.
- Generated patent client and support context JavaScript parse successfully.
- Preview vhost preserves existing vhost ordering and enables upstream TLS
  certificate verification.
- Actual VPS bootstrap and HTTPS configuration passed, with existing nginx,
  cloudflared, and systemd configuration hashes unchanged.
- All three pages rendered in Chrome. Main illustrations were visible. This did
  not validate an authenticated portal session or support chat.
- Remote bytes for the three HTML pages, patent client, support context, and
  local Vazirmatn font matched the build produced from the GitHub source.
- Anonymous `/api/me` returned `200` with `user: null`; `/api/cases` returned
  `401 unauthorized`. Support configuration, font, and patent JavaScript returned
  `200`. Support-chat/Turnstile completion has not been tested.

Distributed HTTPS checks on 2026-10-23 used the same Globalping probes for the
preview and production comparisons. The following are **individual HTTP request
totals in milliseconds**, including DNS and TLS, rather than browser page-load
times. Every preview response below was HTTP 200 with a verified certificate.

| Request | Sefroyek AS48715 | TCI AS58224 | Hostiran AS59441 |
| --- | ---: | ---: | ---: |
| Preview `/` | 27 | 115 | 18 |
| Preview `/patent/` (first lookup) | 514 | 544 | 110 |
| Preview `/patent/en/` | 22 | 108 | 14 |
| Preview local font | 370 | 130 | 374 |
| Preview `/api/me` (first pass) | 377 | 5662 | 5578 |
| Preview `/api/me` (second pass) | 280 | 5435 | 291 |
| Preview `/api/me` (third pass) | 289 | 391 | 270 |
| Preview `/support/config` | 10329 | 5452 | 463 |
| Production `/patent/`, HTTP/1.1 | 387 | 435 | 374 |

For production `/patent/` over HTTP/2, Sefroyek timed out at 15 seconds, TCI
returned 200 in 438 ms, and Hostiran reported a private-address DNS result and
could not run the request. The separate HTTP/1.1 comparison succeeded from all
three. This reproduces a protocol/path-dependent problem but does not establish
which operator causes it. Two German control probes also completed the preview
checks successfully. The requested fourth Iranian ASN had no selected probe and
must not be counted as an Iranian success.

Measurement IDs (public GET endpoint: `https://api.globalping.io/v1/measurements/{id}`):

- Preview patent: `2aEISwwjwYTfywAnJ00021Mr6`
- Preview homepage: `258aw4QQLP3QwHExm00021Mr8`
- Preview English: `2bm41BRnLaqziRTTN00021Mr8`
- Preview API: `2Ja4lJ40aGgJyKPUU00021Mr8`
- Preview font: `2MhQcqalHnlr3rYmB00021Mr8`
- Preview API second pass: `20rRpPSU1CwNYIUdb00021MrA`
- Preview API third pass: `2KuF7mkpCfLgkmG9A00021MrA`
- Preview support config: `2tYN8hA5I50Sb2OcU00021MrA`
- Production HTTP/2: `2QnIle24xOHnICHfn00021Mr8`
- Production HTTP/1.1: `2aS4kEw6uynkYxmtb00021Mr8`

Production cutover, authenticated browser flows, support chat, API latency
investigation, and repeated real-user page-load checks remain pending.
