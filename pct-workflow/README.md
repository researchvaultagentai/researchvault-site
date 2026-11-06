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

With a sibling checkout of the bot's PCT branch, pass `PCT_BOT_ADMIN_MODULE=../researchvault-bot/src/pct-admin.js` to the same `npm test --prefix pct-workflow` command. The bot adapter then submits a real case decision against the local Worker with Telegram delivery intercepted.

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
4. Deploy the Worker with `PCT_ENABLED` off. Bind it as `PCT_WORKFLOW` in the international Pages production environment. Confirm the currently connected patent account Worker still resolves first-party email sessions. In the Telegram Worker, bind the same private service as `PCT_WORKFLOW`, preserve its already verified webhook configuration, set `PCT_WORKFLOW_ENABLED=true`, and restrict `PCT_TELEGRAM_ADMIN_IDS` on the PCT Worker to the administrator. The existing bot checks the notice queue on its three-minute schedule and sends with its configured `TELEGRAM_BOT_TOKEN`. Older case listing continues to work. A separate token on the private PCT Worker is unnecessary for this setup.
5. Optionally enable classic email/password with `PCT_PASSWORD_ENABLED=true` and a separate long `PCT_AUTH_PEPPER` secret. Create a Google Web OAuth client, add the exact redirect URI `https://researchvault-patent.pages.dev/api/pct/auth/google/callback`, and configure `PCT_GOOGLE_CLIENT_ID` and `PCT_GOOGLE_CLIENT_SECRET`. Google buttons appear after configuration. Test provider callback and CPU/billing limits on the current plan before enabling optional methods. The email code remains available.
6. Verify the new site, private agreement and restricted bot access using test identities in a separate environment. Enable `PCT_ENABLED=true` on the private Worker only when bindings and the signed documents are ready. The English home then directs new clients to the new portal. Turning it off restores the old entry links; if real cases have been opened, preserve access and the database during any rollback.

Update the existing private release with the same Wrangler login. The helper checks the active private Worker and confirms enrollment is closed through the authenticated Cloudflare API. Your computer does not need to reach the public Pages hostname for this step. Do not rerun `bootstrap`:

```bash
(
  read -rp 'Telegram administrator ID: ' pct_admin
  PCT_TELEGRAM_ADMIN_ID="$pct_admin" node pct-workflow/scripts/release.mjs connect-admin ../rv-pct-private-release
)
```

This preserves the existing encryption and storage keys and keeps enrollment closed. In the private admin chat, **Patent Queue → Select a PCT case** then confirms the connection and shows case status while closed. Regular case actions, one-time document links, and notifications become available only when enrollment is enabled. No customer files or payments are needed for this connection check.

### Admin case wipe

With the Telegram administrator already connected and enrollment closed, enable the private wipe controls using the same Wrangler login and release folder:

```bash
node pct-workflow/scripts/release.mjs enable-wipe ../rv-pct-private-release
```

The command applies the additive schema and verifies the active Worker. It does not begin a wipe. From the private Telegram chat, open an individual PCT case, choose **Wipe case**, and confirm the red warning showing its reference. A confirmation expires after five minutes and is bound to that administrator, case and revision. Cancellation invalidates it. Confirmation hides the case from the customer and closes its portal links. If storage is temporarily unavailable or there are more file versions to remove, use **Continue wipe** on that case. The bot reports success only after the case prefix is empty and the database transaction removes the case and its dependent records.

Backblaze requires the scoped private bucket key to have `listFiles` and `deleteFiles`; the warning checks access before freezing the case. The wipe removes older file versions and orphaned uploads under that exact case prefix. Shared legal templates, customer accounts and other cases remain. Only an unlinked payment digest is retained to prevent reusing an already verified transaction. Copies already downloaded, WIPO records, and provider-managed backups are outside the live case wipe.

The preparation and response targets are service estimates, not official PCT time limits. The administrator records actual WIPO documents, client authorization and manual payment confirmations. Formal filings stay in ePCT using official access; no WIPO passwords or automatic filing calls are used.

### Team update targets

Run `node pct-workflow/scripts/release.mjs enable-response-timing ../rv-pct-private-release` to apply the additive response schedule and enable it while keeping enrollment closed and preserving case wipe. The private Telegram bot’s existing notice check claims one reminder per open task beginning 24 hours before its 72-hour update target. Completed actions and removed cases cannot be claimed. If the bot was offline, the next check can still send the reminder while time remains. Overdue actions appear in the portal. Deploy the updated bot before enabling response timing. Customer actions and notices become available when the PCT workflow is opened separately. The client portal distinguishes a communication target from the actual deliverable deadline and from official processing. A substantive update posted in the private case can answer a message or start the next communication window for ongoing team work.
