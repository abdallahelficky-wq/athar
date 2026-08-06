import { Prisma, Account } from "@prisma/client";
import { badRequest } from "./httpError";
import { generateNextCode } from "./accountCodes";
import { getAccountIdByName } from "./wellKnownAccounts";

export type PartyKind = "customer" | "supplier" | "employee";

// أكواد مجموعات الذمم الموجودة فعلياً في القالب الافتراضي وكل قوالب الأنشطة الخمسة (مؤكَّد من
// الفحص المسبق للكود الفعلي) — "112" الذمم المدينة التجارية (للعملاء)، "211" الذمم الدائنة
// التجارية (للموردين). لا حاجة لمجموعة جديدة لهما، بعكس الموظفين (انظر ensureEmployeeReceivablesGroup).
const PARTY_PARENT_CODE: Record<"customer" | "supplier", string> = {
  customer: "112",
  supplier: "211",
};

/**
 * تجد (أو تُنشئ) مجموعة حسابات غير-ترحيلية بالاسم المحدد تحت أب معروف بكوده — نفس مبدأ
 * ensureIntercompanyAccount (journalEntries.service.ts) لكن معمّم لأي مجموعة جديدة. تُستخدَم هنا
 * لإنشاء "ذمم الموظفين" (أصول متداولة) مرة واحدة فقط لكل شركة، أول مرة تحتاجها الشركة، دون أي
 * حاجة لتعديل ملفات القوالب الستة يدوياً.
 */
async function ensureAccountGroup(
  client: Prisma.TransactionClient,
  params: { tenantId: string; companyId: string; name: string; type: Account["type"]; parentCode: string },
): Promise<Account> {
  const { tenantId, companyId, name, type, parentCode } = params;
  const existing = await client.account.findFirst({ where: { tenantId, companyId, name, isPosting: false } });
  if (existing) return existing;

  const parent = await client.account.findFirst({ where: { tenantId, companyId, code: parentCode, isPosting: false } });
  if (!parent) throw badRequest(`حساب التجميع بالكود "${parentCode}" غير موجود في شجرة هذه الشركة`);

  const code = await generateNextCode(client, tenantId, companyId, parent.id);
  return client.account.create({
    data: { tenantId, companyId, parentId: parent.id, code, name, type, level: parent.level + 1, isPosting: false },
  });
}

/**
 * تُنشئ حساباً تفصيلياً مستقلاً (مستوى رابع، قابل للترحيل) لطرف جديد (عميل/مورد/موظف) تحت مجموعة
 * الذمم المناسبة، وتُرجع مُعرِّفه ليُحفَظ في Customer.accountId/Supplier.accountId/Employee.accountId
 * — تُستدعى من داخل نفس معاملة إنشاء الطرف (customers/suppliers/employees controllers) حتى يُنشأ
 * الطرف وحسابه معاً بلا حالة وسيطة ناقصة.
 */
export async function ensurePartyAccount(
  client: Prisma.TransactionClient,
  params: { tenantId: string; companyId: string; kind: PartyKind; partyName: string },
): Promise<{ accountId: string }> {
  const { tenantId, companyId, kind, partyName } = params;

  const parent =
    kind === "employee"
      ? await ensureAccountGroup(client, { tenantId, companyId, name: "ذمم الموظفين", type: "asset", parentCode: "11" })
      : await client.account.findFirst({ where: { tenantId, companyId, code: PARTY_PARENT_CODE[kind], isPosting: false } });
  if (!parent) throw badRequest(`حساب التجميع المطلوب (${PARTY_PARENT_CODE[kind as "customer" | "supplier"]}) غير موجود في شجرة هذه الشركة`);

  const code = await generateNextCode(client, tenantId, companyId, parent.id);
  const account = await client.account.create({
    data: { tenantId, companyId, parentId: parent.id, code, name: partyName, type: parent.type, level: parent.level + 1, isPosting: true },
  });
  return { accountId: account.id };
}

/**
 * تُرجع الحساب المستقل للطرف إن وُجد، وإلا تعود للحساب المشترك القديم بالاسم — شبكة أمان انتقالية
 * ريثما تكتمل التعبئة الرجعية (backfillPartyAccounts.ts) لكل الأطراف القديمة؛ تضمن أن ترحيل أي
 * فاتورة/راتب لا ينكسر أبداً بسبب طرف لم يُعبَّأ حسابه المستقل بعد، مهما كان توقيت تشغيل الـ backfill
 * بالنسبة لنشر هذا الكود.
 */
export async function resolvePartyAccountId(
  tenantId: string,
  companyId: string,
  party: { accountId: string | null },
  sharedAccountName: string,
): Promise<string> {
  if (party.accountId) return party.accountId;
  return getAccountIdByName(tenantId, companyId, sharedAccountName);
}
