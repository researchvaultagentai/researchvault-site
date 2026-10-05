# ResearchVault Patent API

Independent Cloudflare Worker for the patent portal. It does not share D1, R2, or secrets with the paper-delivery bot.

## Security model
- D1 stores metadata, workflow, invoices, signatures, deadlines, meetings, messages, and append-only event hashes.
- R2 bucket is private. User uploads enter `quarantine/` and are never served inline.
- A patent document becomes downloadable to the client only after admin approval.
- Session cookies are HttpOnly + SameSite=Strict and Secure in production.
- OTP codes are HMAC-hashed, single-use, rate-limited, attempt-limited, and expiring.
- Admin authorization is allow-list based in the app; production should additionally protect `/patent/admin` with Cloudflare Access + MFA.
- Never commit `.dev.vars`, credentials, client files, reports, WIPO credentials, or payment secrets.

## Free OTP default
There is no reliable production SMS API with a permanent free tier. The implementation therefore defaults to email OTP using a free transactional-email tier. Telegram OTP is also supported after linking a chat ID. SMS stays disabled until a real provider is configured.

For local development set `OTP_PROVIDER=dev`; the request endpoint returns the code only when `ENVIRONMENT != production`.

## Provisioning
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create researchvault-patent-db`
4. Put the returned D1 id in `wrangler.toml`.
5. `npx wrangler r2 bucket create researchvault-patent-private`
6. `npx wrangler d1 migrations apply researchvault-patent-db --remote`
7. Add secrets with `npx wrangler secret put ...`.
8. Deploy with `npx wrangler deploy`.

## Payment model
Invoices are dynamic; percentages are not hard-coded. Manual settlement is fully supported. Provider adapters are modeled for ZarinPal, Wise, PayPal and USDT. ZarinPal remains disabled until merchant configuration and callback verification are completed.
