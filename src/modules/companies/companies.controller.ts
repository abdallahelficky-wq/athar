import { RequestHandler } from "express";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { buildObjectKey, uploadObject, getPresignedGetUrl } from "../../lib/storage";
import { extractCompanyDataFromDocument, CompanyDocType } from "../../lib/claudeVision";
import { createAttachment } from "../attachments/attachments.service";
import { createChartFromTemplate, DEFAULT_CHART_OF_ACCOUNTS } from "../../lib/defaultChartOfAccounts";
import { CHART_TEMPLATE_BY_ACTIVITY, BusinessActivity } from "../../lib/chartTemplates";
import { createStarterItems, createCashParties, createDefaultWarehouse } from "../../lib/starterData";
import { translateMessage } from "../../lib/i18n/translate";

const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5MB يكفي لأي شعار
const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export const uploadLogoFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LOGO_SIZE } }).single(
  "file",
);

/** يستبدل logoKey الداخلي (مفتاح تخزين) برابط مؤقت صالح فعلياً — لا نُخزّن أي رابط دائم */
async function withLogoUrl<T extends { logoKey: string | null }>(company: T) {
  const { logoKey, ...rest } = company;
  return { ...rest, logoUrl: logoKey ? await getPresignedGetUrl(logoKey) : null };
}

export const listCompanies: RequestHandler = async (req, res) => {
  const { companyScope } = req.auth!;
  const companies = await prisma.company.findMany({
    // مستخدم مقيَّد بشركة واحدة (companyScope غير "all") لا يرى غيرها إطلاقاً، حتى في قائمة
    // اختيار الشركة النشطة على الشاشة الرئيسية
    where: { tenantId: req.auth!.tenantId, id: companyScope !== "all" ? companyScope : undefined },
    orderBy: { createdAt: "asc" },
  });
  res.json(await Promise.all(companies.map(withLogoUrl)));
};

export const createCompany: RequestHandler = async (req, res) => {
  const company = await prisma.$transaction(
    async (tx) => {
      const created = await tx.company.create({ data: { ...req.body, tenantId: req.auth!.tenantId } });

      const activity = created.businessActivity as BusinessActivity | null;
      // شجرة قطاعية مبنية من ملف CSV الخاص بالنشاط إن اختير، وإلا القالب العام الافتراضي — نقطة
      // انطلاق فقط في الحالتين، تبقى الشركة حرة بالكامل في تعديل/حذف/إضافة أي حساب بعدها.
      const template = activity ? CHART_TEMPLATE_BY_ACTIVITY[activity] : DEFAULT_CHART_OF_ACCOUNTS;
      const idByCode = await createChartFromTemplate(tx, req.auth!.tenantId, created.id, template);

      if (activity) await createStarterItems(tx, req.auth!.tenantId, created.id, activity, idByCode);
      // عميل نقدي ومورد نقدي لكل شركة جديدة بصرف النظر عن نشاطها، حتى يمكن إصدار أول فاتورة فوراً
      await createCashParties(tx, req.auth!.tenantId, created.id);
      // مستودع افتراضي — شرط أساسي لبيع أي صنف مخزوني، بدونه لا تكتمل "بدون أي إعداد يدوي"
      await createDefaultWarehouse(tx, req.auth!.tenantId, created.id);

      return created;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  res.status(201).json(await withLogoUrl(company));
};

export const updateCompany: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, existing.id);

  const company = await prisma.company.update({ where: { id: existing.id }, data: req.body });
  res.json(await withLogoUrl(company));
};

export const deleteCompany: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, existing.id);

  await prisma.company.delete({ where: { id: existing.id } });
  res.status(204).send();
};

export const uploadLogoHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, existing.id);
  if (!req.file) throw badRequest("ملف الشعار مطلوب");
  if (!ALLOWED_LOGO_MIME_TYPES.includes(req.file.mimetype)) {
    throw badRequest("صيغة الملف غير مدعومة — استخدم PNG أو JPEG أو WEBP أو SVG");
  }

  const key = buildObjectKey(req.auth!.tenantId, "company_logo", existing.id, req.file.originalname);
  await uploadObject(key, req.file.buffer, req.file.mimetype);

  const company = await prisma.company.update({ where: { id: existing.id }, data: { logoKey: key } });
  res.json(await withLogoUrl(company));
};

export const extractDocumentHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, existing.id);
  if (!req.file) throw badRequest("الملف مطلوب");

  const docType = req.body.docType as CompanyDocType;

  // نحفظ المستند المرفوع كمرفق مرتبط بالشركة دائماً بصرف النظر عن نجاح الاستخراج، حتى يبقى
  // بالإمكان الرجوع له لاحقاً أو إعادة محاولة الاستخراج على مستند أوضح
  const attachment = await createAttachment(req.auth!.tenantId, req.auth!.sub, {
    entityType: "company",
    entityId: existing.id,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
  });

  try {
    const extraction = await extractCompanyDataFromDocument(req.file.buffer, req.file.mimetype, docType);
    res.json({ ...extraction, attachment });
  } catch (err) {
    // لا نُفشل الطلب بالكامل — المستند محفوظ بالفعل، ونعيد fields فارغة مع رسالة واضحة
    // بدل حفظ بيانات خاطئة بصمت، حتى يُدخل المستخدم البيانات يدوياً بدل ذلك
    res.json({
      fields: {},
      confidence: "low",
      confidenceNote: translateMessage(err instanceof Error ? err.message : "تعذّر استخراج البيانات من هذا المستند", req.lang),
      attachment,
    });
  }
};
