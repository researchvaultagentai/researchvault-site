# International PCT workflow

This Worker is private and separate from the legacy patent system. The English Pages site uses it through the optional `PCT_WORKFLOW` binding. The Telegram bot exposes its controls under the existing Patent Queue reply. Earlier portal records keep their existing endpoints. The new backend does not modify the existing patent database schema.

## Check the isolated flow

From the repository root:

```sh
npm ci --prefix pct-workflow
npm test --prefix pct-workflow
npm run bundle --prefix pct-workflow
npm test --prefix deploy/patent-en
```

The runtime test uses Workerd, a new local D1 database, local encrypted objects and the existing email OTP logic with delivery intercepted. It creates and uploads a PDF marked “SAMPLE - NOT FOR CLIENT USE” to the test bucket, then downloads and acknowledges that exact version as an authenticated test user. It completes two synthetic cases: online signature and paid completion; uploaded signed copy and waiver. It checks report PDF password protection, gates the editable report, exchanges two numbered Word drafts and an annotated return, confirms an online meeting request, binds final ePCT consent to the package and a fresh OTP, keeps receipts hidden until submission is confirmed, and checks the full numbered Telegram log. Pending payment evidence never unlocks delivery; debt blocks only new cases. Production rejects test-mode and sample-document configurations as well as simulated confirmation. The test uses no live email, filing, Telegram, wallet or PayPal credentials. The account tests also verify password linking and the Google token signature, intended audience and nonce. Google itself needs a configured OAuth client for a real sign-in check.

## First installation with the existing private Backblaze bucket

The installation helper targets only the ResearchVault Cloudflare account, the dedicated `researchvault-pct-workflow-db` database, and a new private Worker named `researchvault-pct-workflow`. It uses the existing Backblaze bucket and requires no R2 subscription. Create a Backblaze **Read and Write** application key for just that private bucket with **File name prefix** `pct-workflow/`. Keep the two key values out of chat and Git.

From a clean checkout, download the approved `Confidentiality_Undertaking.pdf` and `Patent_Agency_Agreement.docx` next to it. Use the Wrangler login on the deployment computer. Run in Git Bash or Bash from the checkout:

```bash
npm ci --prefix pct-workflow --ignore-scripts
node pct-workflow/node_modules/wrangler/bin/wrangler.js whoami
read -rsp 'Backblaze keyID: ' pct_b2_id; printf '\n'
read -rsp 'Backblaze applicationKey: ' pct_b2_key; printf '\n'
B2_KEY_ID="$pct_b2_id" B2_APPLICATION_KEY="$pct_b2_key" \
  node pct-workflow/scripts/release.mjs bootstrap \
    ../Confidentiality_Undertaking.pdf ../Patent_Agency_Agreement.docx ../rv-pct-private-release
unset pct_b2_id pct_b2_key
```

If Wrangler reports you are signed out, run `node pct-workflow/node_modules/wrangler/bin/wrangler.js login` first. `prepare` in place of `bootstrap` only produces the verified local release, without calling either provider. The helper encrypts and verifies both files, checks the Backblaze prefix, uploads and reads back the encrypted bytes, initializes only the dedicated D1 schema, and installs the private Worker **off**. It refuses an existing Worker or legal object at the same version. Preserve the private release folder and encryption key. If installation stopped after `install-started.json`, inspect the stage reached before attempting any repair; do not regenerate the key for existing objects. The ready marker is `install-complete.json`.

## Connect and enable

1. Install the disabled Worker first. If configuring manually, use the dedicated D1 database and binding `PCT_DB` with this directory's migrations only. Do not use production data in the test or Pages preview environment.
2. Configure a scoped private Backblaze bucket key with `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_ID` and `B2_BUCKET_NAME`, or bind a private `PCT_STORE` bucket. Use a dedicated 32-byte hex secret `PCT_FILE_KEY`. Do not set test flags in production.
3. Supply the approved provider-signed undertaking PDF and Word agreement privately. Do not put these files, images, keys or private URLs in Git, build output, or Telegram. Use `node pct-workflow/scripts/pack-private-documents.mjs UNDERTAKING.pdf AGREEMENT.docx PRIVATE_OUTPUT_DIR` with `PCT_FILE_KEY` in the local environment. Upload the **encrypted** files using the object keys in `vars.json` and set its version/hash values on this Worker. Retain all quoted agreement versions. Use a new key path and version for each revision.
4. Deploy the Worker with `PCT_ENABLED` off. Bind it as `PCT_WORKFLOW` in the international Pages production environment. Confirm the currently connected patent account Worker still resolves first-party email sessions. In the Telegram Worker, bind the same private service as `PCT_WORKFLOW`, preserve its already verified webhook configuration, set `PCT_WORKFLOW_ENABLED=true`, and restrict `PCT_TELEGRAM_ADMIN_IDS` on the PCT Worker to the administrator. Older case listing continues to work. Configure `PCT_TELEGRAM_NOTIFY_TOKEN` and `PCT_NOTIFY_CHAT_ID` on the private PCT Worker to deliver notices to the allowlisted administrator. Test mode disables delivery. A cron on this Worker can retry unsent notices if the account has a spare trigger; it is not needed for immediate delivery.
5. Optionally enable classic email/password with `PCT_PASSWORD_ENABLED=true` and a separate long `PCT_AUTH_PEPPER` secret. Create a Google Web OAuth client, add the exact redirect URI `https://researchvault-patent.pages.dev/api/pct/auth/google/callback`, and configure `PCT_GOOGLE_CLIENT_ID` and `PCT_GOOGLE_CLIENT_SECRET`. Google buttons appear after configuration. Test provider callback and CPU/billing limits on the current plan before enabling optional methods. The email code remains available.
6. Verify the new site, private agreement and restricted bot access using test identities in a separate environment. Enable `PCT_ENABLED=true` on the private Worker only when bindings and the signed documents are ready. The English home then directs new clients to the new portal. Turning it off restores the old entry links; if real cases have been opened, preserve access and the database during any rollback.

The preparation and response targets are service estimates, not official PCT time limits. The administrator records actual WIPO documents, client authorization and manual payment confirmations. Formal filings stay in ePCT using official access; no WIPO passwords or automatic filing calls are used.
