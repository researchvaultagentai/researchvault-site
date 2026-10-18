# English-only ResearchVault Patent deployment

Target: `https://researchvault-patent.pages.dev` (availability is not yet verified).

This directory prepares a **new** Cloudflare Pages project. It does not rename,
reconfigure or replace `researchvault-site`, `researchvaultagent.ir`, any existing
Worker, database, storage bucket, payment integration or Telegram service. The
original English and Persian source files remain unchanged. Do not deploy this
directory into the existing Pages project.

This production branch intentionally retains the original international PCT
frontend. The `.ir` site's `/patent/en/` landing is being replaced independently
with an English translation of the Iranian service page. Do not merge that
replacement landing into this branch: its international content, dollar pricing
and international intake flow belong on the new `pages.dev` project.

The English landing page is served at `/`. English client routes retain
`/patent/en/account/`, `/patent/en/intake/`, `/patent/en/dashboard/` and
`/patent/en/contract/`. The English agreements are copied byte for byte so that
their document hashes and version identifiers remain unchanged. Persian and
administrative links continue to point to the existing `.ir` site.

## Local verification

Requires Node.js 20 or newer; there are no npm dependencies.

```sh
cd deploy/patent-en
npm test
npm run build
```

The build writes only `deploy/patent-en/dist/`. No source files are overwritten.
Tests use a mocked Patent service and synthetic data: they never send OTPs,
create cases, sign contracts, upload client files or modify production data.

## Cloudflare setup after account access is restored

Create a new **Pages** application connected to this existing GitHub repository:

| Setting | Value |
| --- | --- |
| Project name | `researchvault-patent` |
| Repository | `researchvaultagentai/researchvault-site` |
| Production branch | `english/patent-pages` |
| Root directory | `deploy/patent-en` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Service binding | `PATENT_API` → existing `researchvault-patent-api` |

The included `wrangler.toml` declares the new project's output directory and
service binding. Verify those settings in the new project before publishing.
No API tokens, existing secrets, D1 bindings, B2 settings or backend code changes
are needed for the new frontend. If the requested project name is unavailable,
stop rather than silently choosing another name.

The `/api/*` Pages Function forwards the original Request to the existing
dedicated Patent Worker through a service binding. This keeps authentication
first-party on the new hostname and preserves HttpOnly, Secure, SameSite=Strict
session cookies without changing the old API's CORS or session configuration.
The backend remains responsible for all authorization and private document
access. The new connector rejects cross-origin requests, admin routes and
preview-host access to production data. It never caches authenticated responses.
Only `/api/*` invokes a Function; static pages and assets remain static.

## Zero-spending requirement

Do not buy or register a domain, add payment details, enable a subscription,
upgrade a plan, or modify the account's existing billing settings. The project
uses a provided `pages.dev` subdomain. Verify the actual Workers/Pages plan and
remaining shared free quota before activation: Pages Functions use the Workers
quota. If the account settings imply extra charges, stop before publication.
Existing patent API, email and storage services retain their existing costs and
limits. This deployment does not make those services unlimited or free.

Official references:

- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/functions/bindings/#service-bindings
- https://developers.cloudflare.com/pages/functions/pricing/

## Release checks and rollback

Before declaring migration complete, verify the new hostname, its English root,
assets, privacy page and portal routes. Verify session handling using a dedicated
test account without creating real cases, signing agreements, sending client
messages or changing payments. Confirm that the existing `.ir` site still serves
its original deployment. Availability of the target name, account billing state,
live service binding and browser authentication remain unverified until then.

Rollback concerns only the new English Pages project. Do not delete, detach,
rename or roll back the existing Persian Pages project or any existing backend.
