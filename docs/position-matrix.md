# Position permission matrix

Positions are assigned directly to user accounts, not inferred from employee job titles.
The owner manages positions at `/settings/positions`. The matrix has independent read,
create, edit, delete and approve/post grants. Unsupported actions are disabled. Search and
row/column/bulk selection affect visible services; saving preserves hidden selections.

## Enforcement and compatibility

- New positions start with an enabled, empty matrix (default deny).
- Existing positions and unassigned users retain the previous policy until the owner explicitly
  saves a matrix. A confirmation explains that unchecked grants will be denied. This release does
  not auto-create or assign positions from legacy roles.
- Enabled matrices replace legacy role guards only on explicitly protected service routes.
  Current assignments are loaded from the database for each request.
- Tenant owners and the existing tenant-local super-admin bypass remain. Company scope,
  subscription read-only restrictions, owner-only operations and special unpost/POS grants remain.
- Sensitive personal/payroll field visibility has its own read grant; HR detail routes also require it.
- Creating a document that posts immediately requires both create and approve. Sales-invoice drafts
  and saved journal entries do not require approval. Quotation conversion checks invoice grants too.
- The employee portal uses its separate authentication and is not governed by this user-account matrix.
- Leave-request and station-shift action permissions and user overrides retain their existing separate
  controls below the matrix. Ordinary matrix grants have no user overrides.
- Position deletion is refused while users are assigned. Removing a user from a position explicitly
  restores the previous role policy; assigning another position replaces the old assignment.
- The company picker remains readable as shared navigation metadata. Company mutations are guarded.

## Storage and remaining separate work

Existing PositionPermission rows store `matrix:<resourceId>` grants plus an activation marker.
An atomic transaction replaces matrix rows without deleting special permission rows.
No database schema change or live permission update is required by deployment.

The station/branch data-scope model and legacy-role automatic migration discussed in
`permissions-and-history-decisions.md` are not implemented by this change. Existing company scopes
continue to apply; this matrix must not be presented as station/branch isolation.

## Validation

Targeted server tests cover independent grants, posting, stale assignment, tenant isolation,
legacy compatibility, HR redaction, validation, transactional saves and route coverage.
The mocked browser test covers saving, preserving filtered selections, direct user assignment,
and mobile layout. No production accounts or documents are changed by these tests.
