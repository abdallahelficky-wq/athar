import { prisma } from "./prisma";
import { badRequest } from "./httpError";

/**
 * أسماء الحسابات "المعروفة" التي يعتمد عليها منطق الترحيل التلقائي في موديولات
 * المبيعات/المشتريات/المخزون/الأصول/الرواتب — مطابقة حرفياً للأسماء المستخدَمة في
 * AtharAlMuhasabi.jsx وموثّقة في DEFAULT_CHART_OF_ACCOUNTS. لو حذف المستخدم أحد هذه
 * الحسابات من شجرة حساباته لن يستطيع ترحيل المعاملة المرتبطة به (خطأ 400 واضح)
 * بدل فشل صامت.
 */
export async function getAccountIdByName(tenantId: string, name: string): Promise<string> {
  const account = await prisma.account.findFirst({ where: { tenantId, name } });
  if (!account) {
    throw badRequest(`الحساب المطلوب لترحيل هذه المعاملة غير موجود في شجرة حساباتك: "${name}"`);
  }
  return account.id;
}
