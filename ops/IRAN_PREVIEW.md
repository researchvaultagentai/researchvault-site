# Iran VPS preview

The existing GitHub repository remains the source of truth. The target Iranian
frontend includes `/`, `/patent/`, and `/patent/en/`. The independent international
PCT Pages project stays separate.

## Current state

- The preview installer is prepared; production DNS has not been changed.
- The installer has **not yet been executed on the VPS**.
- No preview DNS record or certificate has been created.
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
git -c http.version=HTTP/1.1 clone -q --depth 1 -b ops/iran-preview https://github.com/researchvaultagentai/researchvault-site.git /srv/rv-iran-stage-src &&
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
- Prepare a dedicated Cloudflare support origin before changing production DNS.
  The preview currently forwards support requests to the unchanged production
  hostname; this must not become a loop after a cutover.
- The preview hostname may not be allowed by the existing Turnstile widget. This
  preview does not claim to validate support chat or alter Turnstile settings.
- Obtain valid certificates for the real hostnames and test their routing before
  pointing production DNS at the VPS.
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

Actual VPS nginx syntax, certificate issuance, browser flows, and full Iranian
page load tests remain pending server access and deployment.
