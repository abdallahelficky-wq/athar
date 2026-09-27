# Permissions and record history: decisions for the later design

These were decided on 2026-09-27, before the position permission matrix and the record-history table
were built. They're recorded here so the later work starts from them. None of them is built yet.

## 1. Reading a record's history needs the same permission as reading the record

A history tab is a second way into the data it describes. For example, an employee's history carries
old and new salary values, so an unguarded history tab would get around the salary restriction.

- The history endpoint for any entity runs the **same** permission check as that entity's read endpoint.
- Where an entity's fields are filtered by permission (like the employee list, which gives non-HR roles
  identifying fields only), its history is filtered the same way: old and new values for fields the
  reader can't see are left out, not just hidden in the UI.

## 2. Positions need a data scope, not only actions

A matrix of services × actions isn't enough. A position also needs to be limited to specific
**stations** and **branches**. A worker at one station must not be able to read another station's
readings.

- The scope is part of the position (a list of cost centers or stations, and branches), alongside the grants.
- It's applied on the server to reads and writes alike, the same way company scope is applied today
  (`enforceCompanyScope` / `assertRecordCompanyScope`).

## 3. Retention: six years from the document date, whatever the subscription status

For any tenant with posted documents, their history and attachments are kept **six years from the
document date**, regardless of subscription status (trial, cancelled or suspended). No route deletes
them before then. The deletion procedure that runs after the retention period is still to be designed.
Until it exists, no route deletes a tenant.

**What we found about the ZATCA archive (checked on 2026-09-27):**

- **The signed invoice XML isn't stored anywhere.** `SalesInvoice`, `SalesReturn` and `SalesDebitNote`
  have `xmlAttachmentId` and `pdfAttachmentId` columns, but no code ever sets them. The XML is rebuilt
  from the stored invoice data when it's needed (`rebuilt.xml` in `salesInvoices.service.ts`), and the
  PDF/A-3 is generated on demand.
- **The cleared XML that ZATCA returns for standard invoices (`clearedInvoice`) is discarded.** It's
  checked against the expected response shape (`apiClient.ts`) and then dropped.
- **`Attachment` holds only user uploads.** It has no `companyId`: rows point at their record through
  the free-form `entityType` / `entityId` pair. Scoping attachments to a company therefore means
  looking up each attachment's record, and adding a `companyId` column would need a backfill done the
  same way.

So the six-year rule can't be applied to a ZATCA archive yet, because none exists. Building the archive
(storing the signed XML, and ZATCA's cleared XML for standard invoices, as immutable per-company
records at the moment of submission) comes before, or together with, the retention procedure.

## 4. No ready-made position templates in the UI

During migration, positions **are** generated from today's roles (admin, finance manager, accountant,
HR manager, viewer), so that nobody loses or gains access when enforcement moves to positions. Those
generated positions are needed.

What isn't wanted is a "pick a template" chooser in the Positions screen. Owners build positions from
the matrix itself, using the select-all controls for a row, a column or the whole matrix.

## 5. On the list: rename `super_admin`

`super_admin` is a role on a user inside a tenant, granted at registration only to one hard-coded email
(`OWNER_EMAIL` in `auth.service.ts`), that bypasses every role, position and permission check in the
tenants that email belongs to. It has no platform authority: platform administration uses the separate
service secret (`authenticatePlatformService`). Its name led both the owner and the assistant to misread
it as "every tenant owner" in the same week. The comments were corrected in #111; the rename itself (a
`UserRole` enum value, every role check, and the frontend) is still to do, as its own change.
