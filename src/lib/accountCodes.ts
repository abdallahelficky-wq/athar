import { Prisma } from "@prisma/client";
import { badRequest } from "./httpError";

// طول كود كل مستوى: الأول رقم واحد، الثاني رقمان، الثالث ثلاثة أرقام، الرابع (حسابات الترحيل)
// ستة أرقام — منقول حرفياً من accounts.controller.ts.
export const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };

/**
 * يولّد الكود التالي المتاح تحت حساب أب معيّن (يعمل لأي مستوى، طالما الأب ليس حساب ترحيل) —
 * يمسح إخوة الحساب الجديد تحت نفس الأب ويأخذ أول لاحقة رقمية حرة. مُستخرَجة من
 * accounts.controller.ts لإعادة استخدامها في الإنشاء التلقائي لحسابات العملاء/الموردين/الموظفين
 * (partyAccounts.ts) دون تكرار المنطق.
 */
export async function generateNextCode(
  client: Prisma.TransactionClient,
  tenantId: string,
  companyId: string | null,
  parentId: string,
): Promise<string> {
  const parent = await client.account.findFirst({ where: { id: parentId, tenantId, companyId } });
  if (!parent) throw badRequest("الحساب الأب غير موجود في الشجرة المحددة");
  if (parent.isPosting || parent.level >= 4) throw badRequest("حساب الترحيل لا يقبل حسابات فرعية");
  const childLevel = parent.level + 1;
  const targetLength = LEVEL_CODE_LENGTH[childLevel];
  const suffixWidth = targetLength - parent.code.length;
  const siblings = await client.account.findMany({ where: { tenantId, companyId, parentId }, select: { code: true } });
  const usedSuffixes = siblings.map((account) => Number(account.code.slice(parent.code.length)) || 0);
  const next = Math.max(0, ...usedSuffixes) + 1;
  const maxSuffix = Number("9".repeat(suffixWidth));
  if (next > maxSuffix) throw badRequest("تعذر توليد كود جديد ضمن الحد المسموح لهذا المستوى");
  return parent.code + String(next).padStart(suffixWidth, "0");
}
