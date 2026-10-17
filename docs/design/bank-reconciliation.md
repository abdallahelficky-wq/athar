# Bank reconciliation (التسوية البنكية) — design

Status: **design only, nothing implemented.** Built from the code at `production` `706f25a` (2026-10-14). The owner's decisions of 2026-10-15 and the review of #167 are folded in as D-BR1–D-BR17 (§10). No open questions remain. Each phase (BR1–BR4, §9) is a separate PR.

**الملخص:** مطابقة كشف الحساب البنكي مع حساب البنك في دفاتر الشركة داخل أثر.

**المدخلات:**
- يُستورد الكشف (Excel/CSV) بفحص سلامة الأرصدة.
- يُمنع التكرار دون إسقاط حركات حقيقية متطابقة.
- تُقرأ الدفاتر من القيود المرحّلة مباشرة.

**الاقتراح والتأكيد:**
- المحرّك يقترح ولا يعتمد شيئاً بلا تأكيد المحاسب.
- أي التباس، بالمرجع أو بالمبلغ أو بالمجموعة، يُعرض ولا يُقترح.

**رسوم البنك:**
- تُسجَّل كفاتورة مشتريات من البنك بضريبة مدخلات 15%، فتدخل الإقرار.
- البنك الذي يعرض الرسم وضريبته في سطرين يُطابَق السطران مع قيد واحد.

**نقطة البدء والاعتماد:**
- لكل حساب نقطة بدء برصيد افتتاحي وبنود معلّقة افتتاحية.
- تُعتمد مذكرة التسوية بفرق صفر، وتُقفل بنودها.
- لا تعيد تسوية لاحقة تخصيص بنود تسوية سابقة.

## 1. What exists today (and what does not)

- **Bank accounts in the books** are posting `Account`s with `isBankOrCash = true`, a flag shared by cash boxes and bank accounts. `Receipt.bankAccountId` points at one of them.
- **`CompanyBankAccount`** (bank name / account number / IBAN for printing on invoices) is **not linked** to any GL account.
- **Journal lines** carry `debit`, `credit` and `description`; the entry carries `memo`, `date`, `entryNumber`, `status` (`saved` / `posted`) and `sourceModule`. There is **no cheque or transfer reference field**.
- **The VAT return does not read the VAT account.** Input VAT (`purchaseReports.getPurchasesVatSummary`) is the sum of posted **purchase documents** (`PurchaseInvoice` − `PurchaseReturn`, `vatTotal`).
  - A manual journal line on the input-VAT account never reaches the return.
  - `vatReconciliation` lists it as a difference ("قيود يدوية تمس حساب الضريبة").
  - `PurchaseInvoice` is on credit (supplier payable); it has no payment method of its own.
- **Spreadsheet import precedent:** journal bulk import parses Excel/CSV in the browser (`xlsx` / `exceljs`) and posts JSON rows. The server validates strictly: two explicit date formats, never guessed.
- **PDF reading:** exists only through Claude (`src/lib/claudeVision.ts`, the `ai` module, enterprise). It sends the file to Anthropic.
- **Attachments:**
  - entity types are an allow-list (`attachmentEntityTypeEnum`);
  - company access is resolved per type in `attachments.controller.ts` (`assertEntityCompanyAccess`);
  - the subscription guard maps each type to its model in `ATTACHMENT_ENTITY_MODELS` (`subscriptionWriteGuard.ts`).
- **Currency:** `Company.currency` (default `SAR`). Journal entries are in the company currency only; `Branch.currency` is display-only.

## 2. Scope

**In scope:**
- reconciling one **bank GL account** of one company against imported statement lines, up to a statement date;
- one-to-one, many-to-one and one-to-many matches;
- entries for bank-only lines (bank fees with VAT through a purchase document);
- the go-live starting point per account;
- the reconciliation statement, its approval, lock and reopen;
- Excel/PDF export.

**Out of scope (v1):**
- accounts whose currency differs from the company currency (D-BR17);
- live bank feeds;
- cash-box counts;
- PDF statements (D-BR3).

## 3. Data model (BR1)

All tables carry `tenantId` and `companyId`, so the subscription write guard and tenant isolation cover them (rule 4). Amounts are `Decimal(18,2)`.

**Bank account link (D-BR1):**
- **`CompanyBankAccount` gains:**
  - `glAccountId?` (unique per company): a posting `isBankOrCash` account of the same company, checked by a trigger;
  - `currency` (default: the company currency);
  - `feeSupplierId?`: the bank as a `Supplier`, with its VAT number, for fee invoices (D-BR14);
  - matching settings `amountDateWindowDays` (5), `referenceWindowDays` (60) and `maxGroupLines` (6) (D-BR8).
- **Reconciliation is per linked GL account.** A GL account with no `CompanyBankAccount` link cannot be reconciled; the screen offers to create the link.

**`BankReconciliationStart`** (one per bank account, the go-live point, D-BR15):
- `startDate` G and `statementBalanceAtStart`;
- `approvedBy` / `approvedAt`.

**`BankOpeningItem`** (book-side items outstanding at G, for example uncleared cheques):
- `startId`, `date ≤ G`, `description`, `reference?`, `amount` (signed: `+` deposit in transit, `−` uncleared cheque).
- Opening items take part in matching exactly like book lines. They are created and edited only while the start is not approved.

**`BankStatement`** (one import):
- **Bank account and period:** `companyBankAccountId`, `periodStart`, `periodEnd`, `openingBalance?`, `closingBalance?`, `currency`.
- **Source file:** `fileName`, `fileSha256` (an identical file is refused outright).
- **Mapping and audit:** the column mapping used, `importedBy`, `createdAt`.
- **Integrity:** `integrity` (`balanced` / `no_balances`), D-BR16.
- **Original file:** stored as an attachment of type `bank_statement` (D-BR13).

**`BankStatementLine`:**
- **Content:** `statementId`, `date`, `valueDate?`, `description`, `reference?`, `bankTransactionId?`, `amount` (signed: deposit `+`), `runningBalance?`.
- **Identity:** `occurrence` (D-BR11).
- **State:** `status` (`unmatched` / `matched` / `excluded`), `excludedReason?`.

**`BankMatch`** (one confirmed match):
- **Fields:**
  - `companyBankAccountId`;
  - `kind` (`one_to_one` / `many_to_one` / `one_to_many`) and `method` (`reference` / `amount_date` / `group` / `manual` / `fee_entry`);
  - `confirmedBy`, `confirmedAt`.
- **Join tables:**
  - `BankMatchStatementLine(matchId, statementLineId UNIQUE)`;
  - `BankMatchBookLine(matchId, journalEntryLineId UNIQUE NULL, openingItemId UNIQUE NULL)`, with exactly one of the two set.

  A line belongs to at most one match.
- **Invariant:** Σ statement amounts = Σ book amounts, exactly to the halala (D-BR5). It is checked in the service and by a deferred constraint trigger.

**`BankReconciliation`** (the statement):
- **Inputs:** `companyBankAccountId`, `statementDate` D, `statementBalance`.
- **Computed at approval:** the §7 figures and the itemised `snapshot`.
- **Workflow:** `status` (`draft` / `approved`), `approvedBy`, `approvedAt`, `version` (optimistic concurrency as in #166).
- **Membership** of matches and excluded lines is the separate table below (D-BR9).

**`BankReconciliationItem`** `(reconciliationId, matchId UNIQUE NULL, excludedLineId UNIQUE NULL)`:
- written once, at approval;
- the `UNIQUE` means a match or exclusion belongs to **exactly one** approved reconciliation, ever.

**New `SourceModule` value:** `bank_reconciliation`.

## 4. Which book lines take part

- **Lines:** posted journal lines (D-BR2) on the linked GL account, of entries in the same company, dated **after** the start date G. Plus the start's `BankOpeningItem`s.
- **Before G:** lines dated ≤ G are summarised by the start (§7.1) and are never candidates.
- **Saved drafts** touching the account are listed as a warning, never matched.
- **Book amount** = `debit − credit`. A bank deposit (`+`) matches a debit on the bank account.
- **Statement sign:** set once per file in the column mapping. Either separate debit/credit columns, or one signed column with an explicit "deposits are positive/negative" choice.

## 5. Import, integrity and duplicates (BR1)

### 5.1 Parsing
- The browser parses Excel/CSV and the user maps columns: date, value date, description, reference, bank transaction ID, debit/credit or signed amount, running balance.
- **Mapping:** saved per bank account and reused on the next file.
- **Dates:** the date format is chosen explicitly (`YYYY-MM-DD` or `DD/MM/YYYY`) and never guessed, like bulk import.
- **Currency:** the user confirms the file's currency; it must equal the bank account's currency (D-BR17).
- **Server-side validation:** every row is checked again on the server.

### 5.2 Integrity (D-BR16)

**When the file has balances** (opening/closing in the header, or a running-balance column):
- opening + Σ movements must equal closing, to the halala;
- with running balances, each row's balance must equal the previous balance + its amount;
- any mismatch **refuses the whole import** and names the first failing row;
- the statement is stored as `balanced`.

**When the file has no balances at all:**
- the import is allowed with a warning;
- the statement is stored as `no_balances`;
- the user must enter the bank balance at D by hand when reconciling.

**Continuity (`balanced` statements only):** if the new file's period starts the day after the last imported statement ends, its opening balance must equal that statement's closing balance. Otherwise the import is refused, because a gap or a wrong file would break every later reconciliation.

### 5.3 Duplicates without losing genuine repeats (D-BR11)

**An identical file** (same SHA-256) is refused.

**With a bank transaction ID mapped**, identity is `(companyBankAccountId, bankTransactionId)`, unique:
- a row whose ID already exists with the same content is **skipped** (overlap);
- a row whose ID exists with **different** content refuses the import.

**Without transaction IDs**, identity is by occurrence:
- **Content key:** `(date, amount, normalised description, reference, runningBalance)`. `runningBalance` is part of the key when present, which already separates two identical fees on the same day.
- **Occurrence number:** within one file, rows with the same key are numbered 1, 2, 3… in file order. Two identical bank fees on one day are two rows: occurrence 1 and occurrence 2.
- **Overlapping days:** the days covered by both the new file and already-imported statements. For each key on those days:
  - **e** = occurrences already imported;
  - **f** = occurrences in the new file;
  - **import** occurrences e+1 … f;
  - **if f < e,** refuse the import. The bank shows fewer transactions than already recorded, so one of the files is wrong.
- **Non-overlapping days:** rows are always imported.
- **Preview:** a dry run shows how many rows will be imported, skipped as overlap, or refused, before the user commits.
- **Partial days:** a file whose period starts or ends mid-day is not supported; statements cover whole days.

## 6. Matching engine (BR2): suggestions, never silent

The engine is a pure function: (unmatched statement lines, unmatched book lines and opening items, settings) → suggestions plus ambiguities. **Nothing becomes a match until a user confirms it** (D-BR4). Each line is used by at most one suggestion. There are three passes:

1. **Reference.** Same amount, the same normalised reference on both sides, and dates within `referenceWindowDays` (default 60, D-BR8).
   - **Reference sources:** a token of at least 4 alphanumeric characters (cheque or transfer number) from the statement `reference`/`description`, and from the entry `entryNumber`, `memo`, line `description`, or the opening item `reference`.
   - **Same uniqueness rule as pass 2 (D-BR12):** a suggestion is made only when the (reference, amount) pair has **exactly one** candidate on each side in the window. Any collision on either side is shown as **ambiguous**, with all candidates side by side, and is never suggested.
2. **Amount and date.** Same amount, `|date difference| ≤ amountDateWindowDays` (default 5, D-BR8). Suggested only when the candidate is unique on both sides; otherwise ambiguous.
3. **Group.** Bounded subset-sum, in both directions: a single line on one side equal to the sum of 2 to `maxGroupLines` (default 6) lines on the other.
   - **Candidates:** same sign, within the amount/date window.
   - **Search:** meet-in-the-middle, at most 30 candidates. Above that there is no search, and the screen says so.
   - **Uniqueness:** suggested only when it is the **only** subset that fits; otherwise ambiguous.

**Confirm-all** includes only unique pass-1 and pass-2 suggestions. Never ambiguities, never groups; each group is confirmed on its own. The audit row lists every line confirmed.

**Manual match:** tick lines on both sides; the screen shows the running difference, and **Match** is enabled at 0.

## 7. Reconciliation statement

### 7.1 Starting point (D-BR15)
Before the first reconciliation of an account, the user defines G, the bank balance at G, and the opening items: cheques issued and deposits recorded before G that the bank had not cleared at G. The start can be approved only when:

> bank balance at G + Σ opening items = book balance at G (Σ posted lines on the account dated ≤ G)

Any difference must be explained by more opening items. An approved start is locked like an approved reconciliation, and is reopened the same way (D-BR9).

### 7.2 The statement at D (D-BR10)
Every figure is evaluated **relative to D**:
- A match is **cleared at D** if **all** its lines, on both sides, are dated ≤ D.
- A **book line or opening item** dated ≤ D that is not in a match cleared at D is **outstanding**: a deposit in transit if `+`, an outstanding cheque/withdrawal if `−`. This includes one matched to a statement line dated after D.
- A **statement line** dated ≤ D that is not in a match cleared at D is an **unrecorded bank item**. This includes one matched to a book line dated after D, for example a January fee recorded in February: at 31 January it is unrecorded, whatever its match.
- An **excluded** statement line dated ≤ D is listed in its own section with its reason.

| Line | Value |
|---|---|
| Balance per bank at D | the statement's running/closing balance at D (`no_balances` statements: entered by hand) |
| + Outstanding book items (signed) | as above |
| − Unrecorded bank items (signed) | as above |
| − Excluded lines (signed) | as above |
| = Adjusted bank balance | |
| Balance per books at D | Σ posted lines on the account dated ≤ D |
| **Difference** | must be **0** to approve |

**Why it balances:**
- Book(D) − Bank(D) = [Book(G) − Bank(G)] + Σ book lines in (G, D] − Σ statement lines in (G, D].
- By §7.1 the first bracket is Σ opening items.
- Cleared matches contribute the same amount to both sums and cancel; what is left is exactly the outstanding and unrecorded items above.
- Worked example (the figures in the owner's screenshot): bank −6,665; outstanding cheque −800; unrecorded fee −15. Then −6,665 + (−800) − (−15) = −7,450 = books.

### 7.3 Approval, membership and lock (D-BR6, D-BR9)

**Approve** (permission `bankReconciliation/approve`, difference 0, `version` checked):
- freezes the snapshot;
- writes `BankReconciliationItem` rows for every match **cleared at D that has no membership yet**, and every excluded line ≤ D with no membership yet;
- **never reassigns membership.** A match covered by an earlier approved reconciliation stays its member forever; the `UNIQUE` columns make reassignment impossible.

**Approval order:**
- reconciliations of one account are approved in date order;
- one cannot be approved for D while a draft or approved reconciliation exists for a later date;
- one cannot be approved for D ≤ G.

**Lock:** a journal line, opening item or statement line that belongs to a member match or exclusion of **any** approved reconciliation cannot be edited, deleted, unmatched or unposted.
- **Where:** guards in the journal paths (`update`, `deleteJournalEntry`, `unpostJournalEntry`, including the mirror pair, §8) and in the bank-reconciliation services, plus a database trigger as the backstop.
- **Reversal:** stays allowed. It creates a new dated entry, which becomes an outstanding item of the next period.

**Reopen** (admin/owner, reason required, audit-logged):
- **Who can be reopened:** only the **latest** approved reconciliation of the account. Reopening an earlier one is **refused while any later one is approved**; they are reopened newest first.
- **What reopening does:** deletes only that reconciliation's own membership rows and sets it back to `draft`. Items covered by earlier approved reconciliations stay locked, because their membership rows are untouched.
- **The start (§7.1):** can be reopened only when no reconciliation of the account is approved.

### 7.4 Export
Excel (all sections and items) and PDF (the statement, with approver and date).

## 8. Controls (CLAUDE.md rules)

**Rule 1 — mirror and reversal:**
- **Mirror.** A mirror half lives in its own company; matching is per bank account of that company. No import, match, fee entry or reconciliation reads or writes across companies. Test: a match naming a journal line, opening item or statement line of another company is refused, even within the same tenant.
- **Reversal of a matched entry before approval.** The original stays matched; the reversal is a new outstanding book line. Test.
- **Reversal of a matched entry after approval.** The original is locked; reversing it is allowed and lands as a new outstanding item. Test.
- **Unpost of a mirror pair.** Refused if **either** half has a line in an approved reconciliation, the guard checking both halves as #163's backstop does. Test.
- **Fee entries** (§8.1) are never mirrored. Reversing one before approval leaves its statement lines matched to the reversed settlement, so they show as unrecorded again until re-matched. Test.

**Rule 2:**
- **Book side:** always produced through the real posting paths over HTTP, including fee entries.
- **Statement files:** external uploads, so hand-built CSV/XLSX test files are allowed. Each test documents the bank layout it imitates.
- **Error cases:** a broken running balance or a duplicate occurrence is produced by editing a real export-shaped file, with the reason written down.

**Rule 4:**
- every query is keyed by `tenantId` and `companyId`;
- triggers enforce that the GL account, fee supplier and statement belong to the bank account's company.

**Subscription enforcement:**
- **Write routes:** position resource `bankReconciliation` (`read`, `create`, `edit`, `delete`, `approve`), mapped to the **basic** plan (D-BR7), on every write route (the coverage test enforces this).
- **`:id` routes:** `RECORD_TABLES` gets the statement, start and reconciliation tables.
- **New tables** carry `companyId`, so the write guard covers them.

### 8.1 Bank fees with VAT (D-BR14)
Because the VAT return reads purchase documents (§1), a bank fee is recorded as a **purchase invoice from the bank**, not a manual journal line on the VAT account. One action, in one transaction, through the normal posting services:

1. **Purchase invoice** to `feeSupplierId` (the bank as a supplier, with its VAT number):
   - one service line on the chosen expense account (bank charges / commission), tax category **S**, 15%;
   - posted: Dr expense, Dr input VAT, Cr bank-supplier.

   It flows into the input-VAT summary and the VAT return, and `vatReconciliation` sees document VAT = VAT account movement, with no difference.
2. **Settlement entry** `sourceModule = bank_reconciliation`: Dr bank-supplier / Cr bank GL account, for the gross amount. The supplier balance nets to zero.
3. **Match:** the settlement's bank line is matched (`method = fee_entry`) to:
   - **one statement line** with fee and VAT together. The split is net = round(gross / 1.15, 2), VAT = gross − net; the user can correct it to the bank's tax invoice;
   - **or two statement lines** where the bank shows fee and VAT separately. The user selects both; their sum is the gross, and the match is `many_to_one`.

**Fees without VAT** (out of scope/exempt) use tax category **O** or **E** (with the exemption reason) on the same purchase invoice path, so they stay out of input VAT.

**Bank tax invoice:** its reference is stored on the purchase invoice and the bank's tax invoice can be attached. Claiming input VAT requires the bank's tax invoice, so the screen says so.

## 9. Phases

| Phase | Content | Depends on |
|---|---|---|
| **BR1** | Tables + triggers; `CompanyBankAccount` link, currency and settings; attachment type `bank_statement`; import with mapping, integrity, continuity and occurrence-aware dedupe (preview + commit); go-live start with opening items; statement list; manual matching; unmatched lists; saved-draft warning | — |
| **BR2** | Matching engine (§6) with ambiguity display, confirm and confirm-all | BR1 |
| **BR3** | Fee entries with VAT (§8.1); exclusions; reconciliation statement (§7.2); approve / membership / lock / reopen (§7.3); Excel/PDF export | BR2 |
| **BR4** (optional) | PDF statements through the AI module, with explicit consent (D-BR3) | BR1 |

Each phase gets its own tests, mutation checks, and the fresh-database run with the subscription switch OFF and ON.

## 10. Decisions

**Owner decisions, 2026-10-15:**

| # | Decision |
|---|---|
| D-BR1 | Reconcile per **bank GL account**, linked from `CompanyBankAccount` (`glAccountId`). An unlinked account is not reconciled. |
| D-BR2 | Book side = **posted** entries only; saved drafts touching the account are a warning. |
| D-BR3 | **No PDF statements in v1.** Excel/CSV only. PDF later (BR4) only through the AI module (enterprise), with explicit consent that the file goes to Anthropic. |
| D-BR4 | The engine **suggests, never confirms.** Confirm-all only for unique reference and unique amount+date suggestions; groups one by one. |
| D-BR5 | Amounts match **exactly to the halala**; no tolerance. Differences become entries or stay visible. |
| D-BR6 | **Lock after approval** (no edit, delete, unpost or unmatch of member lines); reversal allowed; reopen by admin/owner with a reason. |
| D-BR7 | Plan tier: **basic**. |
| D-BR8 | Amount+date: window **5 days**, groups up to **6 lines**. Reference matches (cheque / transfer reference): window **60 days**. All three are configurable per bank account. |

**Review of #167, decided 2026-10-15:**

| # | Decision |
|---|---|
| D-BR9 | **Membership is separate and written once.**<br>• **Model:** `BankReconciliationItem`, with `matchId` / `excludedLineId` `UNIQUE`.<br>• **Approval:** adds only items with no membership yet, and never reassigns.<br>• **Reopen:** only the latest approved reconciliation, newest first. An earlier one is refused while a later one is approved. Reopening deletes only its own membership rows, so items of earlier approved reconciliations stay locked.<br>• **Order:** approval is in date order. |
| D-BR10 | **Everything is evaluated relative to the cutoff D.** A match counts as cleared only if all its lines are ≤ D.<br>• A statement line ≤ D matched to book lines after D is an unrecorded bank item at D.<br>• A book line ≤ D matched to statement lines after D is outstanding at D. |
| D-BR11 | **Statement line identity:**<br>• **Transaction ID mapped:** unique per bank account; same content → skipped, different content → import refused.<br>• **No ID:** occurrence-aware. Key = (date, amount, normalised description, reference, running balance), occurrences numbered per file. On overlapping days, import occurrences e+1…f; f < e → refused.<br>• **Files:** an identical file is refused; a dry-run preview comes before commit; whole days only. |
| D-BR12 | **Reference matches need uniqueness on both sides**, as amount+date matches do. Any collision on either side is shown as ambiguous and never enters confirm-all. |
| D-BR13 | **Attachment type `bank_statement`**, registered consistently in three places:<br>• `attachmentEntityTypeEnum`;<br>• `assertEntityCompanyAccess`, resolving the company from `BankStatement`, and also requiring `bankReconciliation/read` to list or download (statements are bank data);<br>• `ATTACHMENT_ENTITY_MODELS` (`bank_statement → BankStatement`), so the subscription pre-check and write guard resolve its company.<br>The original file is uploaded by the import endpoint itself, in the same request. Its attachment cannot be deleted while any line of the statement is matched or excluded. |
| D-BR14 | **Bank fees go through a purchase invoice from the bank as supplier** (tax category S 15%, or O/E without VAT) plus a settlement entry, so input VAT flows into the VAT return and `vatReconciliation` shows no difference. Fee and VAT on separate statement lines are matched together to the one settlement line (`many_to_one`). |
| D-BR15 | **Go-live start per bank account:** date G, bank balance at G and opening outstanding items. Approved only when bank(G) + Σ opening items = books(G). Book lines ≤ G are never candidates; opening items are matched like book lines. |
| D-BR16 | **Statement integrity on import.** With balances, opening + movements = closing and every running balance must be consistent, or the import is refused. Without balances, the import is allowed with a warning and the bank balance at D is entered by hand. Contiguous statements must chain: new opening = previous closing. |
| D-BR17 | **Currency:** reconcile in the bank account's currency, which must equal the company currency in v1.<br>• A non-SAR **company** whose bank account is in the company currency (for example AED with an AED account) works the same way.<br>• An account in a currency other than the company's cannot be reconciled in v1. The screen says so and import is refused, because journal lines hold only company-currency amounts.<br>• Supporting it needs foreign-currency amounts and rates on journal lines first, a separate design. |
