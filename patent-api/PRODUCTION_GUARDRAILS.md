# Production Guardrails — Patent Portal

## Protected existing ResearchVault resources
The patent deployment MUST NOT modify, delete, rename, re-bind, route through, or reuse the following existing production resources:

- Worker: `researchvault-bot`
- Worker: `researchvault-marketing`
- Worker: `rv-shadow`
- Worker: `researchvault-proxy`
- D1: `researchvault-db`
- Existing Telegram-bot secrets, KV/D1/R2 bindings, queues, routes, and cron triggers supporting the paper-delivery platform

## Patent-only resources
Use dedicated resources only:

- Worker: `researchvault-patent-api`
- D1: `researchvault-patent-db`
- R2: `researchvault-patent-private`
- Patent-specific secrets only

## Allowed production integration points
1. The existing website may receive only an additive UI link/card pointing to `/patent/`.
2. The patent frontend lives under `/patent/*`.
3. The patent backend must use its own Worker and its own D1/R2 resources.
4. Do not attach patent code to the `researchvault-bot` Worker.
5. Do not reuse the existing `researchvault-db` database.
6. Do not change current paper-finder routes, bot endpoints, schedules, or payment flows.

## Deployment order
1. Provision dedicated Patent D1.
2. Provision dedicated private Patent R2.
3. Configure Patent Worker secrets.
4. Apply Patent migrations only to `researchvault-patent-db`.
5. Deploy `researchvault-patent-api` to workers.dev first.
6. Smoke-test auth, OTP, D1, R2, signatures, invoices, and uploads.
7. Add the production API route/subdomain only after successful smoke tests.
8. Publish `/patent/` frontend.
9. Add a minimal service-entry card/link to the existing homepage.
10. Re-test the existing paper-finder homepage and Telegram bot before final release.

## Rollback rule
If any regression appears in the paper-finder platform, remove only the Patent route/link or roll back the Patent deployment. Do not alter any protected existing Worker or database.
