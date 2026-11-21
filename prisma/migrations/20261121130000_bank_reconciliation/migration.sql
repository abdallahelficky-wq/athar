-- التسوية البنكية: كشوف البنك وأسطرها ومطابقتها مع أسطر القيود (schema.prisma: BankStatement/BankStatementLine).
-- أسماء الجداول الفعلية (@@map): bank_statements، bank_statement_lines؛ وأسطر القيود journal_entry_lines.

-- CreateEnum
CREATE TYPE "BankStatementStatus" AS ENUM ('open', 'reconciled');

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "fileName" TEXT,
    "status" "BankStatementStatus" NOT NULL DEFAULT 'open',
    "createdById" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "journalEntryLineId" TEXT,
    "matchType" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedById" TEXT,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_tenantId_companyId_accountId_idx" ON "bank_statements"("tenantId", "companyId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_journalEntryLineId_key" ON "bank_statement_lines"("journalEntryLineId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_statementId_lineNo_idx" ON "bank_statement_lines"("statementId", "lineNo");

-- CreateIndex
CREATE INDEX "bank_statement_lines_tenantId_companyId_idx" ON "bank_statement_lines"("tenantId", "companyId");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_journalEntryLineId_fkey" FOREIGN KEY ("journalEntryLineId") REFERENCES "journal_entry_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- خط الدفاع الأخير: لا يُحذف سطر قيد مطابَق في كشف مُسوّى من أي مسار (الخادم يرفض قبل ذلك برسالة واضحة —
-- assertNotBankReconciled). حذف سطر مطابَق في كشف مفتوح مسموح ويفكّ المطابقة (ON DELETE SET NULL أعلاه).
CREATE OR REPLACE FUNCTION bank_reconciled_line_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bank_statement_lines" l JOIN "bank_statements" s ON s."id" = l."statementId"
    WHERE l."journalEntryLineId" = OLD."id" AND s."status" = 'reconciled'
  ) THEN
    RAISE EXCEPTION 'bank_reconciled_line_guard: journal entry line % is matched in a reconciled bank statement', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_lines_bank_reconciled_guard BEFORE DELETE ON "journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION bank_reconciled_line_guard();
