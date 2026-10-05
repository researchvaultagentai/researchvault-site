#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "1) npx wrangler login"
echo "2) npx wrangler d1 create researchvault-patent-db"
echo "3) Copy database_id into wrangler.toml"
echo "4) npx wrangler r2 bucket create researchvault-patent-private"
echo "5) npx wrangler d1 migrations apply researchvault-patent-db --remote"
for s in OTP_PEPPER SESSION_PEPPER EVIDENCE_HMAC_SECRET RESEND_API_KEY; do echo "6) npx wrangler secret put $s"; done
echo "7) npx wrangler deploy"
