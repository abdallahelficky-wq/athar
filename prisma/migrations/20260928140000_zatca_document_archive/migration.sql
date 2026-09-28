-- أرشيف مستندات زاتكا: الأصل الموقَّع لكل مستند قُبِل تخليصه أو إبلاغه، وملف XML المُخلَّص من زاتكا للقياسي.
-- بلا مفاتيح أجنبية، وبلا أي تعديل أو حذف (المُشغِّلات أدناه). راجع docs/zatca-archive.md.
-- CreateTable
CREATE TABLE "zatca_document_archive" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "icv" INTEGER NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "submissionKind" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "sellerVatNumber" TEXT,
    "compression" TEXT NOT NULL,
    "signedXml" BYTEA,
    "signedXmlSha256" TEXT,
    "clearedXml" BYTEA,
    "clearedXmlSha256" TEXT,
    "source" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zatca_document_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zatca_document_archive_tenantId_companyId_issuedAt_idx" ON "zatca_document_archive"("tenantId", "companyId", "issuedAt");

-- CreateIndex
CREATE INDEX "zatca_document_archive_documentType_documentId_idx" ON "zatca_document_archive"("documentType", "documentId");


-- لا تعديل ولا حذف ولا تفريغ — الأرشيف يُكتَب مرة واحدة فقط
CREATE FUNCTION zatca_document_archive_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'zatca_document_archive is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER zatca_document_archive_no_update_delete
  BEFORE UPDATE OR DELETE ON "zatca_document_archive"
  FOR EACH ROW EXECUTE FUNCTION zatca_document_archive_immutable();

CREATE TRIGGER zatca_document_archive_no_truncate
  BEFORE TRUNCATE ON "zatca_document_archive"
  FOR EACH STATEMENT EXECUTE FUNCTION zatca_document_archive_immutable();

-- فكّ base64 بلا إسقاط الترحيل: قيمة تالفة في رد زاتكا المحفوظ تُتخطّى (NULL) بدل أن تُفشِل النشر كله. ولا يُقبَل إلا ما
-- يبدو مستند XML فعلاً: غير فارغ، وأول بايت بعد BOM والمسافات البيضاء هو "<" — وإلا فالنتيجة NULL (يظهر "missing"
-- في التصدير بدل ملف فارغ أو بايتات عشوائية مُعلَّمة "archived").
CREATE FUNCTION zatca_archive_try_decode_base64(v TEXT) RETURNS BYTEA AS $$
DECLARE
  b BYTEA;
  i INT := 0;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  b := decode(v, 'base64');
  IF length(b) >= 3 AND substring(b FROM 1 FOR 3) = '\xefbbbf'::bytea THEN i := 3; END IF;
  WHILE i < length(b) AND get_byte(b, i) IN (9, 10, 13, 32) LOOP i := i + 1; END LOOP;
  IF i >= length(b) OR get_byte(b, i) <> 60 THEN RETURN NULL; END IF;
  RETURN b;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- استكمال رجعي: المستندات المُخلَّصة التي بقي ملف XML المُخلَّص من زاتكا محفوظاً في ردّها (zatcaResponseRaw.clearedInvoice،
-- base64). هذا هو المستند القانوني المُخلَّص كما أصدرته زاتكا. أما ملف XML الموقَّع الذي أرسلناه نحن لها فلم يُحفَظ قط
-- ولا يمكن استرجاعه (signedXml = NULL). الرقم الضريبي للبائع من سجل الشركة الحالي؛ التصدير يقرؤه من المستند نفسه.
INSERT INTO "zatca_document_archive" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber",
  "documentUuid", "icv", "invoiceHash", "subtype", "submissionKind", "issuedAt", "sellerVatNumber", "compression",
  "clearedXml", "clearedXmlSha256", "source")
SELECT 'bf_inv_' || d.id, d."tenantId", d."companyId", 'sales_invoice', d.id, d."invoiceNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'standard', 'clearance', d."zatcaSubmittedAt", c."vatNumber", 'none',
  zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice'), encode(sha256(zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice')), 'hex'), 'backfill'
FROM "sales_invoices" d JOIN "companies" c ON c.id = d."companyId"
WHERE d."zatcaStatus" = 'cleared' AND jsonb_typeof(d."zatcaResponseRaw"->'clearedInvoice') = 'string' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
  AND zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice') IS NOT NULL;

INSERT INTO "zatca_document_archive" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber",
  "documentUuid", "icv", "invoiceHash", "subtype", "submissionKind", "issuedAt", "sellerVatNumber", "compression",
  "clearedXml", "clearedXmlSha256", "source")
SELECT 'bf_ret_' || d.id, d."tenantId", d."companyId", 'sales_return', d.id, d."returnNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'standard', 'clearance', d."zatcaSubmittedAt", c."vatNumber", 'none',
  zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice'), encode(sha256(zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice')), 'hex'), 'backfill'
FROM "sales_returns" d JOIN "companies" c ON c.id = d."companyId"
WHERE d."zatcaStatus" = 'cleared' AND jsonb_typeof(d."zatcaResponseRaw"->'clearedInvoice') = 'string' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
  AND zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice') IS NOT NULL;

INSERT INTO "zatca_document_archive" ("id", "tenantId", "companyId", "documentType", "documentId", "documentNumber",
  "documentUuid", "icv", "invoiceHash", "subtype", "submissionKind", "issuedAt", "sellerVatNumber", "compression",
  "clearedXml", "clearedXmlSha256", "source")
SELECT 'bf_dn_' || d.id, d."tenantId", d."companyId", 'sales_debit_note', d.id, d."debitNoteNumber", d."zatcaUuid", d.icv, d."invoiceHash",
  'standard', 'clearance', d."zatcaSubmittedAt", c."vatNumber", 'none',
  zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice'), encode(sha256(zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice')), 'hex'), 'backfill'
FROM "sales_debit_notes" d JOIN "companies" c ON c.id = d."companyId"
WHERE d."zatcaStatus" = 'cleared' AND jsonb_typeof(d."zatcaResponseRaw"->'clearedInvoice') = 'string' AND d.icv IS NOT NULL AND d."invoiceHash" IS NOT NULL AND d."zatcaSubmittedAt" IS NOT NULL
  AND zatca_archive_try_decode_base64(d."zatcaResponseRaw"->>'clearedInvoice') IS NOT NULL;
