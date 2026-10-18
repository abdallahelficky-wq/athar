# Qoyod journal integration — Armi

Rollout is restricted to company `cmsrciyjv000ge8f57p2azqdd`, and requires its tenant owner and company scope. Disabled by default; migration sends nothing. Settings are in Company Settings and accept an API key over the authenticated HTTPS API. The key is encrypted using the existing AES-GCM secret box; no plaintext key is returned or logged. The existing `ZATCA_ENCRYPTION_KEY` must be available.

The company owner saves account-ID mappings and optional customer/vendor contact-ID mappings. Save verifies IDs against the destination's read APIs. No automatic account/customer/vendor creation. Account IDs are not account codes. No production API key or accounting contents were accessed during development.

After enabling, a database trigger queues future transitions to posted (manual, bulk, or transaction-generated journals) in the financial transaction itself. Historical posted journals are not backfilled. Only journal entries are exported; no invoices and no ZATCA submission. The worker runs every five seconds, validates the SAR entry and exact decimal balance, and blocks incomplete mappings. Amounts and parties are preserved. Branches, cost centers and other analytic dimensions have no documented target in this API and are not synchronized.

Each source entry has one unique outbox row. A locked transaction captures its payload and marks it sending before POST. The financial transaction never depends on network availability. Exported/sending/uncertain entries and their lines are immutable; corrections require reversing entries. Blocked rows can be retried after correction. Concurrent workers recheck state after locking the journal and connection.

Transport errors, 5xx, timeouts or malformed success responses are uncertain, never blindly retried. Interrupted sending becomes uncertain after two minutes. Review Qoyod by the `[ATHAR:companyId:entryId]` description marker before any operational recovery; there is intentionally no force-resend button. This avoids claiming exactly-once delivery from a remote API with no documented idempotency key. The key cannot be replaced once any job exists to prevent sending retries to a different destination.

Official contract inspected 2026-10-15: https://apidoc.qoyod.com/ — published collection `RzZ6HLRA`, Create a journal entry: POST `/2.0/journal_entries`, wrapper `journal_entry`, `date`, `description`, `debit_amounts` and `credit_amounts` with `account_id`, `amount`, optional `contact_id` and `comment`; response contains `id`.

Activation requires owner-provided Qoyod API key and reviewed mappings. A real end-to-end transfer cannot be verified until these are supplied through the settings UI.
