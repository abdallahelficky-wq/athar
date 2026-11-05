/**
 * حساب ذمة الموظف الفرعي (قرار المالك 2026-11-01): حساب ترحيل واحد لكل موظف لسلفه ومخالفاته معاً، تحت مجموعة الأصول غير
 * الترحيلية المختارة في إعدادات الرواتب (PayrollSettings.advancesParentAccountId). يُنشأ أول حاجة باسم الموظف ويُحفَظ على
 * Employee.receivableAccountId ويُعاد استخدامه بعدها — نفس مبدأ ensurePartyAccount.
 */
import { Prisma } from "@prisma/client";
import { badRequest } from "./httpError";
import { generateNextCode } from "./accountCodes";

type Client = Prisma.TransactionClient;

/** المجموعة الأب صالحة: من الشركة نفسها، أصول، غير ترحيلية، نشطة، ومستواها يقبل حسابات ترحيل تحته */
export async function assertValidAdvancesParent(client: Client, tenantId: string, companyId: string, accountId: string) {
  const parent = await client.account.findFirst({ where: { id: accountId, tenantId, companyId } });
  if (!parent) throw badRequest("مجموعة حسابات ذمم الموظفين ليست من شجرة هذه الشركة");
  if (parent.type !== "asset") throw badRequest("مجموعة حسابات ذمم الموظفين يجب أن تكون من الأصول");
  if (parent.isPosting) throw badRequest("مجموعة حسابات ذمم الموظفين يجب أن تكون حساب تجميع لا حساب ترحيل");
  if (!parent.isActive || parent.isArchived) throw badRequest("مجموعة حسابات ذمم الموظفين موقوفة أو مؤرشفة");
  if (parent.level >= 4) throw badRequest("مجموعة حسابات ذمم الموظفين في مستوى لا يقبل حسابات فرعية");
  return parent;
}

export async function getAdvancesParentId(client: Client, tenantId: string, companyId: string): Promise<string | null> {
  const settings = await client.payrollSettings.findFirst({ where: { tenantId, companyId }, select: { advancesParentAccountId: true } });
  return settings?.advancesParentAccountId ?? null;
}

/**
 * يُرجع حساب ذمة الموظف الفرعي، وينشئه تحت المجموعة المختارة إن لم يوجد. يرفض برسالة واضحة إن لم تُختَر مجموعة —
 * لا ارتداد لحساب مشترك. الحجز بـ updateMany على receivableAccountId = null يمنع إنشاء حسابين لموظف واحد عند التزامن.
 */
export async function ensureEmployeeReceivableAccount(client: Client, tenantId: string, employeeId: string): Promise<string> {
  const employee = await client.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true, name: true, companyId: true, receivableAccountId: true, accountId: true } });
  if (!employee) throw badRequest("الموظف غير موجود");
  if (employee.receivableAccountId) return employee.receivableAccountId;

  const parentId = await getAdvancesParentId(client, tenantId, employee.companyId);
  if (!parentId) throw badRequest("اختر مجموعة حسابات ذمم الموظفين (السلف والمخالفات) في إعدادات الرواتب أولاً");
  const parent = await assertValidAdvancesParent(client, tenantId, employee.companyId, parentId);

  // للموظف حساب شخصي قائم تحت المجموعة المختارة نفسها (Employee.accountId — يُنشئه ملف الموظف تحت «ذمم الموظفين»):
  // يُعتمَد هو حساب ذمته بدل إنشاء حساب ثانٍ باسمه في المجموعة ذاتها (حادثة أرمي 2026-11-05: 118001–118014 قائمة
  // وصفرية، وكان الإنشاء سيكرّرها). يُشترط أن يكون أصولاً، ترحيلياً، نشطاً، ومن الشركة نفسها.
  if (employee.accountId) {
    const own = await client.account.findFirst({ where: { id: employee.accountId, tenantId, companyId: employee.companyId } });
    if (own && own.parentId === parent.id && own.type === "asset" && own.isPosting && own.isActive && !own.isArchived) {
      const adopted = await client.employee.updateMany({ where: { id: employee.id, receivableAccountId: null }, data: { receivableAccountId: own.id } });
      if (!own.isEmployeeAdvanceAccount) await client.account.update({ where: { id: own.id }, data: { isEmployeeAdvanceAccount: true } });
      if (adopted.count === 1) return own.id;
      const winner = await client.employee.findUniqueOrThrow({ where: { id: employee.id }, select: { receivableAccountId: true } });
      return winner.receivableAccountId!;
    }
  }

  const code = await generateNextCode(client, tenantId, employee.companyId, parent.id);
  const account = await client.account.create({
    // مُعلَّم حساب سلف: سطر قيد يدوي عليه يفتح نافذة ربط السلفة كما في حساب السلف المشترك
    data: { tenantId, companyId: employee.companyId, parentId: parent.id, code, name: employee.name, type: "asset", level: parent.level + 1, isPosting: true, isEmployeeAdvanceAccount: true },
  });
  const claimed = await client.employee.updateMany({ where: { id: employee.id, receivableAccountId: null }, data: { receivableAccountId: account.id } });
  if (claimed.count === 1) return account.id;
  // سبقتنا معاملة أخرى: يُحذَف الحساب الذي لم يُستخدَم ويُعاد حساب الموظف القائم
  await client.account.delete({ where: { id: account.id } });
  const winner = await client.employee.findUniqueOrThrow({ where: { id: employee.id }, select: { receivableAccountId: true } });
  return winner.receivableAccountId!;
}
