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
