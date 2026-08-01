import { prisma } from "./prisma";
import { badRequest } from "./httpError";

const STANDARD_ACCOUNT_ALIASES: Record<string, string> = {
  "البنك الأهلي - حساب تشغيلي": "الحسابات البنكية الجارية",
  "ذمم مدينة": "العملاء",
  "ضريبة القيمة المضافة - مدخلات": "ضريبة القيمة المضافة على المدخلات",
  "ذمم دائنة - موردين": "الموردون",
  "ضريبة القيمة المضافة - مخرجات": "ضريبة القيمة المضافة على المخرجات",
  "الأصول الثابتة": "أصول ثابتة أخرى",
  "مجمع الإهلاك": "مجمع إهلاك أصول ثابتة أخرى",
  "مصروف إهلاك الأصول الثابتة": "إهلاك أصول ثابتة أخرى",
  "أرباح استبعاد أصول": "أرباح بيع أصول",
  "خسائر استبعاد أصول": "خسائر بيع أصول",
  "المخزون": "مخزون بضائع",
  "تسويات المخزون": "فروقات وهبوط مخزون",
  "مصروف تالف ونقص المخزون": "فروقات وهبوط مخزون",
  "تكلفة البضاعة المباعة / الصرف المخزني": "تكلفة البضاعة المباعة",
  "حساب جاري - شركات المجموعة": "أطراف ذات علاقة مدينة",
  "ذمم الموظفين - مستحقات وإجازات": "مستحقات الموظفين",
  "رواتب مستحقة للصرف": "رواتب وأجور مستحقة",
  "مصروف رواتب": "رواتب وأجور إدارية",
  "مصروف رواتب أساسية": "رواتب وأجور إدارية",
  "مصروف بدل سكن": "بدلات ومزايا موظفين",
  "مصروف بدل مواصلات": "بدلات ومزايا موظفين",
  "مصروف بدلات أخرى": "بدلات ومزايا موظفين",
  "مصروف إضافات وحوافز أخرى": "بدلات ومزايا موظفين",
  "مصروف بدل إضافي (عمل إضافي)": "بدلات ومزايا موظفين",
  "التأمينات الاجتماعية - مستحقة": "تأمينات اجتماعية مستحقة",
  "صندوق العاملين - مخالفات وعقوبات": "مستحقات الموظفين",
  "استقطاعات أخرى مستحقة": "مستحقات الموظفين",
  "مصروف تذاكر وتأشيرات الموظفين": "سفر وانتقالات",
};

/** يربط أسماء الترحيل القديمة بالحسابات القياسية الجديدة دون إبقاء حسابات قطاعية في القالب. */
async function findPostingAccount(tenantId: string, companyId: string | null, candidateNames: string[]) {
  return prisma.account.findFirst({
    where: { tenantId, companyId, name: { in: candidateNames }, isPosting: true, isArchived: false },
  });
}

/**
 * يبحث أولاً في شجرة حسابات الشركة نفسها (companyId إلزامي)، ثم يسقط احتياطياً على شجرة
 * المجموعة المشتركة (companyId = null) — وهي الشجرة التي هاجرت إليها الحسابات القديمة قبل
 * ترقية شجرة الحسابات الاحترافية. هذا يمنع التقاط حساب بنفس الاسم من شركة أخرى بالخطأ.
 */
export async function getAccountIdByName(tenantId: string, companyId: string, name: string): Promise<string> {
  const standardName = STANDARD_ACCOUNT_ALIASES[name] || name;
  const candidates = standardName === name ? [name] : [standardName, name];

  const companyAccount = await findPostingAccount(tenantId, companyId, candidates);
  if (companyAccount) return companyAccount.id;

  const groupAccount = await findPostingAccount(tenantId, null, candidates);
  if (groupAccount) return groupAccount.id;

  throw badRequest(`الحساب المطلوب لترحيل هذه المعاملة غير موجود في شجرة حسابات هذه الشركة: "${standardName}"`);
}

/**
 * لحسابات التسوية المشتركة بين شركات المجموعة فقط (مثل "حساب جاري - شركات المجموعة") التي
 * يجب أن تبقى نفس الحساب الواحد في قيدي الطرفين (المرسل والمستقبل) — بخلاف كل الحالات الأخرى،
 * لا تُستخدم شجرة أي شركة بعينها هنا حتى لو كان لديها حساب بنفس الاسم في قالبها القياسي الخاص.
 */
export async function getGroupAccountIdByName(tenantId: string, name: string): Promise<string> {
  const standardName = STANDARD_ACCOUNT_ALIASES[name] || name;
  const candidates = standardName === name ? [name] : [standardName, name];

  const groupAccount = await findPostingAccount(tenantId, null, candidates);
  if (groupAccount) return groupAccount.id;

  throw badRequest(`حساب المجموعة المطلوب لترحيل هذه المعاملة غير موجود في شجرة حسابات المجموعة: "${standardName}"`);
}
