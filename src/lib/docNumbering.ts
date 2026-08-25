import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

export type DocNumberingType = "sales_invoice" | "quotation" | "sales_return";

const DEFAULT_PREFIX: Record<DocNumberingType, string> = {
  sales_invoice: "INV",
  quotation: "QUO",
  sales_return: "RET",
};

/** يستبدل الرمز الخاص {year} في البادئة بالسنة الميلادية الحالية — يسمح ببادئة مثل "INV/{year}/"
 * تعكس السنة تلقائياً في كل رقم مولَّد بلا أي تعديل يدوي سنوي، خصوصاً مع إعادة الترقيم السنوي. */
function resolvePrefix(prefix: string, year: number): string {
  return prefix.replace("{year}", String(year));
}

/**
 * تحجز رقم المستند التالي (فاتورة مبيعات/عرض سعر/مردود مبيعات) لشركة معيّنة، بصيغة قابلة
 * للتخصيص بالكامل من إعدادات المبيعات (بادئة نصية تدعم {year}، عدد أرقام العدّاد، وإعادة ترقيم
 * سنوية أو تسلسل مستمر) — عبر زيادة ذرّية (UPDATE ... RETURNING) ضمن نفس معاملة إنشاء المستند
 * (tx)، بنفس أسلوب reserveEntryNumber في journalPosting.ts بالضبط: لا يُحجز الرقم فعلياً إلا
 * لحظة الكتابة الفعلية، فلا تظهر فجوات لو فشلت المعاملة أو أُلغيت العملية قبل هذه النقطة.
 *
 * إعادة الترقيم السنوي مدمجة في نفس عبارة UPDATE الذرّية الواحدة (بلا استعلام/تحديث منفصل قد
 * يتسابق مع طلب آخر متزامن): لو resetMode = annual والسنة الحالية تختلف عن currentYear
 * المخزَّنة، يُصفَّر nextSeq إلى 2 (أي الرقم المحجوز = 1) بدل زيادته على القيمة القديمة، ثم
 * currentYear تُحدَّث دائماً لتعكس آخر استخدام فعلي.
 *
 * أول استدعاء لشركة لم تُخصِّص إعداداتها بعد يُنشئ صفاً افتراضياً تلقائياً (بادئة/صيغة مطابقة
 * تماماً لسلوك formatDocNumber القديم: "INV-00001" بفاصلة، 5 أرقام، تسلسل مستمر) — بلا أي كسر
 * لأي شركة قديمة لم تلمس هذه الميزة الجديدة إطلاقاً.
 */
export async function reserveDocumentNumber(tx: Tx, tenantId: string, companyId: string, docType: DocNumberingType): Promise<string> {
  await tx.documentNumberingSettings.upsert({
    where: { companyId_docType: { companyId, docType } },
    update: {},
    create: { tenantId, companyId, docType, prefix: `${DEFAULT_PREFIX[docType]}-`, digits: 5, resetMode: "continuous" },
  });

  const currentYear = new Date().getFullYear();
  const rows = await tx.$queryRaw<{ seq: number; prefix: string; digits: number }[]>`
    UPDATE "document_numbering_settings"
    SET
      "nextSeq" = CASE
        WHEN "resetMode" = 'annual' AND ("currentYear" IS DISTINCT FROM ${currentYear}) THEN 2
        ELSE "nextSeq" + 1
      END,
      "currentYear" = ${currentYear}
    WHERE "companyId" = ${companyId} AND "docType" = ${docType}
    RETURNING "nextSeq" - 1 AS seq, "prefix", "digits"
  `;
  const row = rows[0];
  return `${resolvePrefix(row.prefix, currentYear)}${String(row.seq).padStart(row.digits, "0")}`;
}

/** معاينة الرقم التالي المتوقع بلا أي حجز أو تعديل على العدّاد — لعرضه في شاشة إعدادات الترقيم فقط */
export async function previewNextDocumentNumber(tenantId: string, companyId: string, docType: DocNumberingType) {
  const settings = await prisma.documentNumberingSettings.findUnique({ where: { companyId_docType: { companyId, docType } } });
  const currentYear = new Date().getFullYear();
  if (!settings) {
    const prefix = `${DEFAULT_PREFIX[docType]}-`;
    return `${prefix}${"1".padStart(5, "0")}`;
  }
  const seq = settings.resetMode === "annual" && settings.currentYear !== currentYear ? 1 : settings.nextSeq;
  return `${resolvePrefix(settings.prefix, currentYear)}${String(seq).padStart(settings.digits, "0")}`;
}
