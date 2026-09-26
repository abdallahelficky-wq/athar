import { Prisma } from "@prisma/client";
import { badRequest } from "./httpError";

// طول كود كل مستوى: الأول رقم واحد، الثاني رقمان، الثالث ثلاثة أرقام، الرابع (حسابات الترحيل)
// ستة أرقام — منقول حرفياً من accounts.controller.ts.
export const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };

/**
 * يولّد الكود التالي المتاح تحت حساب أب معيّن (يعمل لأي مستوى، طالما الأب ليس حساب ترحيل) —
 * يمسح كل حساب في الشركة كوده يبدأ ببادئة كود الأب وبنفس طول المستوى المستهدف (لا إخوته المباشرين
 * فقط)، ويأخذ أول لاحقة رقمية حرة عالمياً. مُستخرَجة من accounts.controller.ts لإعادة استخدامها في
 * الإنشاء التلقائي لحسابات العملاء/الموردين/الموظفين (partyAccounts.ts) دون تكرار المنطق.
 *
 * لماذا عالمياً لا بين الإخوة المباشرين فقط: updateAccount يسمح بنقل حساب لأب آخر مع إبقاء كوده
 * القديم كما هو (لا يُشترَط أن يبدأ بكود الأب الجديد بعد النقل — راجع تعليق validateHierarchy).
 * فإن حسب هذه الدالة اللاحقة التالية من الإخوة المباشرين لأبٍ صار "فارغاً" بعد نقل كل أبنائه
 * لمكان آخر، ستُعيد توليد كود سبق استخدامه فعلياً (تحت الأب الجديد) فيفشل الإنشاء بخطأ تكرار —
 * بالضبط ما يحدث لحساب "112" بعد فصل حساباته القياسية إلى "117" (party_subledger_grouping):
 * أول عميل جديد كان سيُمنَح الكود "112001" رغم أنه مُستخدَم بالفعل (تحت 117 الآن).
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
  const codeSpaceUsers = await client.account.findMany({
    where: { tenantId, companyId, code: { startsWith: parent.code } },
    select: { code: true },
  });
  const usedSuffixes = codeSpaceUsers
    .filter((account) => account.code.length === targetLength)
    .map((account) => Number(account.code.slice(parent.code.length)) || 0);
  const next = Math.max(0, ...usedSuffixes) + 1;
  const maxSuffix = Number("9".repeat(suffixWidth));
  if (next > maxSuffix) throw badRequest("تعذر توليد كود جديد ضمن الحد المسموح لهذا المستوى");
  return parent.code + String(next).padStart(suffixWidth, "0");
}
