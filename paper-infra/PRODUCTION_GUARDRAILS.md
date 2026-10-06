# Production guardrails

1. Stage 1 must not change `researchvault-bot`, `researchvault-marketing`, `rv-shadow`, `researchvault-proxy`, Telegram handlers, billing, credits, D1 schemas, KV data, secrets, or existing routes.
2. No production Telegram request may be routed to the new Workers until an explicit later cutover approval.
3. Real resolver/source logic is disabled in Stage 1; `/v1/resolve`, `/v1/find`, and `/v1/probe` return `501`.
4. Every Stage 1 Worker must remain internal-only: `workers_dev=false`, `preview_urls=false`, and no public route/custom domain.
5. Every later migration must be additive first, observable, reversible, and protected by a feature flag or equivalent rollback mechanism.
6. The existing delayed-retry behavior that can find a PDF hours/days later must be preserved before any old path is retired.
7. Source expansion must use legitimate publisher/OA/repository access paths and must not implement paywall bypass.
8. Diagnostic logs must never expose credentials or appear in normal Telegram user output.
9. No source-family Worker is allowed to publish directly to Telegram; delivery remains an upstream responsibility.
10. `npm run check` must pass before any Stage 1 deployment command is run.
