# Orchestrator verification

Deploy the helper services before this service so its bindings can resolve.
A successful build confirms deployment only. It does not confirm that database
migrations, authenticated service calls or customer-facing integrations work.

Keep delivery disabled during setup. Verify schema and authenticated runtime
calls separately before enabling any case processing or notifications.

For dashboard-only setup on a database where all three bridge tables are absent,
use `../../setup/dashboard-bootstrap.sql`. It creates the final schema and records
the two migration filenames in Wrangler's default `d1_migrations` table, preserving
other receipts. Its final result must show three bridge tables and two receipts.
Repeating a successful initial setup preserves data; it is not an upgrade script
for a partial or older schema. Do not replay the individual ALTER migration after
using this bootstrap. Runtime adapters still require review and separate testing.
