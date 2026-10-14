# Bank reconciliation (التسوية البنكية) — design

Status: **design only, nothing implemented.** Built from the code at `production` `706f25a` (2026-10-14). Every phase below (BR1–BR4) is a separate PR. The open owner decisions are in §10; nothing is built until they are answered.

**الملخص:** مطابقة كشف الحساب البنكي مع حساب البنك في دفاتر الشركة داخل أثر نفسه:
- **مدخلات المطابقة:** يُستورد الكشف (Excel/CSV)، وتُقرأ الدفاتر من القيود المرحّلة مباشرة بلا رفع ملف.
- **محرّك الاقتراح:** يقترح المطابقات بالمرجع أولاً، ثم بالمبلغ والتاريخ، ثم المجمّعة، ولا يعتمد شيئاً بلا تأكيد المحاسب.
- **الحركات غير المقيدة:** حركات البنك غير المقيدة (رسوم، عمولات، فوائد) تتحول إلى قيود بضغطة.
- **مذكرة التسوية:** تُحفظ وتُعتمد باسم المعتمد وتاريخه، وتُقفل حركات الفترة المعتمدة فلا تُعدَّل ولا تُحذف.

## 1. What exists today (and what does not)

- **Bank accounts in the books** are posting `Account`s with `isBankOrCash = true`. The flag covers both cash boxes and bank accounts. `Receipt.bankAccountId` points at one of them.
- **`CompanyBankAccount`** holds bank name / account number / IBAN for printing on invoices. It is **not linked** to any GL account.
- **Journal lines** (`JournalEntryLine`) carry `debit`, `credit` and `description`, with `memo`, `date`, `entryNumber`, `status` (`saved` / `posted`) and `sourceModule` on the entry. There is **no cheque or transfer reference field** anywhere.
- **Spreadsheet import precedent:** journal bulk import parses Excel/CSV in the browser (`xlsx` / `exceljs` in `frontend`) and posts JSON rows. The server validates strictly: two explicit date formats, never guessed (`bulkImport.service.ts`).
- **PDF reading:** exists only through Claude (`src/lib/claudeVision.ts`). That is the `ai` module (enterprise) and sends the document to Anthropic.
- **Period protection:** `Company.fiscalYearClosingDate`, plus unpost requiring the unlock PIN.
- **Precedent for a reconciliation screen:** `vatReconciliation` (read-only, every difference itemised).

## 2. Scope

**In scope:**
- reconciling one **bank GL account** of one company against imported statement lines, for a period ending on a statement date;
- matching: one-to-one, many bank lines to one book line, and one bank line to many book lines;
- creating entries for bank-only items;
- the reconciliation statement (مذكرة التسوية), its approval and lock;
- Excel/PDF export of the statement.

**Out of scope (v1):**
- foreign-currency statements: refused if the statement currency differs from the company currency, because journal entries are company currency only;
- live bank feeds or APIs;
- cash-box (صندوق) counts;
- PDF statements (D-BR3).

## 3. Data model (BR1)

All tables carry `tenantId` and `companyId`, so the subscription write guard and tenant isolation cover them with no new code (rule 4). Amounts are `Decimal(18,2)`.

**`BankStatement`** (one imported file, or one manual statement):
- **Bank account:** `glAccountId`, which must be a posting `isBankOrCash` account of the same company (checked by a trigger as well as by code); plus optional `companyBankAccountId`.
- **Period:** `periodStart`, `periodEnd`, `openingBalance?`, `closingBalance`.
- **Source file:** `fileName`, `fileSha256`. A re-import of the same file is refused.
- **Audit fields:** `importedBy`, `createdAt`.

The original file is stored as an `Attachment` (`entityType = "BankStatement"`).

**`BankStatementLine`:**
- **Content:** `statementId`, `date`, `valueDate?`, `description`, `reference?`, `amount` (signed from the account holder's view: deposit `+`, withdrawal `−`), `runningBalance?`.
- **Bookkeeping:** `lineHash` (unique per `glAccountId`, so overlapping statements don't import the same bank line twice), `status` (`unmatched` / `matched` / `excluded`), `excludedReason?`.

**`BankMatch`** (one confirmed match):
- **Fields:** `glAccountId`, `kind` (`one_to_one` / `many_to_one` / `one_to_many`), `method` (`reference` / `amount_date` / `group` / `manual`), `confirmedBy`, `confirmedAt`, `reconciliationId?` (set when an approved reconciliation includes it).
- **Join tables:**
  - `BankMatchStatementLine(matchId, statementLineId UNIQUE)`;
  - `BankMatchBookLine(matchId, journalEntryLineId UNIQUE)`.

  A line can be in at most one match.
- **Invariant:** Σ statement amounts = Σ (book debit − credit), exactly to the halala (D-BR5). It is checked in the service and by a deferred constraint trigger.

**`BankReconciliation`** (the signed statement):
- **Inputs:** `glAccountId`, `statementDate`, `statementBalance`.
- **Computed at approval:** `bookBalance`, outstanding deposits, outstanding withdrawals (cheques), unrecorded bank items and difference. The full itemised `snapshot` JSON is frozen at approval.
- **Workflow:** `status` (`draft` / `approved`), `approvedBy`, `approvedAt`, `version` (same optimistic-concurrency pattern as #166).
- **Approval rule:** approval requires difference = 0.

**New `SourceModule` value:** `bank_reconciliation`, for entries created from bank-only lines (BR3).

## 4. Which book lines take part

- **Lines:** journal lines on `glAccountId` whose entry belongs to the same company (rule 4).
- **Posted entries only** (D-BR2). Saved drafts touching the account are listed separately as a warning ("قيود محفوظة غير مرحّلة تمس حساب البنك"), as `vatReconciliation` does.
- **Signed book amount:** `debit − credit`. A bank deposit (`+`) matches a debit on the bank account; there is no per-file sign toggle.
- **Statement sign:** each file's sign convention is chosen once at import, in the column mapping. Separate debit/credit columns, or a signed amount column with "deposits are positive/negative".

## 5. Matching engine (BR2): suggestions, never silent

The engine is a pure function: (unmatched statement lines, unmatched book lines, settings) → ranked suggestions. **Nothing becomes a match until a user confirms it** (D-BR4). It runs in three passes, and each line is used by at most one suggestion:

1. **Reference.** Same amount, and a normalised reference token appears on both sides: a cheque or transfer number in the statement `reference`/`description` and in the entry `entryNumber`, `memo` or line `description`. Highest confidence.
2. **Amount and date.** Same amount, `|date difference| ≤ window` (default 5 days, per company, D-BR8). A suggestion is made **only when the candidate is unique** on both sides. Two book lines of 18,600 in the window means "ambiguous": no suggestion, both shown side by side for the user.
3. **Group.** Bounded subset-sum, in both directions: a single line on one side whose amount equals the sum of 2 to `k` lines on the other (default `k` = 6, max 10).
   - **Candidates:** lines inside the date window, with the same sign.
   - **Search:** meet-in-the-middle with a hard cap on candidates (30). Too many candidates means no search, and the UI says so.
   - **Ambiguity:** a group is suggested only when it is the **only** subset that fits. Two different subsets with the same sum → ambiguous, shown, not suggested.
   - **Confirmation:** every group needs its own confirmation. There is no "confirm all" for groups.

**"Confirm all"** exists only for pass-1 suggestions and unique pass-2 suggestions. The audit row lists every line confirmed.

**Manual match:** the user ticks lines on both sides; the screen shows the running difference, and **Match** is enabled at difference 0.

## 6. Bank-only lines (BR3)

From an unmatched statement line the user can:
- **Create an entry.** The prefilled entry is bank account ↔ chosen account (bank charges, commission, interest income, a customer, a supplier) with VAT where applicable (fees with VAT 15%).
  - **Posting:** through the normal journal posting service, with numbering, fiscal-closing check, subscription guard and audit log, with `sourceModule = bank_reconciliation` and `sourceId = statementLineId`.
  - **Matching:** the new entry's bank line is matched to the statement line in the same transaction.
- **Match to an existing entry** outside the date window (manual).
- **Exclude** with a required reason, for example a bank error to be corrected by the bank. Exclusions are listed in the reconciliation statement and need approval like everything else.

## 7. Reconciliation statement and lock (BR3)

**For a statement date D**, the statement shows:

| Line | Source |
|---|---|
| Balance per bank at D | entered (or the last statement line's running balance) |
| + Deposits in transit | book debits ≤ D not matched to a statement line ≤ D |
| − Outstanding cheques/withdrawals | book credits ≤ D not matched |
| ± Unrecorded bank items | statement lines ≤ D not matched and not excluded |
| = Adjusted bank balance | |
| Balance per books at D | Σ posted lines on the account ≤ D |
| Difference | must be 0 to approve |

**Approve** (permission `bankReconciliation/approve`):
- freezes the snapshot;
- stamps every match whose lines are all dated ≤ D with `reconciliationId`;
- writes an audit row.

**Lock (D-BR6):** a journal line that belongs to a match of an approved reconciliation cannot be edited, deleted or unposted. A guard sits in the journal service paths (`update`, `deleteJournalEntry`, `unpostJournalEntry`), plus a database trigger as the backstop. Reversal stays allowed: it creates a new dated entry, which shows up in the next period.

**Reopen:** the latest approved reconciliation of an account can be reopened by an admin/owner with a reason. This is audit-logged, clears the stamps, and sets the status back to draft. Earlier ones cannot be reopened while a later one is approved.

**Export:** Excel (all sections and items) and PDF (the statement, with approver and date).

## 8. Controls (CLAUDE.md rules)

**Rule 1 — mirror and reversal:**
- **Mirror.** A mirror entry lives in another company. Matching is per company and per GL account of that company, so a mirror half can only be matched on a bank account of its own company. Neither the import nor the matching reads across companies. Test: a match request naming a line of another company is refused, even within the same tenant.
- **Reversal of a matched entry.**
  - *Not approved yet:* the reversal entry is just another book line. The original stays matched to its statement line, and the reversal shows as an unmatched book line.
  - *Approved:* the original is locked (§7); reversing it is allowed and lands as a new unmatched line.

  Tests for both.
- **Reversal of a mirror entry** whose half is matched in the other company: the same rules apply in each company separately. The unpost of a mirror pair is refused if either half is in an approved reconciliation. The guard checks both halves, as #163's backstop does.

**Rule 2:**
- **Book side:** always produced by the real posting paths over HTTP.
- **Statement side:** an external upload, so hand-built CSV/XLSX test files are allowed. Each test documents the bank layout it imitates.

**Rule 4:**
- every query is keyed by `tenantId` and `companyId`;
- the GL account trigger enforces same company;
- no endpoint accepts a line id without checking its company.

**Subscription enforcement:**
- **Write routes:** new resource `bankReconciliation` in `POSITION_RESOURCES` with actions `read`, `create`, `edit`, `delete`, `approve`. It is mapped in `subscriptionPlans.ts` to the **basic** plan (D-BR7), and every write route carries it (the coverage test enforces this).
- **`:id` routes:** `RECORD_TABLES` gets the statement/reconciliation tables for the `:id` routes.

## 9. Phases

| Phase | Content | Depends on |
|---|---|---|
| **BR1** | Tables + triggers; link `CompanyBankAccount` → GL account (D-BR1); statement import (Excel/CSV, column mapping saved per bank account, date format explicit, sign convention, duplicate detection); statement list; manual matching; unmatched lists on both sides; saved-draft warning | decisions D-BR1, D-BR2, D-BR5 |
| **BR2** | Matching engine (§5) with confirm / confirm-all; ambiguity display; per-company settings (window, group size) | BR1, D-BR4, D-BR8 |
| **BR3** | Entries from bank-only lines; exclusions; reconciliation statement; approve / lock / reopen; Excel/PDF export | BR2, D-BR6 |
| **BR4** (optional) | PDF statements | D-BR3 |

Each phase gets its own tests, mutation checks, and the fresh-database run with the subscription switch OFF and ON.

## 10. Decisions needed from the owner

| # | Question | Recommendation |
|---|---|---|
| D-BR1 | What is reconciled: the GL bank account, with `CompanyBankAccount` linked to it? | Yes. Add `glAccountId` to `CompanyBankAccount` (optional link), and reconcile per GL account. Split `isBankOrCash` later only if needed. |
| D-BR2 | Book side: posted entries only? | Yes. Saved drafts shown as a warning, not matched. |
| D-BR3 | PDF statements in v1? | No. Saudi banks export Excel/CSV. PDF later, and only through the AI module (enterprise), with explicit consent that the file goes to Anthropic. |
| D-BR4 | Auto-matching: confirm each, or "confirm all" for exact unique matches? | Confirm-all for reference matches and unique amount+date; groups always one by one. |
| D-BR5 | Amount tolerance? | Exact to the halala. Any difference becomes an entry (fees) or stays visible. |
| D-BR6 | Lock after approval (no edit/delete/unpost of reconciled lines; reopen by admin with reason)? | Yes. |
| D-BR7 | Plan tier? | Basic: bank reconciliation is core accounting. |
| D-BR8 | Default date window and max group size? | 5 days, 6 lines, configurable per company. |
