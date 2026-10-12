-- سجل إصدارات زاتكا (zatca_document_issues) وسجل محاولات الإرسال (zatca_submission_attempts) — كلاهما للإضافة فقط.
-- لماذا: إعادة إصدار مستند قياسي رفضته زاتكا تغيّر UUID وICV والتجزئة على صف المستند؛ الإصدار المرفوض وكل ما أُرسِل لزاتكا
-- يبقى هنا كما هو. القيدان الفريدان (companyId+icv، documentUuid) يمنعان إعادة استخدام ICV أو UUID في القاعدة نفسها.
-- CreateTable
CREATE TABLE "zatca_document_issues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "icv" INTEGER NOT NULL,
    "previousInvoiceHash" TEXT NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "supplyDate" TEXT,
    "reissueOfIssueId" TEXT,
    "compression" TEXT NOT NULL,
    "unsignedXml" BYTEA,
    "unsignedXmlSha256" TEXT,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zatca_document_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zatca_submission_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "icv" INTEGER NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "submissionKind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "compression" TEXT NOT NULL,
    "signedXml" BYTEA,
    "signedXmlSha256" TEXT,
    "response" JSONB,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zatca_submission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zatca_document_issues_documentUuid_key" ON "zatca_document_issues"("documentUuid");

-- CreateIndex
CREATE INDEX "zatca_document_issues_tenantId_documentType_documentId_idx" ON "zatca_document_issues"("tenantId", "documentType", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "zatca_document_issues_companyId_icv_key" ON "zatca_document_issues"("companyId", "icv");

-- CreateIndex
CREATE INDEX "zatca_submission_attempts_tenantId_documentType_documentId__idx" ON "zatca_submission_attempts"("tenantId", "documentType", "documentId", "attemptedAt");

-- CreateIndex
CREATE INDEX "zatca_submission_attempts_companyId_documentUuid_idx" ON "zatca_submission_attempts"("companyId", "documentUuid");


-- لا تعديل ولا حذف ولا تفريغ — نفس نمط zatca_document_archive
CREATE FUNCTION zatca_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zatca_document_issues_no_update_delete
  BEFORE UPDATE OR DELETE ON "zatca_document_issues"
  FOR EACH ROW EXECUTE FUNCTION zatca_append_only();
CREATE TRIGGER zatca_document_issues_no_truncate
  BEFORE TRUNCATE ON "zatca_document_issues"
  FOR EACH STATEMENT EXECUTE FUNCTION zatca_append_only();
CREATE TRIGGER zatca_submission_attempts_no_update_delete
  BEFORE UPDATE OR DELETE ON "zatca_submission_attempts"
  FOR EACH ROW EXECUTE FUNCTION zatca_append_only();
CREATE TRIGGER zatca_submission_attempts_no_truncate
  BEFORE TRUNCATE ON "zatca_submission_attempts"
  FOR EACH STATEMENT EXECUTE FUNCTION zatca_append_only();

-- استكمال رجعي: الإصدار الحالي لكل مستند حُجزت له سلسلة قبل هذا الترحيل (icv وتجزئتاه مخزَّنة على صفّه). ملف XML غير
-- الموقَّع لم يُحفَظ قبل اليوم فيبقى null (compression = 'none'). subtype مشتقّ من بطاقة العميل الحالية بنفس قاعدة
-- subtypeForCustomer (عميل أعمال برقم ضريبي = قياسي). ON CONFLICT DO NOTHING: لو تكرّر ICV أو UUID في بيانات قديمة (مستورد
-- مثلاً) يبقى الأسبق إصداراً (الترتيب أدناه) ولا يفشل النشر.
INSERT INTO "zatca_document_issues" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "previousInvoiceHash", "invoiceHash", "subtype", "issuedAt", "compression", "source")
SELECT 'bf_inv_' || d.id, d."tenantId", d."companyId", 'sales_invoice', d.id, d."invoiceNumber", d."zatcaUuid", d.icv,
  d."previousInvoiceHash", d."invoiceHash",
  CASE WHEN c."customerType" = 'business' AND COALESCE(c."vatNumber", '') <> '' THEN 'standard' ELSE 'simplified' END,
  d."zatcaSubmittedAt", 'none', 'backfill'
FROM "sales_invoices" d JOIN "customers" c ON c.id = d."customerId"
WHERE d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."previousInvoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
ORDER BY d.icv, d."zatcaSubmittedAt", d.id
ON CONFLICT DO NOTHING;

INSERT INTO "zatca_document_issues" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "previousInvoiceHash", "invoiceHash", "subtype", "issuedAt", "compression", "source")
SELECT 'bf_ret_' || d.id, d."tenantId", d."companyId", 'sales_return', d.id, d."returnNumber", d."zatcaUuid", d.icv,
  d."previousInvoiceHash", d."invoiceHash",
  CASE WHEN c."customerType" = 'business' AND COALESCE(c."vatNumber", '') <> '' THEN 'standard' ELSE 'simplified' END,
  d."zatcaSubmittedAt", 'none', 'backfill'
FROM "sales_returns" d JOIN "customers" c ON c.id = d."customerId"
WHERE d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."previousInvoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
ORDER BY d.icv, d."zatcaSubmittedAt", d.id
ON CONFLICT DO NOTHING;

INSERT INTO "zatca_document_issues" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "previousInvoiceHash", "invoiceHash", "subtype", "issuedAt", "compression", "source")
SELECT 'bf_dn_' || d.id, d."tenantId", d."companyId", 'sales_debit_note', d.id, d."debitNoteNumber", d."zatcaUuid", d.icv,
  d."previousInvoiceHash", d."invoiceHash",
  CASE WHEN c."customerType" = 'business' AND COALESCE(c."vatNumber", '') <> '' THEN 'standard' ELSE 'simplified' END,
  d."zatcaSubmittedAt", 'none', 'backfill'
FROM "sales_debit_notes" d JOIN "customers" c ON c.id = d."customerId"
WHERE d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."previousInvoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
ORDER BY d.icv, d."zatcaSubmittedAt", d.id
ON CONFLICT DO NOTHING;

-- استكمال رجعي لآخر ردّ محفوظ على كل مستند (zatcaResponseRaw) — قبل هذا الترحيل كان الرد الأخير يُكتَب فوق السابق على صف
-- المستند وحده، فهو كل ما بقي. يُنقَل هنا محاولةً بمصدر 'backfill' حتى لا يضيع حين تُغيِّر إعادة الإصدار صفّ المستند. ملف XML
-- الموقَّع لم يُحفَظ قبل اليوم (signedXml = NULL)، ونوع الإرسال وقتها غير معروف ('unknown').
INSERT INTO "zatca_submission_attempts" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "invoiceHash", "submissionKind", "outcome", "compression", "response", "source", "attemptedAt")
SELECT 'bf_inv_' || d.id, d."tenantId", d."companyId", 'sales_invoice', d.id, d."invoiceNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'unknown', d."zatcaStatus"::text, 'none', d."zatcaResponseRaw", 'backfill',
  COALESCE(d."zatcaLastAttemptAt", d."zatcaClearedOrReportedAt", d."zatcaSubmittedAt")
FROM "sales_invoices" d
WHERE d."zatcaResponseRaw" IS NOT NULL AND jsonb_typeof(d."zatcaResponseRaw") <> 'null' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL
  AND d."zatcaSubmittedAt" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "zatca_submission_attempts" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "invoiceHash", "submissionKind", "outcome", "compression", "response", "source", "attemptedAt")
SELECT 'bf_ret_' || d.id, d."tenantId", d."companyId", 'sales_return', d.id, d."returnNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'unknown', d."zatcaStatus"::text, 'none', d."zatcaResponseRaw", 'backfill',
  COALESCE(d."zatcaClearedOrReportedAt", d."zatcaSubmittedAt")
FROM "sales_returns" d
WHERE d."zatcaResponseRaw" IS NOT NULL AND jsonb_typeof(d."zatcaResponseRaw") <> 'null' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL
  AND d."zatcaSubmittedAt" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "zatca_submission_attempts" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber", "documentUuid",
  "icv", "invoiceHash", "submissionKind", "outcome", "compression", "response", "source", "attemptedAt")
SELECT 'bf_dn_' || d.id, d."tenantId", d."companyId", 'sales_debit_note', d.id, d."debitNoteNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'unknown', d."zatcaStatus"::text, 'none', d."zatcaResponseRaw", 'backfill',
  COALESCE(d."zatcaClearedOrReportedAt", d."zatcaSubmittedAt")
FROM "sales_debit_notes" d
WHERE d."zatcaResponseRaw" IS NOT NULL AND jsonb_typeof(d."zatcaResponseRaw") <> 'null' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL
  AND d."zatcaSubmittedAt" IS NOT NULL
ON CONFLICT DO NOTHING;
