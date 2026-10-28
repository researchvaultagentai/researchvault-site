# Orchestrator verification

Deploy the helper services before this service so its bindings can resolve.
A successful build confirms deployment only. It does not confirm that database
migrations, authenticated service calls or customer-facing integrations work.

Keep delivery disabled during setup. Verify schema and authenticated runtime
calls separately before enabling any case processing or notifications.

`PatentQueueView` is a separate read-only RPC role for the Telegram case overview.
It lists all portal cases, including draft/onboarding, suspended and closed cases,
alongside bridge-only records. The portal stage and processing phase are separate.
It returns bounded case identifiers, public references, titles, recorded report
language/revision, timestamps and a next-action code. Missing processing records
are explicitly labelled; listing a case never submits it or initializes a run.
Pagination has a total count and does not hide unsubmitted/finalized cases. The
actionable `PatentAdminControl.queue` remains submitted-only and unchanged.
The inventory uses SELECTs only and needs no schema migration. It cannot
approve stages, trigger execution or retrieve documents, hashes or passwords.
Provide `PATENT_ADMIN_IDS` as an operator-managed secret; no identifier is baked
into source or overwritten by a plaintext `vars` default. Missing configuration
denies access. A Telegram caller must also verify the webhook secret and private
administrator identity before using this binding.

For dashboard-only setup on a database where all three bridge tables are absent,
use `../../setup/dashboard-bootstrap.sql`. It creates the final schema and records
the two migration filenames in Wrangler's default `d1_migrations` table, preserving
other receipts. Its final result must show three bridge tables and two receipts.
Repeating a successful initial setup preserves data; it is not an upgrade script
for a partial or older schema. Do not replay the individual ALTER migration after
using this bootstrap. Runtime adapters still require review and separate testing.
