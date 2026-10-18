# Deploy the four private patent Workers through GitHub

This is an alternative to signing in through the chat browser. It uses the official
Cloudflare CI authentication method. It does not sign the assistant into the dashboard.

## Current status

The workflow and inactive request are prepared. No Cloudflare credentials have been
read or saved in source. No Worker deployment or database migration has been run.
The existing Cloudflare Pages GitHub connection is separate and remains as configured.

The preparation workflow tests the code, validates the four fixed targets and runs
Wrangler's dry-run build without Cloudflare secrets. Real deployment requires a
separate activation commit and the two new repository secrets below. A failed build
blocks deployment. The branch must remain `feature/patent-work-connection-prep`.

## One-time setup by the account owner

1. In Cloudflare, create an account-owned API token for the ResearchVault account.
   To create Workers that do not yet exist, Cloudflare requires Workers product
   `Admin`. Per-Worker `Editor` cannot create a missing Worker. Scope the initial
   token to this account, use a short expiry, and grant only the products needed.
   The first creation of `researchvault-support-db` also needs D1 creation permission.
   Do not add zones, DNS, Pages, billing, Telegram credentials, R2 or the global API key.
2. In GitHub, open this repository's **Settings > Secrets and variables > Actions**.
   Add these **repository secrets** (the values are entered only in GitHub):
   - `RV_PATENT_CLOUDFLARE_API_TOKEN`: the new token.
   - `RV_PATENT_CLOUDFLARE_ACCOUNT_ID`: the ResearchVault account ID.
   These are new, separate names; do not rename or replace article-bot secrets.
3. Tell the maintainer only that the two secrets are saved. Never send their values
   in chat, issues, commits, screenshots or logs.

A token is privileged even though the deployment script has fixed targets. After the
initial creation, record the support database ID in its dedicated config and replace
or revoke the temporary creation token. Subsequent tokens can use `Editor` scoped to
only the four existing Workers. Binding an existing resource does not by itself
require direct access to its data. Any later SQL migration is separate reviewed work.

## Explicit activation

The workflow initially sees `action: none` and cannot deploy. After source review and
secret setup, create a **separate commit changing only**
`patent-work-bridge/deploy-request.json`:

```json
{
  "schemaVersion": 1,
  "action": "deploy-four-private-patent-workers",
  "sourceCommit": "THE_EXACT_REVIEWED_40_CHARACTER_PARENT_COMMIT"
}
```

A push of that file on the preparation branch starts GitHub Actions. The guard rejects
another repository/branch, an unknown target/action, a source hash different from the
parent, or any source/workflow change bundled into activation. No `main` merge is
required for this push trigger. GitHub's manual Run workflow button normally requires
the workflow to be on the default branch; do not merge solely to get that button.

The deployment job receives the two secrets only for its final step, checks the
reviewed account, and calls the existing allowlisted deploy script, helpers first:

1. `researchvault-patent-work`
2. `researchvault-patent-notifications`
3. `researchvault-support`
4. `researchvault-patent-orchestrator`

All four start private, without workers.dev, preview URLs, routes, schedules or
outbound delivery. The guard checks those conditions. The initial support D1 may be
provisioned by Wrangler; SQL migrations are **not** run. No AI inference, Telegram
send, payment, Work transport or customer delivery is enabled by this job.

The workflow does not deploy Pages or any existing article-bot Worker, replace
webhooks, or upload existing bot secrets. There is no privileged PR trigger.
It is serialized and does not cancel an in-progress deployment. Deployment is not
transactional across all four Workers: a later failure can leave earlier private
helpers deployed. Inspect the run and retry only after resolving the failure.

## Validation limits

Local Node tests and config validation are separate from GitHub-hosted Wrangler
compilation and Cloudflare deployment. Report the actual run status; a prepared
workflow or a green build is not evidence of a successful Cloudflare deployment.
Dependency installation pins Wrangler to the verified official release `4.147.0`.
GitHub's checkout/setup-node actions are pinned to their verified commit SHAs.

References checked 2026-10-19:
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
