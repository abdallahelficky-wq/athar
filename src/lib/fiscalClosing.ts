import type { Prisma, PrismaClient } from "@prisma/client";
import { badRequest } from "./httpError";

type Tx = Prisma.TransactionClient | PrismaClient;

/** صيغة تاريخ مختصرة (YYYY-MM-DD) لرسائل الخطأ — نفس الأسلوب المُستخدَم أصلاً في bulkImport.service.ts */
export function fmtDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * التحقق المركزي الوحيد من "هل هذا التاريخ يقع في فترة مُقفلة؟" — تُستدعى من كل نقطة تكتب أو تحذف
 * أو تفك ترحيل قيداً محاسبياً (راجع journalPosting.ts للنقطة المُجمِّعة لمعظم الوحدات، وجميع نقاط
 * الاستدعاء المستقلة في journalEntries.service.ts وbulkImport.service.ts وaccounts.controller.ts).
 *
 * المقارنة `<=` (شاملة) عمداً: تاريخ قيد يساوي تاريخ الإقفال بالضبط يُرفَض أيضاً، لا فقط ما قبله.
 *
 * `action` نص عربي وصفي لما تحاول العملية فعله (مثال: "إنشاء قيد بهذا التاريخ")، يُدرَج في رسالة
 * الخطأ لتوضّح للمستخدم أي عملية رُفضت تحديداً — خصوصاً مفيد للتواريخ المُشتقة (رواتب، تحويل عرض
 * سعر) حيث قد لا يكون واضحاً للمستخدم فوراً أي تاريخ فعلي تسبَّب بالرفض.
 */
export function assertPeriodNotClosed(closingDate: Date | null | undefined, date: Date, action: string): void {
  if (!closingDate) return;
  if (date.getTime() <= closingDate.getTime()) {
    throw badRequest(
      `لا يمكن ${action} بتاريخ ${fmtDateOnly(date)} لأن هذا التاريخ يقع في فترة مُقفلة (تاريخ إقفال السنة المالية لهذه الشركة: ${fmtDateOnly(closingDate)}). لتعديل هذه الفترة استثناءً، يجب على مدير النظام فتح الإقفال أولاً من إعدادات الشركة.`,
    );
  }
}

/**
 * تقرأ تاريخ إقفال شركة معيّنة، وتقفل صفّها (`FOR UPDATE`) طوال بقية المعاملة الحالية — تُستخدَم
 * دائماً مباشرةً قبل الكتابة الفعلية (لا كخطوة منفصلة سابقة لأي معاملة) حتى لا تتسلل معاملة إقفال
 * متزامنة أخرى بين لحظة التحقق ولحظة الكتابة (نفس مبدأ deleteJournalEntryTx في journalPosting.ts).
 */
export async function lockCompanyClosingDate(tx: Tx, companyId: string): Promise<Date | null> {
  const rows = await tx.$queryRaw<{ fiscalYearClosingDate: Date | null }[]>`
    SELECT "fiscalYearClosingDate" FROM "companies" WHERE "id" = ${companyId} FOR UPDATE
  `;
  return rows[0]?.fiscalYearClosingDate ?? null;
}
