import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { previewNextDocumentNumber, DocNumberingType } from "../../lib/docNumbering";

const DEFAULT_PREFIX: Record<DocNumberingType, string> = {
  sales_invoice: "INV-",
  quotation: "QUO-",
  sales_return: "RET-",
};

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

/** إعدادات افتراضية "افتراضية فقط" (بلا إنشاء أي صف فعلي) لو الشركة لم تخصّص الترقيم بعد —
 * نفس نمط getPayrollSettings تماماً (id: null يعني "لم يُحفَظ شيء بعد"). */
export async function getDocumentNumberingSettings(tenantId: string, companyId: string, docType: DocNumberingType) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  const existing = await prisma.documentNumberingSettings.findUnique({ where: { companyId_docType: { companyId, docType } } });
  const nextPreview = await previewNextDocumentNumber(tenantId, companyId, docType);
  if (existing) return { ...existing, nextPreview };
  return {
    id: null, tenantId, companyId, docType,
    prefix: DEFAULT_PREFIX[docType], digits: 5, resetMode: "continuous" as const, nextSeq: 1, currentYear: null,
    nextPreview,
  };
}

export async function updateDocumentNumberingSettings(
  tenantId: string, companyId: string, docType: DocNumberingType,
  input: { prefix: string; digits: number; resetMode: "continuous" | "annual" },
) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  const settings = await prisma.documentNumberingSettings.upsert({
    where: { companyId_docType: { companyId, docType } },
    create: { tenantId, companyId, docType, prefix: input.prefix, digits: input.digits, resetMode: input.resetMode },
    update: { prefix: input.prefix, digits: input.digits, resetMode: input.resetMode },
  });
  const nextPreview = await previewNextDocumentNumber(tenantId, companyId, docType);
  return { ...settings, nextPreview };
}
