# Orchestrator verification

Deploy the helper services before this service so its bindings can resolve.
A successful build confirms deployment only. It does not confirm that database
migrations, authenticated service calls or customer-facing integrations work.

Keep delivery disabled during setup. Verify schema and authenticated runtime
calls separately before enabling any case processing or notifications.
