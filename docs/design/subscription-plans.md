# Subscription plans and per-company subscriptions — design

Status: **design only, nothing implemented.** Built from the investigation of 2026-10-11 (code at `production` `b206545`) and the owner's decisions recorded on 2026-10-11 and 2026-10-12 (§11 answers folded in as D16–D30). Every implementation step below is a separate PR. No open questions remain (§11).

**Re-checked against merged #151 (`4e37371`) on 2026-10-12: no conflict.**
- **Schema:** #151 adds no migration and changes no model. Companies, tenants, users and identities are modelled as this design assumed.
- **Membership check:** its live membership check (`assertCurrentMembership`, `src/lib/currentMembership.ts`, called from `authenticate`) is the hook P4 extends.
- **Separation script** (`scripts/ops/separate-armi-companies.sql`):
  - It sets each new tenant's `ownerId` to the designated administrator (D25).
  - It rewrites `tenantId` on tables that carry one. The P1 tables carry none, so they are unaffected.
  - It rewrites `userId` columns that point at the source owner, which includes `company_pos_users`. It does this only after the company and the administrator's new membership are both in the new tenant, so P1's same-tenant trigger accepts the rewrite.
  - The P1 tables are empty until P11, which still runs after the cutover.

## 1. Decisions this design implements

| # | Decision |
|---|---|
| D1 | The **company** is the subscription unit. Each company has its own plan, period, end date and billing relationship. |
| D2 | **Prices per company** (excl. 15% VAT): basic **500**, professional **1000**, enterprise **1500** SAR/year. Monthly = yearly / 12 × 1.10. |
| D3 | **Volume discount** within one **owner identity** (all companies owned by the same person, across all their tenants). The oldest company pays full price. Additional companies get 20%, 30%, 40%, … off. Ranks are recomputed at renewal. |
| D4 | **Enforcement = modules + users per company, on the server.** Branches are descriptive only and **not enforced**. There are no invoice-count limits. ZATCA phase 2 is in every plan. |
| D5 | Subscription state and **expiry are per company**, with real end dates. |
| D6 | **Trial once per owner identity**, on their first company only. |
| D7 | **Signup chooses a plan**, with email verification and rate limiting. |
| D8 | **أثر is a company inside Athar** and issues ZATCA invoices to subscribers. Its legal entity is configured from the admin panel. |
| D9 | A **receipt allocated to a subscription invoice auto-extends** that company. |
| D10 | Existing group companies get an **owner-set plan and end date**. Existing external customers **keep their current price until renewal**. |
| D11 | **Items:** the catalog (service and stock items) is in all plans. Basic keeps automatic stock movements from invoices on the single default warehouse, plus a simple stock balance. Professional and above add multiple warehouses, transfers, issue vouchers, periodic settlement and inventory reports. |
| D12 | **Cost centers and departments** are in all plans. |
| D13 | **Stables and stations are activity add-ons.** They are auto-enabled by business activity and **free for now, for every company** (D30). Current auto-visibility by activity is preserved. |
| D14 | **POS:** each company with POS enabled **includes one POS user free**; every **additional** POS user is 600 SAR/year (D27). POS users are explicit assignments (D19). |
| D15 | **Athar AI** is in enterprise, but it is **not user-visible yet** (it has no web UI). |
| D16 | **Discount cap 50%**, reached at the 5th company. |
| D17 | **Add-ons get no volume discount.** |
| D18 | **Extra user: 120 SAR/year.** |
| D19 | **POS user = a member explicitly assigned as POS user of a company** (an assignment per company), not anyone whose position can create POS sales. Owners and admins with full permissions are not counted unless assigned. |
| D20 | **The stations add-on grants station-worker employee records** (no payroll/HR module) on every plan, so stations work on basic and professional. |
| D21 | **Expired companies keep their discount rank for 30 days.** |
| D22 | **Upgrades take effect immediately with proration** for the remaining period; **downgrades take effect at the next renewal**. |
| D23 | **Renewal invoice 14 days before the end date**, then a **7-day grace period** after the end date with a visible banner, then read-only. |
| D24 | **Signup rate limits** 5/hour per IP and 3/day per email. |
| D25 | **#151's separated companies** are owned by the designated administrator and their discount is grouped under that identity (they are the owner's own group companies). |
| D26 | **A receipt un-allocated after it extended a subscription** is flagged for owner review; no automatic reversal. |
| D27 | **One POS user is included free** in every company with POS enabled; additional POS users are 600 SAR/year each. Enabling POS itself costs nothing. |
| D28 | **No grace after a trial ends:** the company becomes read-only at the trial end. |
| D29 | **Monthly ↔ yearly switches take effect at the next renewal.** |
| D30 | **Stations and stables add-ons are free and unpriced for now**, enabled by activity. A price is set later, when an external customer needs them. |

## 2. Plan / module table, mapped to permission ids

**Where enforcement hangs.** The server enforces plans on the **permission (module) ids** passed to `requirePositionAction(moduleId, action)`, not on the nav groups. Nav groups mix things the plans separate: `inventory` holds both items and stock, `settings` holds cost centers, `accounts` holds departments.

**The canonical map.** It will live in `src/lib/subscriptionPlans.ts`. `src/lib/platformModules.ts` (nav groups) gets `pos` and `stationShifts` added, and is derived from the map for the UI.

| Feature | basic | professional | enterprise | Nav group | Permission ids gated |
|---|---|---|---|---|---|
| Users per company (included) | 2 | 5 | 15 | — | counted at invite / activate / scope change (§5.3) |
| Sales: invoices, returns, debit notes, receipts, reports | ✓ | ✓ | ✓ | `sales` | `salesInvoices`, `salesReturns`, `salesDebitNotes`, `receipts`, `salesReports` |
| Customers, quotations | ✓ | ✓ | ✓ | `sales` | `customers`, `quotations` |
| Purchases, suppliers | ✓ | ✓ | ✓ | `purchases` | `purchaseInvoices`, `purchaseReturns`, `suppliers`, `purchaseReports` |
| Journal, chart of accounts, ledger, zakat, bulk import | ✓ | ✓ | ✓ | `accounts` | `journalEntries`, `accounts` |
| Cost centers, departments (D12) | ✓ | ✓ | ✓ | `settings` / `accounts` | `costCenters`, `departments` |
| Reports, VAT reconciliation, scheduled reports, dashboard | ✓ | ✓ | ✓ | `reports` | `reports`, `vatReconciliation`, `reportSchedules`, `dashboard` |
| ZATCA phase 2 | ✓ | ✓ | ✓ | `settings` | `companiesZatca` (and the submit paths inside sales) |
| Item catalog + automatic stock movements on the default warehouse + simple stock balance (D11) | ✓ | ✓ | ✓ | `inventory` (items tab) | `items` |
| Multiple warehouses, manual in/out, issue vouchers, transfers, periodic settlement, inventory reports (D11) | — | ✓ | ✓ | `inventory` | `stockMovements`, `warehouses`, `periodicSettlement`, `inventoryReports` |
| Fixed assets | — | ✓ | ✓ | `fixedAssets` | `fixedAssets`, `depreciation`, `assetCategories` |
| HR and payroll | — | — | ✓ | `hr` | `employees`, `payrollRuns`, `payrollSettings`, `leaveSettlements`, `leaveReturns`, `hrActions`, `employeeAdvances`, `hrReports`, `attendance`, and `hrSensitiveData` (not a route: it decides whether personal and payroll data shows in reports and attachments, data that exists only with HR) |
| Athar AI — **not user-visible yet** (D15) | — | — | ✓ | none | `ai` |
| Branches — descriptive, **not enforced** (D4) | 1 | 3 | unlimited | `settings` | (`branches` stays ungated) |
| Invoice count | unlimited | unlimited | unlimited | — | — |

**Always available.** Infrastructure ids, ungated in every plan: `companySettings`, `userAdministration`, `branches`, `documentNumberingSettings`, `companyBankAccounts`, `companyDocuments`, `attachments`, `leaseContracts` (company settings).

**Add-ons (any plan):**

| Add-on | Price (excl. VAT) | Gated ids | Notes |
|---|---|---|---|
| Extra user (D18) | 120 SAR/year per user | raises the company's user limit | — |
| POS (D14, D19, D27) | Enabling: free, **1 POS user included**. Each additional POS user: 600 SAR/year | `pos` (allowed only when `posEnabled`) | A POS user is a member **explicitly assigned** as POS user of the company (`company_pos_users`, §3.2). Assignments are capped at `1 + posUsers`, where `posUsers` is the number of **additional paid** seats. Opening POS sales requires the assignment **for everyone, owners and `super_admin` included**, so an unassigned owner is neither counted nor able to sell at POS; a non-owner also still needs a position granting `pos.create`. POS reads (reports) need no seat. |
| Stations (D13, D20, D30) | Free for now, unpriced | `stationSetup`, `stationShiftsReports`, `stationSales`, station-worker portal routes, and **`employees` limited to station workers** | Auto-enabled for `businessActivity = fuel_stations`, keeping today's auto-visibility (`frontend/src/App.jsx:81-84`). **Station workers** are `Employee` rows with `assignedCostCenterId` set (the station they work at, `schema.prisma` `Employee.assignedCostCenterId`). On a plan without HR, the add-on allows the `employees` actions **only on such rows**: create a worker (the station is then required), edit, set phone/PIN and `portalActive`. Lists return only station workers. Payroll, leave, HR actions, advances and HR reports stay enterprise. |
| Stables (D13, D30) | Free for now, unpriced | `stables` | Auto-enabled for `businessActivity = horse_stables`. |

**When an activity add-on is on:** the company's activity matches (automatic, D13), **or** the admin granted it explicitly (`free` / `paid`) for a company with another activity. P2's coverage test fails if any id registered in `POSITION_RESOURCES` is missing from the map, or is classified twice.

**Basic and stock (D11).** Basic invoices keep calling `createStockOutSideEffectsTx` (`salesInvoices.service.ts:181,240`); those are side effects of the invoice, not calls into the `stockMovements` router, so gating that router does not break basic. A basic company keeps exactly its default warehouse, because the `warehouses` create route is gated. The "simple stock balance" is the quantity on hand shown in the item catalog (`items`).

## 3. Data model (athar)

New tables. Prisma generates the migrations (`prisma/migrations/README.md`).

### 3.1 `company_subscriptions` — one row per company

| Column | Type | Meaning |
|---|---|---|
| `id` | cuid | — |
| `companyId` | unique FK → companies | **the subscription unit (D1)** |
| `ownerIdentityId` | — | discount scope (D3). Snapshot of `tenants.ownerId → users.identityId`, refreshed at renewal. |
| `plan` | enum `basic \| professional \| enterprise` | — |
| `billingPeriod` | enum `yearly \| monthly` | — |
| `status` | enum `trialing \| awaiting_payment \| active \| grace \| expired \| suspended \| canceled` | §6 (`grace` = the 7 days after the end of a paid term, D23) |
| `currentPeriodStart`, `currentPeriodEnd` | timestamptz | **Real end date, `NOT NULL`** (database CHECK) unless `legacyOpenEnded` (§10). No more open-ended "active". |
| `legacyOpenEnded` | boolean | only for migrated rows with no known end date; CHECK: such a row cannot be `enforced` |
| `discountRank`, `discountPct` | int, decimal(5,2) | rank and discount locked for the current term; CHECK 0 ≤ pct ≤ 50 (D16) |
| `netPrice` | decimal(12,2) | the plan price locked for the current term, after discount, excl. VAT |
| `grandfatheredNetPrice` | decimal(12,2), nullable | D10: the external customer's existing price, honoured until `currentPeriodEnd` or an upgrade (§4.1), then cleared |
| `scheduledPlan`, `scheduledBillingPeriod` | nullable | a downgrade or period change waiting for the next renewal (D22) |
| `extraUsers` | int | purchased extra users (D18) |
| `posEnabled` | boolean | POS enabled for the company, which includes one free POS user (D27) |
| `posUsers` | int | **additional paid** POS users beyond the free one; CHECK: 0 unless `posEnabled` |
| `stationsAddon`, `stablesAddon` | enum `off \| free \| paid` | D13, D30: set to `free` by activity; `paid` exists for when a price is set later |
| `suspensionReason` | text, nullable | — |
| `enforced` | boolean, default false | per-company rollout switch (§10). Stays false until migration fills real values. |
| `createdAt`, `updatedAt` | — | — |

**No `tenantId` column.** The tenant is read through `companies.tenantId`. PR #151's separation script rewrites `tenantId` on every table that has one and refuses to run when a source-tenant row has no recorded owner. A denormalized copy here could go stale or block that script. P1 therefore also creates the tables **empty**: rows are created by the migration step after the #151 cutover (§10).

### 3.2 Other tables and fields

- **`subscription_events`** (append-only; UPDATE/DELETE blocked by trigger, like `zatca_document_archive`): `companySubscriptionId`, `type` (`created`, `plan_changed`, `period_changed`, `renewed`, `extended`, `expired`, `suspended`, `activated`, `canceled`, `receipt_applied`, `rank_recomputed`, `migrated`), before/after JSON, `actor` (`system_job`, `platform_admin:<adminUserId>`, `owner:<userId>`), `at`. This is the audit trail for every price and date change.
- **`plan_prices`**: `item` (`plan_basic`, `plan_professional`, `plan_enterprise`, `addon_user`, `addon_pos_extra_user`, `addon_stations`, `addon_stables`), `yearlyNetPrice` (null = unpriced, free), `effectiveFrom`, unique (`item`, `effectiveFrom`). Only the **yearly** price is stored; the monthly price is always the §4 formula, so the two cannot disagree. The owner changes prices from the admin panel by adding a row with a later `effectiveFrom`, without a deploy. A trigger refuses UPDATE/DELETE of a row already in effect, so the price that applied on any past date stays readable. Issued invoices keep their own line prices.
- **`company_pos_users`** (D19): `companyId`, `userId`, `assignedAt`, `assignedByUserId`, unique (`companyId`, `userId`). A trigger refuses an assignment whose user and company are in different tenants (rule 4). P4 caps the count at `1 + posUsers` when `posEnabled`, and at 0 otherwise (D27).
- **`subscription_invoices`**: links a sales invoice **in the أثر company** to a subscriber's subscription. Columns: `salesInvoiceId` (unique), `companySubscriptionId`, `kind` (`new`, `renewal`, `upgrade`, `addon`), `periodStart`, `periodEnd`, `appliedAt` (null until the receipt extends the subscription).
- **`platform_settings`** (key/value): `billingCompanyId`, the أثر company inside Athar (§8).
- **`identities`** gains:
  - `emailVerifiedAt timestamptz null`;
  - `trialConsumedAt timestamptz null` (D6). It is set when the identity's first trial starts. A trial is granted only when it is null **and** the identity owns no tenant, which covers every existing owner without a backfill (tenants are never deleted).
- **`signup_requests`**: pending signups (hashed token, email, chosen plan and period, company name and activity, `expiresAt`, `consumedAt`). The tenant is created only after verification (§7.1).
- **`signup_throttle`**: same shape as the existing `portal_login_throttle`, keyed by IP and by email.
- **`subscription_reminders`** (P3): `companySubscriptionId`, `kind` (`before_14`, `before_7`, `before_1`, `grace_started`, `read_only`), `periodEnd`, `sentAt`, unique (`companySubscriptionId`, `kind`, `periodEnd`). A row is claimed before a reminder is sent and released if the send fails, so each reminder goes out once per term even with two server instances.

### 3.3 Deprecated fields

- **`Tenant` fields:** `subscriptionPlan`, `subscriptionStatus`, `trialEndsAt`, `enabledModules` and `suspensionReason` stay read-only during the transition and are dropped in the last phase. Tenant-level `suspended` is replaced by suspending every company of the tenant (admin action), so login-level suspension (`assertTenantActive`) keeps working until then.

### 3.4 Tenant isolation (CLAUDE.md rule 4)

- **What subscribers can see:** a subscriber's users see only their own company's subscription, plus a price-preview figure computed by the server. The other companies of the same owner identity are counted, never listed, unless the viewer is that owner.
- **What the أثر company can see:** its users see the subscribers only as **its own customers**, the way any company sees its customers. The link from an أثر invoice to a subscriber's subscription lives in `subscription_invoices` and is read only by system code and the platform-admin API. Neither tenant's users can read it.

## 4. Pricing

Every amount is in halalas through `src/lib/money.ts`; rounding is half-up to 0.01.

```
discountPct(rank) = 0                     if rank = 1
                  = min(10 × rank, 50)    if rank ≥ 2      → 20, 30, 40, 50, 50, …   (cap 50% from the 5th company on)
yearlyNet(plan)   = 500 | 1000 | 1500
monthlyNet(plan)  = yearlyNet(plan) × 1.10 / 12
periodNet(plan, period, rank) = round2( base(plan, period) × (100 − discountPct(rank)) / 100 )
line VAT          = round2( lineNet × 0.15 )                          (per line, like every Athar invoice)
```

**The rules:**
- **Rank** is the position of the company among the owner identity's **live** companies (status `trialing`, `awaiting_payment`, `active`, `grace`, or `expired` for at most 30 days since it became read-only, D21), ordered by `companies.createdAt`, then id. The oldest company gets rank 1 and **full price, whatever its plan**.
  - **When read-only began:** taken from the latest `expired` event. Without one, it is `currentPeriodEnd`.
  - **Before P11:** a company with **no subscription row yet** counts as live, because it exists and is in use today.
- **Locking:** rank and price are locked for the current term and recomputed **at renewal** (D3). If the oldest company is canceled, the others move up at their next renewal, not mid-term.
- **Grandfathering:** if `grandfatheredNetPrice` is set (D10), it replaces `periodNet` until the current end date.
- **Add-ons** (extra users, additional POS users, activity add-ons) are **not discounted** (D17). The first POS user is free (D27); stations and stables are free for now (D30). Their monthly price follows the same `/12 × 1.10` rule.

### Worked examples (yearly unless stated; VAT 15%)

**1 company, basic, yearly:** 500.00 + VAT 75.00 = **575.00**.

**2 companies, both basic, yearly:**

| Rank | Plan | Discount | Net | VAT |
|---|---|---|---|---|
| 1 | basic | 0% | 500.00 | 75.00 |
| 2 | basic | 20% | 400.00 | 60.00 |
| | | | **900.00** | **135.00** → total **1,035.00** |

**4 companies, mixed plans** (the oldest is professional):

| Rank | Plan | Discount | Net | VAT |
|---|---|---|---|---|
| 1 | professional | 0% | 1,000.00 | 150.00 |
| 2 | basic | 20% | 400.00 | 60.00 |
| 3 | enterprise | 30% | 1,050.00 | 157.50 |
| 4 | basic | 40% | 300.00 | 45.00 |
| | | | **2,750.00** | **412.50** → total **3,162.50** |

**6 companies, all basic** (the cap applies to the 5th and 6th):

| Rank | 1 | 2 | 3 | 4 | 5 | 6 | Total |
|---|---|---|---|---|---|---|---|
| Discount | 0% | 20% | 30% | 40% | 50% | 50% | |
| Net | 500.00 | 400.00 | 350.00 | 300.00 | 250.00 | 250.00 | **2,050.00** |
| VAT | 75.00 | 60.00 | 52.50 | 45.00 | 37.50 | 37.50 | **307.50** → **2,357.50** |

**Monthly vs yearly:**

| Case | Monthly net | Monthly VAT | Monthly total | × 12 | Yearly total | Monthly premium |
|---|---|---|---|---|---|---|
| 1 basic | 500 × 1.1 / 12 = 45.83 | 6.87 | 52.70 | 632.40 | 575.00 | +10% (rounding gives +57.40) |
| 2 basic: rank 1 | 45.83 | 6.87 | | | | |
| 2 basic: rank 2 (20%) | 45.833… × 0.8 = 36.67 | 5.50 | | | | |
| 2 basic: together | 82.50 | 12.37 | 94.87 | 1,138.44 | 1,035.00 | |
| 1 enterprise | 1500 × 1.1 / 12 = 137.50 | 20.63 | 158.13 | 1,897.56 | 1,725.00 | |

**Add-ons on a basic company** (D17, D18, D27): 3 extra users, and POS enabled with 2 POS users (1 free + 1 additional), yearly:

| Line | Net | VAT |
|---|---|---|
| Extra users 3 × 120 | 360.00 | 54.00 |
| POS user 1 (included) | 0.00 | — |
| Additional POS user 1 × 600 | 600.00 | 90.00 |
| | **960.00** | **144.00** → total **1,104.00** |

Monthly, an additional POS user is 600 × 1.1 / 12 = **55.00** net (VAT 8.25). A company with POS enabled and a single POS user pays nothing for POS.

**Effect of D22 and D23 on the examples above:** none of the 1/2/4/6-company or monthly-vs-yearly figures change. They are full-term prices, and grace (D23) adds no days and no charge. A payment in grace extends from the old end date (§6), so the next term costs the same. D22 adds the proration cases in §4.1, and D23 the timeline in §6.1.

### 4.1 Mid-term changes (D22)

```
remainingDays = KSA calendar days from the change date to currentPeriodEnd
termDays      = KSA calendar days from currentPeriodStart to currentPeriodEnd
upgradeNet    = round2( (periodNet(newPlan, period, lockedRank) − lockedNet) × remainingDays / termDays )
lockedNet     = grandfatheredNetPrice if set, else netPrice
```

**What an upgrade does:**
- **When:** it takes effect **on payment** of the upgrade invoice (`subscription_invoices.kind = upgrade`).
- **Price:** `netPrice` becomes the new plan's price at the locked rank; any grandfathered price ends there.
- **Term:** the end date does not move.
- **Add-ons:** raising add-on quantities is an upgrade too, prorated the same way and undiscounted.

**What a downgrade does:** a downgrade (or lowering add-on quantities) sets `scheduledPlan`. The renewal invoice (14 days before the end, D23) is built from it. If the owner downgrades **after** that invoice was issued, the difference is corrected with a ZATCA credit note on the renewal invoice. No refund or credit is given for the rest of the current term.

**Billing period changes** (monthly ↔ yearly) take effect at the next renewal (D29).

**Upgrade, yearly:** rank 2 (20%), basic, locked at 400.00. The term runs 2027-01-01 → 2028-01-01 (365 days), and the company upgrades to professional on 2027-07-01 (184 days left).

| | |
|---|---|
| New price at rank 2 | 1,000 × 0.80 = 800.00 |
| Difference | 800.00 − 400.00 = 400.00 |
| Prorated | 400.00 × 184 / 365 = **201.64** |
| VAT | 30.25 |
| Due now | **231.89** |
| Renewal on 2028-01-01 | professional at the rank recomputed then |

**Upgrade, monthly:** rank 1, basic monthly at 45.83. The term runs 2027-07-01 → 2027-08-01 (31 days), and the company upgrades to professional on 2027-07-11 (21 days left).

| | |
|---|---|
| Professional monthly | 1,000 × 1.1 / 12 = 91.67 |
| Difference | 91.67 − 45.83 = 45.84 |
| Prorated | 45.84 × 21 / 31 = **31.05** |
| VAT | 4.66 |
| Due now | **35.71** |

**Downgrade:** enterprise → basic on the same yearly term. Nothing is charged or credited now. The renewal invoice issued on 2027-12-18 is basic at the rank recomputed then.

**The price preview** (§7) shows these exact lines before any company is created, computed by one server function, `previewSubscriptionPrice(ownerIdentityId, plan, period, addOns)`. The UI never recomputes prices.

## 5. Server enforcement

### 5.1 Where it runs

**Ordering.** It runs right **after PR #151's live membership check** (`assertCurrentMembership` inside `authenticate`), which already reads the membership from the database on every request. Enforcement adds the company's subscription to that read path.

**Which company a request is for:**
- **Scoped user:** `req.auth.companyScope` when it is a specific company.
- **Explicit company:** for `all`-scope users, the explicit `companyId` (query/body; the same source `enforceCompanyScope` uses).
- **Record id only:** for requests that carry just a record id (`POST /sales-invoices/:id/post`), the record's `companyId`. This is the same lookup `assertRecordCompanyScope` already does, centralized as `resolveRequestCompanyId(req, recordModel)`.
- **No company at all:** tenant-wide reads such as company lists are not gated.

**Loading the subscription.** It is read once per request and cached in memory for 30 s by `companyId`, with the cache invalidated in-process on every subscription write. One row by unique key adds no measurable load.

### 5.2 Module gate

`requirePositionAction(moduleId, action)` gains a plan check **before** the position check:

```
plan module allowed?  = moduleId ∈ PLAN_MODULES[sub.plan] ∪ ALWAYS ∪ activeAddOns(sub)
                        (activity add-ons: auto-on when company.businessActivity matches, D13)
not allowed           → 403 "هذه الميزة غير مشمولة في باقة الشركة الحالية (…) — يمكن الترقية من إعدادات الاشتراك"
```

- **Who it applies to:** everyone, including the owner and `super_admin`. A plan is not a permission, and owners bypass only positions.
- **Interim mechanism:** `sub.enforcement = off` skips the check for the rollout (§10).
- **The UI:** it reads the allowed modules from `/auth/me` (per company) and replaces today's `tenant.enabledModules` filter (`App.jsx:84`). Hiding something in the UI is a convenience; the server rule is what counts.

### 5.3 User limit

`limit(company) = includedUsers(plan) + extraUsers`

**What counts:** active, accepted, non-deleted memberships whose scope is the company or `all`. An `all`-scope member counts in **every** company of its tenant. The sizing SQL counts it the same way.

**Checked at:**
- invite (`POST /auth/invite`);
- re-activation (`PATCH /auth/users/:id/active`);
- scope change to a company (`PATCH /auth/users/:id`);
- accepting an invite.

Exceeding the limit returns 403 with the limit and how to add users.

**POS (D19, D27):** assigning a member as POS user of a company (`company_pos_users`) is refused when POS is not enabled, or when the company already has `1 + posUsers` assignments. Opening POS sales checks the assignment for the request's company. The owner and `super_admin` are no exception: they are not counted unless assigned, and not able to sell at POS unless assigned. Positions keep deciding what a non-owner may do; the assignment decides the paid seat.

**Downgrades and lowered limits never lock anyone out.** Existing members keep working; new invites are blocked and the admin panel flags the company as over the limit.

### 5.4 Per-company read-only

- **What it replaces:** the tenant-wide `readOnly` JWT claim (`isTenantReadOnly`, `auth.service.ts:113-118`) becomes a per-request, per-company decision. A company is read-only when:
  - its status is `expired`, `awaiting_payment` or `canceled`;
  - it is `trialing` and `now ≥ currentPeriodEnd` (no grace on a trial, D28);
  - it is `active` or `grace` and `now ≥ currentPeriodEnd + 7 days` (D23).
- **Grace banner:** for a paid term with `currentPeriodEnd ≤ now < currentPeriodEnd + 7 days`, `/auth/me` returns the company's grace end date. The UI shows a banner on every page of that company ("انتهى الاشتراك في … — تتحول الشركة إلى عرض فقط في … ما لم يُسدَّد التجديد"). Writes still pass.
- **Correctness:** the check compares the dates with `now()` itself, so it does **not** depend on the scheduled job having run.
- **Effect:** reads always pass, as today; mutations get 403. `blockMutationsWhenReadOnly` stays the router-level hook, now fed by the company's subscription instead of the token.
- **Other companies are unaffected:** the same `all`-scope user keeps full access to the tenant's other companies that are active.
- **Coverage:** #157's coverage test (every user-authenticated router mounts the guard) keeps protecting this.
- **Mirror and reversal (CLAUDE.md rule 1):** P4's PR must cover these cases:
  - a mirror entry written **into** another company is checked against **the target company's** subscription, not only the source's;
  - reversing an entry, or reversing a mirror entry, is a mutation in the company that holds the entry, so it is refused when that company is read-only;
  - each case gets its own test.

## 6. Lifecycle

| From | Event | To |
|---|---|---|
| — | signup, first company of an identity (D6) | `trialing`, end = +30 days, `trialConsumedAt` set |
| — | any other new company (add-company, second signup) | `awaiting_payment`, end = creation date, invoice issued immediately |
| `trialing` / `awaiting_payment` / `expired` | receipt fully pays a `subscription_invoice` (D9) | `active`, start = payment date, end = start + 1 year or 1 month |
| `active` / `grace` | receipt fully pays the renewal invoice | `active`, start = old end, end = old end + term. Paying early loses nothing; paying in grace gains nothing. |
| `active` / `grace` | receipt fully pays an upgrade invoice (§4.1) | same status, new plan from now, end unchanged |
| `active` | `now ≥ currentPeriodEnd` | `grace` (writes allowed, banner, D23) |
| `grace` | `now ≥ currentPeriodEnd + 7 days` | `expired` (read-only) |
| `trialing` | `now ≥ currentPeriodEnd` | `expired` (read-only; no grace, D28) |
| any | admin suspend | `suspended` (login blocked for scoped members of that company; `all`-scope members lose only that company) |
| `suspended` | admin activate | the status it would have **by date** (`active` before the end, `grace` within 7 days after it, else `expired`). This is the fix for today's "activate = unlimited active". |
| any | admin cancel / owner cancel at term end | `canceled` (read-only; data kept) |

**The scheduled job** (`src/lib/subscriptionScheduler.ts`): hourly, in-process, the same pattern as `reportScheduler.ts` and `zatca/retryScheduler.ts`. Each run is idempotent, and each step is claimed with a conditional update so two server instances cannot double-act.
1. **Transitions:** `active` → `grace` at the end date; `grace` → `expired` 7 days later; `trialing` → `expired` at the end date. Each writes an event. Enforcement does not wait for this (§5.4); the job keeps the column and reports truthful.
2. **Renewal invoices:** issue a renewal invoice **14 days** before the end date for `active` companies (D23). Rank is recomputed here (D3), and `scheduledPlan` / `scheduledBillingPeriod` are applied to the invoice (D22).
3. **Reminders:** email the owner and admins at 14, 7 and 1 days before the end date, on the end date (grace starts), and when read-only starts.
4. **Grandfathering:** clear `grandfatheredNetPrice` when its term ends.

### 6.1 Timeline example (D23)

Yearly term ending **2027-11-01**:

| Date | What happens |
|---|---|
| 2027-10-18 | Renewal invoice issued (rank recomputed); reminder email |
| 2027-10-25, 2027-10-31 | Reminders |
| 2027-11-01 | Status `grace`; banner shows "read-only from 2027-11-08"; writes still allowed |
| 2027-11-08 | Status `expired`; read-only |

What the payment date changes:
- **Paid on 2027-10-20 (early):** new term 2027-11-01 → 2028-11-01.
- **Paid on 2027-11-05 (in grace):** new term **2027-11-01** → 2028-11-01. Grace days are part of the paid term, not free.
- **Paid on 2027-11-20 (after read-only):** new term 2027-11-20 → 2028-11-20. The read-only days are neither charged nor recovered.
- **Not paid:** the company keeps its rank for its owner's other companies until **2027-12-08** (30 days after read-only, D21).

## 7. Signup and add-company flows

### 7.1 Signup (D6, D7)
1. **Plan choice.** The landing page has a plan card per plan and period. The cards are built from `plan_prices`, replacing the hard-coded `PRICES` (`LandingPage.jsx:7`) and the marketing feature lists in `ar.json:186-199`. Clicking a card opens `/register?plan=…&period=…`.
2. **Register.** The form adds the plan and period to today's fields and shows the **price preview** for rank 1: full price, VAT, and "30-day free trial, nothing due today". `POST /auth/register`:
   - is rate-limited per IP (5/hour) and per email (3/day) (D24);
   - validates the input;
   - stores a `signup_requests` row and emails a verification link (24-hour token);
   - **creates no tenant yet**;
   - answers the same way whether or not the email exists, so it doesn't reveal accounts.
3. **Verify.** `GET /auth/verify?token=…` marks `emailVerifiedAt` and then runs today's `createOwnedTenant` (`auth.service.ts:139-176`) plus a `company_subscriptions` row:
   - **identity never had a trial:** `trialing` 30 days on the chosen plan, and `trialConsumedAt` is set;
   - **identity already owns companies:** `awaiting_payment` with an invoice issued (§8), and the preview shows its rank and discount.
4. **Existing identities:** an identity that already has a password still proves it as today (`auth.service.ts:187-191`), in addition to email verification.

### 7.2 Add company
- **Starting point:** it builds on **#151's version** of `CompaniesSettings.jsx` and `createCompany`. There, "independent" is the default and company-scoped users cannot add a group company.
- **Steps:**
  1. Choose **same group** or **independent**.
  2. Choose the plan and period.
  3. The server price preview shows the new company's rank, discount, net, VAT and total, plus a note that ranks are recomputed at each company's renewal.
  4. Confirm.
- **Result:** the company is created in `awaiting_payment` (no second trial, D6). The subscription invoice is issued at once, and the company is read-only until it is paid. Its chart of accounts and seed data are created as today, so it can be reviewed.
- **Discount scope:** both choices count toward the same owner identity's discount (D3). "Independent" changes data isolation, not price.

## 8. Billing through the أثر company (D8, D9)

**The billing company.** One company inside Athar, set by `platform_settings.billingCompanyId`, issues every subscription invoice. Its legal entity is configured from the admin panel through the internal API: name, VAT number, CR, national address, bank accounts. Those are ordinary `Company` fields, so ZATCA seller data comes from the normal path. Its ZATCA onboarding is the normal Athar onboarding, done once.

**Each subscribing company is a customer** of the أثر company. The customer is created on the first invoice from the subscriber's legal data: name, VAT number, address. A subscriber with a VAT number gets a **standard (clearance)** invoice; one without gets a **simplified** invoice.

**Issuing:** `issueSubscriptionInvoice(companySubscriptionId, kind)` is system code, called by the job and by the admin panel. It creates an ordinary sales invoice in the أثر company with these lines:
- the plan for the period (`كل شركة باسمها — باقة احترافية سنوية 2026-11-01 → 2027-10-31`, discount shown as a line discount);
- each add-on.

It goes through the existing posting and ZATCA pipeline (the reserve-chain, re-issue and archive work) and records a `subscription_invoices` row.

**Paying:**
1. A receipt is recorded in the أثر company, from the admin panel or Athar itself, and allocated to the invoice through the existing receipt allocation.
2. When the allocation makes the invoice fully paid, a hook in the allocation service applies the `subscription_invoices` row once (`appliedAt` is set in the same transaction). It extends the company per §6 and writes a `receipt_applied` event.
3. Partial payments do not extend.
4. Un-allocating a receipt after it was applied does **not** silently shorten the term. It flags the subscription for owner review; there is no automatic reversal (D26).

**Statements:** the customer statement for a subscriber is the أثر company's ordinary customer statement for that customer, so the admin panel shows it through the internal API.

**Credit notes:** an over-billed or canceled period is corrected with a normal ZATCA credit note in the أثر company.

## 9. Admin panel (`athar-platform-admin`)

Everything goes through new internal endpoints under `/api/platform-admin/*` (same shared key). The admin panel's own `Invoice` table stops being the source of truth. It is kept read-only as history, mapped to companies during migration.

| Screen / action | Internal API (athar) |
|---|---|
| Companies list: owner, plan, period, status, end date, rank, net price, users / limit, add-ons, over-limit flag | `GET /platform-admin/companies` |
| Upgrade (now, prorated invoice) or downgrade (scheduled for renewal), D22 | `PATCH /platform-admin/companies/:id/subscription` |
| POS user assignments (D19) | `GET/PUT …/:id/pos-users` |
| Review queue: receipts un-allocated after an extension (D26) | `GET /platform-admin/subscription-reviews` |
| Set end date (real date; replaces today's "extend" that wrote `trialEndsAt`) | same |
| Suspend / activate (activate restores the by-date status) | `PATCH …/:id/status` |
| Add-on quantities, activity add-on state | `PATCH …/:id/addons` |
| Issue invoice (new, renewal, upgrade, add-on) | `POST …/:id/invoices` → أثر company sales invoice |
| Record receipt and allocate (D9 auto-extends) | `POST …/:id/receipts` |
| Customer statement | `GET …/:id/statement` |
| Legal entity and billing company | `GET/PUT /platform-admin/billing-company` |
| Price catalog with effective dates | `GET/POST /platform-admin/plan-prices` |
| Migration screen: set plan and end date for each legacy company, set grandfathered price | `PATCH …/:id/subscription` (+ `migrated` event) |

The admin panel keeps writing its own `AuditLog`, and every athar-side change also writes a `subscription_events` row.

## 10. Migration

**Sizing first.** `scripts/sql/subscription-migration-sizing.sql` is read-only and **has not been run on production**. The owner runs it. It returns, per company:
- owner identity and email, rank among the owner's companies, and the owner's company count;
- current tenant status, plan, trial end and `enabledModules`;
- active users (scoped plus `all`), and `pos_capable_users`: members whose position grants `pos.create`. This is only a list of candidates for the owner's POS assignments (D19). Nobody is a POS user until assigned, and owners and `super_admin` are not in this count;
- usage signals: warehouses, transfers, issue vouchers, fixed assets, employees.

It is tested on a multi-tenant database (two owners with same-named companies, one owner across two tenants): automatically by `productionQueries.integration.test.ts`, and specifically by `subscriptionSizingQuery.integration.test.ts`.

**Steps:**
1. **Create rows** for every company with `enforced = false`, mirroring today's tenant state (run after the #151 cutover, below):
   - `trialing` keeps `trialEndsAt`;
   - `suspended` → `suspended`;
   - `past_due` / `canceled` → `expired`, ending at the migration date;
   - **`active` → `active` with `currentPeriodEnd = NULL` and `legacyOpenEnded = true`.** That is the only time a null end date is allowed, and the database CHECK keeps such rows unenforced.
2. **POS assignments:** the owner assigns POS users per company from the candidates list (D19), within `1 + posUsers` (one free seat per POS-enabled company, D27).
3. **Owner input** (admin panel migration screen, D10):
   - **group companies:** plan and real end date set by the owner;
   - **external customers:** plan, end date and `grandfatheredNetPrice` from their current agreement or last admin-panel invoice. Those invoices are in the admin database, matched by `tenant_id`.
4. **Module restrictions:** tenants with a non-empty `enabledModules` are listed for owner review. Plans replace per-tenant module lists; any intentional restriction must be re-expressed as a plan choice.
5. **Activity add-ons:** set to `free` for every stations and stables company by activity (D13, D30).
6. **Turn on enforcement** company by company, only once every required field is filled. A company with a null end date cannot be switched on.
7. **Clean up:** after all companies are on, drop the deprecated `Tenant` fields and `isTenantReadOnly`.

**#151 interaction.**
- **Order:** run step 1 **after** the #151 cutover. Its separation script copies the source tenant row into each new tenant (subscription fields included), and per-company rows read the post-separation state.
- **Owner changes:** #151 sets each new tenant's `ownerId` to the designated administrator's membership, so those companies' **owner identity, and therefore discount scope, is that administrator's identity**. This is approved (D25): they are the owner's own group companies.

## 11. Open questions for the owner

None. Every question raised so far is answered (D16–D30). The stations and stables prices are deliberately left unset (D30) until an external customer needs them.

## 12. Phased PRs

| # | PR | Depends on |
|---|---|---|
| P0 | This design and the read-only sizing SQL with its tests | — |
| P1 | Data model: `company_subscriptions` (with its CHECKs), `subscription_events` (append-only trigger), `plan_prices` seeded with the approved prices (trigger: in-effect rows immutable), `company_pos_users` (same-tenant trigger), identity `emailVerifiedAt` / `trialConsumedAt`. **Tables created empty**, no `tenantId` copies (§3.1), nothing reads them yet: no behaviour change. `platform_settings` and `subscription_invoices` move to P7; the signup tables to P5. | — |
| P2 | `subscriptionPlans.ts` (plan → permission-id map, add-ons) and `previewSubscriptionPrice` with tests for every worked example above. Nothing calls them yet. | P1 |
| P3 | Lifecycle: real end dates, `subscriptionScheduler` (expire, reminders), admin-activate restores by-date status. Fixes "active never expires". | P1 |
| P4 | **Server enforcement:** module gate in `requirePositionAction`, per-company read-only, user and POS limits, behind `enforcement` | P1, P2. ~~#151~~ merged, no longer blocking (hooks after `assertCurrentMembership`) |
| P5 | Signup with plan, email verification, rate limiting, trial once per identity | P1, P2. ~~#151~~ merged, no longer blocking |
| P6 | Add-company flow with server price preview | P2. ~~#151~~ merged, no longer blocking (builds on its `CompaniesSettings.jsx` and `createCompany`) |
| P7 | Billing via the أثر company: billing-company setting, `issueSubscriptionInvoice`, `subscription_invoices`, receipt → extend hook | P1, P3 |
| P8 | Internal API for the admin panel (§9) | P1, P3, P7 |
| P9 | Admin panel (separate repo): companies screen, plan/end date, invoices, receipts, statements, legal entity, price catalog, migration screen | P8 |
| P10 | UI: nav from per-company allowed modules; landing and signup plan cards from `plan_prices` | P2, P4 |
| P11 | Migration execution: create the rows (§10 step 1), owner fills plans, end dates and POS assignments, enforcement on per company, then drop the deprecated `Tenant` fields | all of the above, after the **#151** cutover |

**Already done separately:** #157 refuses `POST /api/ai/ask` in read-only mode and adds the read-only guard coverage test. The per-company read-only in P4 builds on it.
