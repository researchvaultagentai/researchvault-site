# Website support connection

The floating guide works locally in Persian and English. General AI replies use
the same-origin /support/chat endpoint and a private SUPPORT_SERVICE binding to
the dedicated support Worker. Public previews are blocked by the proxy.

Configure one managed Turnstile widget for these production hosts:
researchvaultagent.ir, www.researchvaultagent.ir, researchvault-patent.pages.dev.

In the support Worker, set TURNSTILE_SITE_KEY as the public site-key variable and
TURNSTILE_SECRET as an encrypted secret. Keep secret values out of source.
The configuration endpoint exposes only the public key and remains unavailable
until the key, secret, AI and support database are present.

Add SUPPORT_SERVICE as a service binding on the main Pages project, pointing to
the dedicated support Worker's default HTTP handler. The English project's
Wrangler file declares the same binding. Redeploy Pages after dashboard binding
changes. No public Worker route or workers.dev URL is needed.

The model is fixed and has no paid fallback or retry loop. The service reserves
a conservative usage budget before each model call and answers known questions
without model usage. Cloudflare's free AI allowance is account-wide, including
other Workers; the local reservation counter is not an account billing meter.
Use the free plan and verify aggregate usage before increasing limits.

Check the main and English widgets on mobile and desktop, the public config
endpoint, one real anti-bot challenge and one AI reply in each language. Confirm
that article requests and the separate Telegram patent queue continue working.
