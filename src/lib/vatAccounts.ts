import { prisma } from "./prisma";
import { getAccountIdByName } from "./wellKnownAccounts";
import { HttpError } from "./httpError";
import type { VatPeriod } from "./vatPeriod";

// نفس الاسمين اللذين يمرّرهما كل مسار ترحيل (فواتير، مردودات، إشعارات مدينة، مشتريات، ورديات
// المحطات) إلى getAccountIdByName — فالتقرير يقرأ نفس الحساب الذي يُرحَّل إليه فعلاً، لا حساباً
// يُختار بالكود أو بالاسم مستقلاً عن الترحيل.
export const OUTPUT_VAT_ACCOUNT_NAME = "ضريبة القيمة المضافة - مخرجات";
export const INPUT_VAT_ACCOUNT_NAME = "ضريبة القيمة المضافة - مدخلات";

export interface ResolvedVatAccount {
  id: string;
  code: string;
  name: string;
}

/** الحساب الذي سيُرحَّل إليه الآن، أو null إن لم يوجد (الترحيل نفسه يرفض بـ400 في هذه الحالة). */
export async function resolveVatAccount(tenantId: string, companyId: string, name: string): Promise<ResolvedVatAccount | null> {
  try {
    const id = await getAccountIdByName(tenantId, companyId, name);
    return prisma.account.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, name: true } });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return null;
    throw err;
  }
}

/**
 * ضريبة المخرجات المرحَّلة من ورديات المحطات في الفترة: حركة حساب المخرجات في قيود مصدرها
 * station_shift مؤرَّخة داخل الفترة (تاريخ قيد الوردية = تاريخ الوردية).
 */
export async function stationShiftOutputVat(tenantId: string, period: VatPeriod, outputAccountId: string | null) {
  if (!outputAccountId) return { vat: 0, shiftCount: 0 };
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      accountId: outputAccountId,
      journalEntry: {
        tenantId, companyId: period.companyId, status: "posted", sourceModule: "station_shift",
        date: { gte: period.start, lt: period.endExclusive },
      },
    },
    select: { journalEntryId: true, debit: true, credit: true },
  });
  const vat = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  return { vat, shiftCount: new Set(lines.map((l) => l.journalEntryId)).size };
}
