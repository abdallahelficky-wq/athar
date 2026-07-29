import { AccountType, Prisma } from "@prisma/client";

export const DEFAULT_CHART_OF_ACCOUNTS: { name: string; type: AccountType; isBankOrCash?: boolean }[] = [
  { name: "النقدية بالصندوق", type: "asset", isBankOrCash: true }, { name: "البنك الأهلي - حساب تشغيلي", type: "asset", isBankOrCash: true },
  { name: "ذمم مدينة", type: "asset" }, { name: "ضريبة القيمة المضافة - مدخلات", type: "asset" }, { name: "المخزون", type: "asset" },
  { name: "سلف الموظفين", type: "asset" }, { name: "الأصول الثابتة", type: "asset" }, { name: "حساب جاري - شركات المجموعة", type: "asset" },
  { name: "ذمم دائنة - موردين", type: "liability" }, { name: "ضريبة القيمة المضافة - مخرجات", type: "liability" },
  { name: "مجمع الإهلاك", type: "liability" }, { name: "ذمم الموظفين - مستحقات وإجازات", type: "liability" },
  { name: "التأمينات الاجتماعية - مستحقة", type: "liability" }, { name: "رواتب مستحقة للصرف", type: "liability" },
  { name: "رأس المال", type: "equity" }, { name: "تسويات المخزون", type: "equity" },
  { name: "المبيعات - وقود", type: "revenue" }, { name: "المبيعات - زيوت وخدمات", type: "revenue" },
  { name: "مبيعات - خدمات ومنتجات أخرى", type: "revenue" }, { name: "أرباح استبعاد أصول", type: "revenue" },
  { name: "مصروف إيجار", type: "expense" }, { name: "مصروف رواتب", type: "expense" }, { name: "مصروفات عامة", type: "expense" },
  { name: "تكلفة البضاعة المباعة / الصرف المخزني", type: "expense" }, { name: "مصروف تالف ونقص المخزون", type: "expense" },
  { name: "مصروف إهلاك الأصول الثابتة", type: "expense" }, { name: "خسائر استبعاد أصول", type: "expense" },
];

const TYPES = [
  ["asset", "1", "الأصول"], ["liability", "2", "الالتزامات"], ["equity", "3", "حقوق الملكية"],
  ["revenue", "4", "الإيرادات"], ["expense", "5", "المصروفات"],
] as const;

/** ينشئ الهيكل التجميعي الأساسي ذي المستويات الثلاثة؛ يضيف المستخدم حسابات الحركة في المستوى الرابع. */
export async function createDefaultChart(tx: Prisma.TransactionClient, tenantId: string, companyId: string | null) {
  for (const [type, rootCode, rootName] of TYPES) {
    const root = await tx.account.create({ data: { tenantId, companyId, code: rootCode, level: 1, name: rootName, type } });
    const branch = await tx.account.create({ data: { tenantId, companyId, parentId: root.id, code: `${rootCode}1`, level: 2, name: `مجموعات ${rootName}`, type } });
    const detail = await tx.account.create({ data: { tenantId, companyId, parentId: branch.id, code: `${rootCode}101`, level: 3, name: "الحسابات التفصيلية", type } });
    const defaults = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.type === type);
    for (let index = 0; index < defaults.length; index += 1) {
      const account = defaults[index];
      await tx.account.create({ data: { tenantId, companyId, parentId: detail.id, code: `${rootCode}101${String(index + 1).padStart(4, "0")}`, level: 4, isPosting: true, name: account.name, type, isBankOrCash: account.isBankOrCash || false } });
    }
  }
}
