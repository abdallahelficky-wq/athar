# Independent company separation — implementation in progress

Administrator confirmed by the owner: `asf@tismpro.sa`.
Source tenant: `cmsrchwg90009e8f5fmj3v59l`, code `1000005`.

## Production read-only preflight (2026-10-08)

Only identifiers, relationship counts and permission metadata were read. No document contents or financial amounts were inspected.

| Company | Existing company ID | Existing scoped memberships |
| --- | --- | --- |
| Armi | cmsrciyjv000ge8f57p2azqdd | 2 accountants |
| Tism Pro | cmuhc8l5t00f4qjb6uoe4vxx8 | 1 accountant |
| Qas Service | cmuttoi4d000cd4o74anj3ibr | none |

One shared administrator membership: `cmsrchxbb000be8f5jibbjmzn`.
No intercompany account links, mirror entry pointers or cross-company reversals appeared in the initial inventory.
There is one shared position and two job titles. No group-wide report schedules.
Attachment types present: company, purchase_invoice, journal_entry, station_shift_reading.

## Implemented locally

- Authenticated `/auth/accounts` derives identity from the current accepted active membership, and exposes only that identity's accepted active memberships with tenant codes.
- Independent account selection from the user menu, using the existing server-side switch and a full document replacement. Unsaved forms block switching.
- Unit tests check membership scope, response allowlist and rejected inactive/missing users.
- Both SQL inventory queries were exercised against synthetic PostgreSQL (PGlite) fixtures including identically named companies belonging to different tenants.

## Remaining — do not treat the transfer as done

No production writes, new tenant creation or membership reassignment has occurred.
No final cutover script exists yet. Before cutover:

1. Implement/test an atomic relocation preserving company IDs, document IDs, ZATCA state/credentials and object keys.
2. Move tenant-scoped children without companyId via their parent (InvoiceEmailLog, ItemComponent, LeaveSettlement, EmployeePayrollComponent, HrAction, Attachment), and test missing/foreign-parent refusal.
3. Clone the administrator membership per target; move scoped accountants only with their existing permissions. Map positions/job titles and historical user references without broadening access.
4. Preserve audit history. Detect unsupported or cross-company relationships rather than silently dropping them. Test original, mirror, reversal and reversed-mirror cases.
5. Make stale JWTs and refresh tokens fail after membership relocation. Existing authenticate checks signature only, so merely moving a user or revoking refresh tokens is insufficient.
6. Verify one-company creation policy, all-company reports and account-switch isolation across tabs and requests, then deploy and perform a controlled cutover with rollback and metadata-only postchecks.

The picker is a prerequisite, not evidence of completed company isolation.

## Update 2026-10-08 — implementation and local verification

- Added live membership checks to normal and employee portal authentication. Old claims fail after a tenant/scope move. Signed-token middleware tests cover both paths.
- Added cross-tab session reload and independent-company default; company-scoped users cannot add another company into their current tenant.
- Added `scripts/ops/separate-armi-companies.sql`, an explicit, atomic, user-authorized relocation (not an automatically executed Prisma migration). It preserves IDs/object keys, derives ownership from actual FK metadata, clones positions/admin membership, and revokes refresh tokens. Any unknown or conflicting ownership aborts.
- Added a read-only ownership preflight using temporary session tables, with public tables accessed inside a read-only transaction.
- Actual SQL tested against the complete generated Prisma schema including unrelated tenants with identical company names and different synthetic amounts. Success preserves amounts, permissions and attachments. Unknown attachments, cross-company/foreign account parents, mirrors, cross-company reversals and reversed mirrors all abort with no persistent move.
- 72 focused authentication/route tests passed; TypeScript and frontend build passed. Broad local suite has environment/dependency failures (including missing OpenSSL); CI remains required.
- Merged current production into this branch. Re-tested SQL after the schema update.

Still pending: live ownership preflight, CI/deployment, final operational verification and production cutover. Production separation has NOT happened. The earlier 'no cutover script exists' statement is superseded by this update.

## Update 2026-10-11 — preflight blockers resolved in code, deployment pending

- Production ownership preflight stopped on two orphan journal attachments. No production public-table writes occurred. A metadata-only audit lookup found no ownership evidence.
- Retain exactly those verified orphan records unchanged in their existing tenant; do not guess an owner or delete files. Any unrecognized orphan still aborts. Attachment access now requires an existing parent in the current tenant, including all-scope administrators, before listing/signing/uploading/deleting.
- Immutable ZATCA archive rows are excluded from tenantId updates, retaining historical provenance. Export joins current company ownership in the same SQL query so former tenants cannot access relocated company archives. Archive triggers remain enabled.
- Eight attachment handler tests passed. Local cutover tests pass with the actual archive immutability trigger installed, unchanged archive/orphan rows, unrelated-tenant isolation, permission preservation, and rollback for eight invalid relationship cases.
- Targeted metadata queries moved into scripts/sql/company-separation/ with dedicated CI coverage; these are not generic financial reports. CI also runs the actual cutover in isolated PGlite databases.
- Added a real signed-document integration test for archive export after company relocation; CI validation remains pending.
- Production separation is NOT complete. Deploy all access guards and obtain passing live preflight before running the cutover transaction.
