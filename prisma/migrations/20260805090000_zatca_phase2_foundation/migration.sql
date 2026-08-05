-- ربط فاتورة (ZATCA) — المرحلة الثانية (التكامل): الأساس التقني الكامل. انظر
-- reference/ATHAR_BACKEND_SPEC.md §6 وخطة التنفيذ المعتمدة لهذه الميزة. هذه الهجرة إضافية بحتة
-- (لا تغيّر أي سلوك حالي) — كل الأعمدة الجديدة اختيارية أو لها قيمة افتراضية آمنة، والجداول
-- الجديدة (SalesDebitNote, CompanyZatcaCredential) لا تُستخدَم بعد من أي كود قائم.

-- CreateEnum
CREATE TYPE "ZatcaOnboardingStatus" AS ENUM ('not_onboarded', 'compliance', 'production');

-- CreateEnum
CREATE TYPE "ZatcaEnvironment" AS ENUM ('sandbox', 'simulation', 'production');

-- CreateEnum
CREATE TYPE "ZatcaDocumentStatus" AS ENUM ('not_applicable', 'pending_clearance', 'cleared', 'pending_reporting', 'reported', 'rejected');

-- CreateEnum
CREATE TYPE "TaxCategoryCode" AS ENUM ('S', 'Z', 'E', 'O');

-- AlterTable: Company — إعدادات ربط زاتكا لكل شركة (EGS/CSID/ICV/PIH)
ALTER TABLE "companies" ADD COLUMN     "zatcaEgsUuid" TEXT,
ADD COLUMN     "zatcaEnvironment" "ZatcaEnvironment" NOT NULL DEFAULT 'sandbox',
ADD COLUMN     "zatcaLastInvoiceHash" TEXT,
ADD COLUMN     "zatcaModel" TEXT,
ADD COLUMN     "zatcaNextIcv" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "zatcaOnboardingStatus" "ZatcaOnboardingStatus" NOT NULL DEFAULT 'not_onboarded',
ADD COLUMN     "zatcaSolutionName" TEXT;

-- AlterTable: SalesInvoiceLine — تصنيف الضريبة القياسي لزاتكا
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "taxCategoryCode" "TaxCategoryCode" NOT NULL DEFAULT 'S',
ADD COLUMN     "taxExemptionReason" TEXT;

-- AlterTable: SalesInvoice — حقول زاتكا؛ zatcaUuid يُضاف مبدئياً قابلاً للـNULL لتفادي كسر
-- الصفوف الحالية، ثم يُملأ بقيمة فريدة لكل صف موجود، ثم يُفرَض NOT NULL بعد التعبئة.
ALTER TABLE "sales_invoices" ADD COLUMN     "icv" INTEGER,
ADD COLUMN     "invoiceHash" TEXT,
ADD COLUMN     "pdfAttachmentId" TEXT,
ADD COLUMN     "previousInvoiceHash" TEXT,
ADD COLUMN     "xmlAttachmentId" TEXT,
ADD COLUMN     "zatcaClearedOrReportedAt" TIMESTAMP(3),
ADD COLUMN     "zatcaResponseRaw" JSONB,
ADD COLUMN     "zatcaStatus" "ZatcaDocumentStatus" NOT NULL DEFAULT 'not_applicable',
ADD COLUMN     "zatcaSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "zatcaUuid" TEXT;

UPDATE "sales_invoices" SET "zatcaUuid" = gen_random_uuid()::text WHERE "zatcaUuid" IS NULL;

ALTER TABLE "sales_invoices" ALTER COLUMN "zatcaUuid" SET NOT NULL;

-- AlterTable: SalesReturnLine — نفس تصنيف الضريبة
ALTER TABLE "sales_return_lines" ADD COLUMN     "taxCategoryCode" "TaxCategoryCode" NOT NULL DEFAULT 'S',
ADD COLUMN     "taxExemptionReason" TEXT;

-- AlterTable: SalesReturn — نفس معالجة zatcaUuid أعلاه
ALTER TABLE "sales_returns" ADD COLUMN     "icv" INTEGER,
ADD COLUMN     "invoiceHash" TEXT,
ADD COLUMN     "pdfAttachmentId" TEXT,
ADD COLUMN     "previousInvoiceHash" TEXT,
ADD COLUMN     "xmlAttachmentId" TEXT,
ADD COLUMN     "zatcaClearedOrReportedAt" TIMESTAMP(3),
ADD COLUMN     "zatcaResponseRaw" JSONB,
ADD COLUMN     "zatcaStatus" "ZatcaDocumentStatus" NOT NULL DEFAULT 'not_applicable',
ADD COLUMN     "zatcaSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "zatcaUuid" TEXT;

UPDATE "sales_returns" SET "zatcaUuid" = gen_random_uuid()::text WHERE "zatcaUuid" IS NULL;

ALTER TABLE "sales_returns" ALTER COLUMN "zatcaUuid" SET NOT NULL;

-- CreateTable: أسرار ربط زاتكا الخاصة بكل شركة (مُشفّرة، انظر src/lib/zatca/secretBox.ts)
CREATE TABLE "company_zatca_credentials" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "privateKeyEnc" TEXT,
    "csrPem" TEXT,
    "complianceCertEnc" TEXT,
    "complianceSecretEnc" TEXT,
    "complianceRequestId" TEXT,
    "productionCertEnc" TEXT,
    "productionSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_zatca_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: إشعار مدين (Debit Note) — جدول جديد بالكامل، لا صفوف موجودة فتُفرَض NOT NULL مباشرة
CREATE TABLE "sales_debit_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "debitNoteNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "relatedInvoiceId" TEXT,
    "reason" TEXT,
    "chargeMethod" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'posted',
    "journalEntryId" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "zatcaUuid" TEXT NOT NULL,
    "icv" INTEGER,
    "previousInvoiceHash" TEXT,
    "invoiceHash" TEXT,
    "xmlAttachmentId" TEXT,
    "pdfAttachmentId" TEXT,
    "zatcaStatus" "ZatcaDocumentStatus" NOT NULL DEFAULT 'not_applicable',
    "zatcaResponseRaw" JSONB,
    "zatcaSubmittedAt" TIMESTAMP(3),
    "zatcaClearedOrReportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_debit_note_lines" (
    "id" TEXT NOT NULL,
    "debitNoteId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priceIncludesVat" BOOLEAN NOT NULL DEFAULT false,
    "taxCategoryCode" "TaxCategoryCode" NOT NULL DEFAULT 'S',
    "taxExemptionReason" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_debit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_zatca_credentials_companyId_key" ON "company_zatca_credentials"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_debit_notes_zatcaUuid_key" ON "sales_debit_notes"("zatcaUuid");

-- CreateIndex
CREATE UNIQUE INDEX "sales_debit_notes_tenantId_debitNoteNumber_key" ON "sales_debit_notes"("tenantId", "debitNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_zatcaUuid_key" ON "sales_invoices"("zatcaUuid");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_zatcaUuid_key" ON "sales_returns"("zatcaUuid");

-- AddForeignKey
ALTER TABLE "company_zatca_credentials" ADD CONSTRAINT "company_zatca_credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_debit_notes" ADD CONSTRAINT "sales_debit_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_debit_notes" ADD CONSTRAINT "sales_debit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_debit_notes" ADD CONSTRAINT "sales_debit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_debit_note_lines" ADD CONSTRAINT "sales_debit_note_lines_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "sales_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_debit_note_lines" ADD CONSTRAINT "sales_debit_note_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
