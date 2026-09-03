import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { ensurePartyAccount, resolvePartyAccountId } from "../../lib/partyAccounts";
import { extractCompanyDataFromDocument, CompanyDocType } from "../../lib/claudeVision";
import { createAttachment } from "../attachments/attachments.service";
import { translateMessage } from "../../lib/i18n/translate";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

export const listCustomers: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const customers = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(customers);
};

/** رصيد ذمم العميل من واقع أسطر القيود المرحّلة فعلياً على حسابه المستقل — مطابق لـ customerAccountBalance */
export const getCustomerBalance: RequestHandler = async (req, res) => {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!customer) throw notFound("العميل غير موجود");
  assertCompanyAccess(req.auth!, customer.companyId);
  const accountId = await resolvePartyAccountId(req.auth!.tenantId, customer.companyId, customer, "ذمم مدينة");

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      customerId: customer.id,
      accountId,
      journalEntry: { tenantId: req.auth!.tenantId },
    },
    select: { debit: true, credit: true },
  });
  const balance = lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  res.json({ balance });
};

/** إنشاء عميل جديد مع حساب تفصيلي مستقل تلقائي تحت "الذمم المدينة التجارية" (partyAccounts.ts) */
export const createCustomer: RequestHandler = async (req, res) => {
  await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);
  const customer = await prisma.$transaction(async (tx) => {
    const { accountId } = await ensurePartyAccount(tx, {
      tenantId: req.auth!.tenantId, companyId: req.body.companyId, kind: "customer", partyName: req.body.name,
    });
    return tx.customer.create({ data: { ...req.body, tenantId: req.auth!.tenantId, accountId } });
  });
  res.status(201).json(customer);
};

export const updateCustomer: RequestHandler = async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("العميل غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);
  if (req.body.companyId) await assertCompanyBelongsToTenant(req.auth!.tenantId, req.body.companyId);

  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: existing.id }, data: req.body });
    // مزامنة اسم الحساب المستقل تلقائياً مع اسم العميل عند إعادة التسمية
    if (updated.accountId && req.body.name && req.body.name !== existing.name) {
      await tx.account.update({ where: { id: updated.accountId }, data: { name: req.body.name } });
    }
    return updated;
  });
  res.json(customer);
};

export const deleteCustomer: RequestHandler = async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("العميل غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);

  const [quotations, salesInvoices, salesReturns, receipts, journalLines] = await Promise.all([
    prisma.quotation.count({ where: { customerId: existing.id } }),
    prisma.salesInvoice.count({ where: { customerId: existing.id } }),
    prisma.salesReturn.count({ where: { customerId: existing.id } }),
    prisma.receipt.count({ where: { customerId: existing.id } }),
    prisma.journalEntryLine.count({ where: { customerId: existing.id } }),
  ]);
  if (quotations || salesInvoices || salesReturns || receipts || journalLines) {
    const reasons = [
      salesInvoices ? `${salesInvoices} فاتورة مبيعات` : "",
      quotations ? `${quotations} عرض سعر` : "",
      salesReturns ? `${salesReturns} مردود مبيعات` : "",
      receipts ? `${receipts} سند قبض` : "",
      journalLines ? `${journalLines} حركة في القيود` : "",
    ].filter(Boolean).join("، ");
    throw badRequest(`لا يمكن حذف هذا العميل لارتباطه بـ ${reasons}. عدّل بيانات العميل بدلاً من حذفه إن لزم الأمر.`);
  }

  await prisma.customer.delete({ where: { id: existing.id } });
  res.status(204).send();
};

// نفس دالة استخراج بيانات الشركة من مستند (claudeVision.ts) بالضبط — عامة بالفعل وغير مرتبطة
// بـ"شركة" تحديداً (Tool Use يستخرج فقط الحقول المطلوبة لنوع المستند)، فتُعاد هنا بلا أي تكرار
// لمنطق الذكاء الاصطناعي. تُحوَّل فقط أسماء الحقول من تسمية الشركة (addressBuilding..) إلى تسمية
// نموذج العميل (buildingNo..) حتى تُطبَّق مباشرة على حالة النموذج بالواجهة الأمامية بلا أي تحويل
// إضافي هناك؛ shortName/crIssueDate/crExpiryDate لا مقابل لها في نموذج العميل فتُهمَل بصمت.
const CUSTOMER_FIELD_KEY_MAP: Record<string, string> = {
  addressBuilding: "buildingNo",
  addressStreet: "street",
  addressDistrict: "district",
  addressCity: "city",
  addressPostalCode: "postalCode",
  addressAdditionalNo: "additionalNo",
};
const CUSTOMER_UNSUPPORTED_FIELDS = new Set(["shortName", "crIssueDate", "crExpiryDate"]);

/** رفع مستند رسمي للعميل (سجل تجاري/شهادة عنوان وطني/شهادة ضريبية) واستخراج بياناته تلقائياً
 * بالذكاء الاصطناعي — المستند يُحفَظ كمرفق دائم بصرف النظر عن نجاح الاستخراج (نفس منطق
 * companies.controller.ts's extractDocumentHandler تماماً)، والحقول المستخرجة تُعرَض للمستخدم
 * ليراجعها ويعدّلها قبل الحفظ الفعلي — لا حفظ تلقائي مباشر بلا مراجعة. */
export const extractCustomerDocument: RequestHandler = async (req, res) => {
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("العميل غير موجود");
  assertCompanyAccess(req.auth!, existing.companyId);
  if (!req.file) throw badRequest("الملف مطلوب");

  const docType = req.body.docType as CompanyDocType;

  const attachment = await createAttachment(req.auth!.tenantId, req.auth!.sub, {
    entityType: "customer",
    entityId: existing.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
  });

  try {
    const extraction = await extractCompanyDataFromDocument(req.file.buffer, req.file.mimetype, docType);
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(extraction.fields)) {
      if (CUSTOMER_UNSUPPORTED_FIELDS.has(key)) continue;
      fields[CUSTOMER_FIELD_KEY_MAP[key] || key] = value;
    }
    res.json({ ...extraction, fields, attachment });
  } catch (err) {
    res.json({
      fields: {},
      confidence: "low",
      confidenceNote: translateMessage(err instanceof Error ? err.message : "تعذّر استخراج البيانات من هذا المستند", req.lang),
      attachment,
    });
  }
};
