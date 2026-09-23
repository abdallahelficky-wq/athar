-- Separates the auto-generated customer/supplier sub-ledger accounts from the standard,
-- manually-seeded receivable/payable accounts that used to share the same parent group
-- ("112" الذمم المدينة التجارية / "211" الذمم الدائنة التجارية).
--
-- Design: keep "112"/"211" as the (renamed) sub-ledger parent that partyAccounts.ts still
-- targets unchanged, and move only the standard accounts out to two new sibling level-3
-- groups ("117"/"217"), leaving codes, levels and isPosting untouched on every moved
-- account. No account is renumbered, no journal_entry_lines row is touched, and no
-- Company.zatcaNextIcv/zatcaLastInvoiceHash-style counter exists on this path to disturb.
--
-- "Standard" vs. "sub-ledger" is decided per company by whether Customer.accountId /
-- Supplier.accountId references the child account — NOT by a fixed code list, because the
-- exact set of standard accounts seeded under 112/211 differs across the chart templates
-- (5 to 7 for customers, 4 to 5 for suppliers, depending on business activity).
--
-- DEPLOY SAFETY: this runs as part of every production boot (`prisma migrate deploy &&
-- node server.js`), against every company on the platform, so it must never abort the
-- deployment. Every company is processed inside its own BEGIN/EXCEPTION block: a missing
-- or mismatched 112/211, a "117"/"217" code already taken by something else, an
-- already-migrated (or already-correct freshly-seeded) chart, or any other unanticipated
-- error is caught, logged, and that one company is skipped — the loop always continues to
-- the next company, and this DO block itself never raises past its own boundary. Every
-- skip is logged via RAISE NOTICE with the company id, name and the specific reason
-- (visible in Railway's deploy logs), plus one final summary line with the totals.
DO $migration$
DECLARE
  company_row RECORD;
  companies_examined INT := 0;
  companies_migrated INT := 0;
  companies_skipped INT := 0;
  company_label TEXT;

  v11_id TEXT; v112_id TEXT; v117_id TEXT;
  v117_level INT; v117_type TEXT; v117_isposting BOOLEAN; v117_parentid TEXT;
  v21_id TEXT; v211_id TEXT; v217_id TEXT;
  v217_level INT; v217_type TEXT; v217_isposting BOOLEAN; v217_parentid TEXT;
  moved_count INT;
  renamed_count INT;
  created_117 BOOLEAN;
  created_217 BOOLEAN;
  receivables_ok BOOLEAN;
  payables_ok BOOLEAN;
  receivables_reason TEXT;
  payables_reason TEXT;
BEGIN
  FOR company_row IN
    SELECT DISTINCT a."tenantId" AS tenant_id, a."companyId" AS company_id
    FROM "accounts" a
    WHERE a."code" IN ('112', '211')
  LOOP
    companies_examined := companies_examined + 1;
    receivables_ok := false;
    payables_ok := false;
    receivables_reason := NULL;
    payables_reason := NULL;

    BEGIN
      SELECT c."name" INTO company_label FROM "companies" c WHERE c."id" = company_row.company_id;
      IF company_label IS NULL THEN
        company_label := '(نطاق عام بلا شركة محدَّدة — المستأجر ' || company_row.tenant_id || ')';
      END IF;

      -- ============================== Receivables: 112 -> 117 ==============================
      v11_id := NULL; v112_id := NULL;
      SELECT a."id", p."id" INTO v112_id, v11_id
      FROM "accounts" a
      JOIN "accounts" p ON p."id" = a."parentId"
      WHERE a."tenantId" = company_row.tenant_id AND a."companyId" IS NOT DISTINCT FROM company_row.company_id
        AND a."code" = '112' AND a."level" = 3 AND a."type" = 'asset' AND a."isPosting" = false
        AND p."code" = '11' AND p."level" = 2 AND p."type" = 'asset' AND p."isPosting" = false;

      IF v112_id IS NULL THEN
        receivables_reason := 'لا يوجد حساب "112" مطابق للشكل المتوقع (مستوى 3 / أصول / غير قابل للترحيل) تحت أب "11" صحيح';
      ELSE
        v117_id := NULL; v117_level := NULL; v117_type := NULL; v117_isposting := NULL; v117_parentid := NULL;
        SELECT "id", "level", "type"::text, "isPosting", "parentId"
          INTO v117_id, v117_level, v117_type, v117_isposting, v117_parentid
        FROM "accounts"
        WHERE "tenantId" = company_row.tenant_id AND "companyId" IS NOT DISTINCT FROM company_row.company_id AND "code" = '117';

        IF v117_id IS NOT NULL AND NOT (v117_level = 3 AND v117_type = 'asset' AND v117_isposting = false AND v117_parentid = v11_id) THEN
          receivables_reason := 'الكود "117" مستخدَم بالفعل بحساب لا يطابق شكل مجموعة الذمم المدينة القياسية المتوقّع';
        ELSE
          created_117 := false;
          IF v117_id IS NULL THEN
            v117_id := md5('party-subledger-grouping-117-' || company_row.tenant_id || '-' || COALESCE(company_row.company_id, 'group'));
            INSERT INTO "accounts" (
              "id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived",
              "name", "nameEn", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt"
            ) VALUES (
              v117_id, company_row.tenant_id, company_row.company_id, v11_id, '117', 3, false, false,
              'الذمم المدينة القياسية', 'Standard Trade Receivables', 'asset', true, false, NOW(), NOW()
            );
            created_117 := true;
          END IF;

          UPDATE "accounts" child SET "parentId" = v117_id
          WHERE child."parentId" = v112_id AND child."level" = 4 AND child."isPosting" = true
            AND NOT EXISTS (
              SELECT 1 FROM "customers" c
              WHERE c."tenantId" = company_row.tenant_id AND c."companyId" IS NOT DISTINCT FROM company_row.company_id
                AND c."accountId" = child."id"
            );
          GET DIAGNOSTICS moved_count = ROW_COUNT;

          UPDATE "accounts" SET "name" = 'عملاء', "nameEn" = 'Customers'
          WHERE "id" = v112_id AND ("name" IS DISTINCT FROM 'عملاء' OR "nameEn" IS DISTINCT FROM 'Customers');
          GET DIAGNOSTICS renamed_count = ROW_COUNT;

          IF created_117 OR moved_count > 0 OR renamed_count > 0 THEN
            receivables_ok := true;
          ELSE
            receivables_reason := 'الشركة محدَّثة بالفعل (117 موجودة ومطابقة، ولا حسابات قياسية متبقية تحت 112، والاسم صحيح بالفعل)';
          END IF;
        END IF;
      END IF;

      -- ============================== Payables: 211 -> 217 ==============================
      v21_id := NULL; v211_id := NULL;
      SELECT a."id", p."id" INTO v211_id, v21_id
      FROM "accounts" a
      JOIN "accounts" p ON p."id" = a."parentId"
      WHERE a."tenantId" = company_row.tenant_id AND a."companyId" IS NOT DISTINCT FROM company_row.company_id
        AND a."code" = '211' AND a."level" = 3 AND a."type" = 'liability' AND a."isPosting" = false
        AND p."code" = '21' AND p."level" = 2 AND p."type" = 'liability' AND p."isPosting" = false;

      IF v211_id IS NULL THEN
        payables_reason := 'لا يوجد حساب "211" مطابق للشكل المتوقع (مستوى 3 / التزامات / غير قابل للترحيل) تحت أب "21" صحيح';
      ELSE
        v217_id := NULL; v217_level := NULL; v217_type := NULL; v217_isposting := NULL; v217_parentid := NULL;
        SELECT "id", "level", "type"::text, "isPosting", "parentId"
          INTO v217_id, v217_level, v217_type, v217_isposting, v217_parentid
        FROM "accounts"
        WHERE "tenantId" = company_row.tenant_id AND "companyId" IS NOT DISTINCT FROM company_row.company_id AND "code" = '217';

        IF v217_id IS NOT NULL AND NOT (v217_level = 3 AND v217_type = 'liability' AND v217_isposting = false AND v217_parentid = v21_id) THEN
          payables_reason := 'الكود "217" مستخدَم بالفعل بحساب لا يطابق شكل مجموعة الذمم الدائنة القياسية المتوقّع';
        ELSE
          created_217 := false;
          IF v217_id IS NULL THEN
            v217_id := md5('party-subledger-grouping-217-' || company_row.tenant_id || '-' || COALESCE(company_row.company_id, 'group'));
            INSERT INTO "accounts" (
              "id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived",
              "name", "nameEn", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt"
            ) VALUES (
              v217_id, company_row.tenant_id, company_row.company_id, v21_id, '217', 3, false, false,
              'الذمم الدائنة القياسية', 'Standard Trade Payables', 'liability', true, false, NOW(), NOW()
            );
            created_217 := true;
          END IF;

          UPDATE "accounts" child SET "parentId" = v217_id
          WHERE child."parentId" = v211_id AND child."level" = 4 AND child."isPosting" = true
            AND NOT EXISTS (
              SELECT 1 FROM "suppliers" s
              WHERE s."tenantId" = company_row.tenant_id AND s."companyId" IS NOT DISTINCT FROM company_row.company_id
                AND s."accountId" = child."id"
            );
          GET DIAGNOSTICS moved_count = ROW_COUNT;

          UPDATE "accounts" SET "name" = 'موردون', "nameEn" = 'Suppliers'
          WHERE "id" = v211_id AND ("name" IS DISTINCT FROM 'موردون' OR "nameEn" IS DISTINCT FROM 'Suppliers');
          GET DIAGNOSTICS renamed_count = ROW_COUNT;

          IF created_217 OR moved_count > 0 OR renamed_count > 0 THEN
            payables_ok := true;
          ELSE
            payables_reason := 'الشركة محدَّثة بالفعل (217 موجودة ومطابقة، ولا حسابات قياسية متبقية تحت 211، والاسم صحيح بالفعل)';
          END IF;
        END IF;
      END IF;

      IF receivables_ok OR payables_ok THEN
        companies_migrated := companies_migrated + 1;
        RAISE NOTICE '[party_subledger_grouping] MIGRATED company_id=% company_name=% receivables=% payables=%',
          COALESCE(company_row.company_id, '(group)'), company_label,
          CASE WHEN receivables_ok THEN 'done' ELSE COALESCE(receivables_reason, 'n/a') END,
          CASE WHEN payables_ok THEN 'done' ELSE COALESCE(payables_reason, 'n/a') END;
      ELSE
        companies_skipped := companies_skipped + 1;
        RAISE NOTICE '[party_subledger_grouping] SKIPPED company_id=% company_name=% receivables_reason=% payables_reason=%',
          COALESCE(company_row.company_id, '(group)'), company_label,
          COALESCE(receivables_reason, 'n/a'), COALESCE(payables_reason, 'n/a');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      companies_skipped := companies_skipped + 1;
      RAISE NOTICE '[party_subledger_grouping] SKIPPED (unexpected error) company_id=% tenant_id=% error=%',
        COALESCE(company_row.company_id, '(group)'), company_row.tenant_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '[party_subledger_grouping] SUMMARY companies_examined=% companies_migrated=% companies_skipped=%',
    companies_examined, companies_migrated, companies_skipped;
END;
$migration$;
