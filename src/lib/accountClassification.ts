import type { AccountAnalysisRole, AccountLiquidity, AccountType } from "@prisma/client";
import { badRequest } from "./httpError";

/**
 * تصنيف الحسابات للتحليل المالي (متداول/غير متداول + دور الحساب في النسب).
 *
 * القيمة الفعلية لحساب = قيمته المحفوظة، وإلا قيمة أقرب أب مصنَّف. لذلك يكفي تصنيف المجموعات، وكل حساب
 * يُضاف تحتها لاحقاً يرث تصنيفها دون أي إعداد. لا يوجد تخمين بالأكواد: الشجرات المُرحَّلة من أنظمة أخرى
 * لا تتبع أكواد القالب، وحساب بلا دليل يبقى "غير مصنَّف" ويظهر في تقرير النسب كتحذير صريح.
 *
 * inferClassificationFromName هي نفس قواعد الاسم في ترحيل 20261106090000_account_analysis_classification —
 * تُطبَّق عند تثبيت قالب أو استيراد شجرة، فتبقى الشركات الجديدة والقديمة على نفس التعريف.
 */

export const LIQUIDITY_VALUES = ["current", "non_current"] as const satisfies readonly AccountLiquidity[];
export const ANALYSIS_ROLE_VALUES = [
  "receivables",
  "payables",
  "inventory",
  "cost_of_sales",
  "depreciation",
  "finance_cost",
  "borrowings",
] as const satisfies readonly AccountAnalysisRole[];

/** الأنواع المسموح بها لكل دور — يُرفَض في الخادم أي دور على نوع لا يناسبه (مثل "مخزون" على حساب مصروف). */
export const ROLE_ACCOUNT_TYPES: Record<AccountAnalysisRole, AccountType[]> = {
  receivables: ["asset"],
  payables: ["liability"],
  inventory: ["asset"],
  cost_of_sales: ["expense"],
  depreciation: ["expense"],
  finance_cost: ["expense", "revenue"],
  borrowings: ["liability"],
};

export const LIQUIDITY_ACCOUNT_TYPES: AccountType[] = ["asset", "liability"];

export function isRoleAllowedForType(role: AccountAnalysisRole, type: AccountType) {
  return ROLE_ACCOUNT_TYPES[role].includes(type);
}

const INVENTORY_GROUP_NAMES = new Set(["المخزون", "مخزون", "البضاعة", "المخزون السلعي"]);
const RECEIVABLE_GROUP_NAMES = new Set([
  "عملاء",
  "العملاء",
  "الذمم المدينة",
  "الذمم المدينة التجارية",
  "الذمم المدينة القياسية",
  "ذمم مدينة تجارية",
]);
const PAYABLE_GROUP_NAMES = new Set([
  "موردون",
  "الموردون",
  "موردين",
  "الموردين",
  "الذمم الدائنة",
  "الذمم الدائنة التجارية",
  "الذمم الدائنة القياسية",
]);
const COST_OF_SALES_GROUP_NAMES = new Set([
  "تكلفة الإيرادات",
  "تكلفة الايرادات",
  "تكلفة المبيعات",
  "تكلفة البضاعة المباعة",
  "تكاليف المبيعات",
]);

export interface NamedAccount {
  name: string;
  nameEn?: string | null;
  type: AccountType;
  isPosting: boolean;
}

export function inferLiquidityFromName(account: NamedAccount): AccountLiquidity | null {
  if (!LIQUIDITY_ACCOUNT_TYPES.includes(account.type)) return null;
  const name = account.name;
  const en = account.nameEn || "";
  if (/الجزء المتداول/.test(name) || /current portion/i.test(en)) return "current";
  if (
    /(غير ال?متداول|طويلة الأجل|طويل الأجل|طويلة الاجل|طويل الاجل)/.test(name) ||
    /(non[- ]?current|long[- ]term)/i.test(en) ||
    (account.type === "asset" && (/^(ال)?(أصول|اصول|موجودات) (ال)?ثابتة/.test(name) || /^fixed assets/i.test(en)))
  ) {
    return "non_current";
  }
  if (/(متداول|قصيرة الأجل|قصير الأجل|قصيرة الاجل|قصير الاجل)/.test(name) || /(\bcurrent\b|short[- ]term)/i.test(en)) return "current";
  return null;
}

export function inferRoleFromName(account: NamedAccount): AccountAnalysisRole | null {
  const name = account.name.trim();
  if (!account.isPosting) {
    if (account.type === "asset" && INVENTORY_GROUP_NAMES.has(name)) return "inventory";
    if (account.type === "asset" && RECEIVABLE_GROUP_NAMES.has(name)) return "receivables";
    if (account.type === "liability" && PAYABLE_GROUP_NAMES.has(name)) return "payables";
    if (account.type === "expense" && COST_OF_SALES_GROUP_NAMES.has(name)) return "cost_of_sales";
  }
  if (account.type === "liability" && /(قرض|قروض|تسهيلات بنكية|تسهيلات ائتمانية|تمويل بنكي|مرابحة|تورق)/.test(account.name)) return "borrowings";
  if (account.type === "expense" && /(إهلاك|اهلاك|استهلاك الأصول)/.test(account.name)) return "depreciation";
  if ((account.type === "expense" || account.type === "revenue") && /(تمويل|فوائد)/.test(account.name) && !/(إيراد|ايراد)/.test(account.name)) {
    return "finance_cost";
  }
  return null;
}

export function inferClassificationFromName(account: NamedAccount) {
  return { liquidity: inferLiquidityFromName(account), analysisRole: inferRoleFromName(account) };
}

export interface ClassifiedAccount {
  id: string;
  parentId: string | null;
  type: AccountType;
  liquidity: AccountLiquidity | null;
  analysisRole: AccountAnalysisRole | null;
}

export interface EffectiveClassification {
  liquidity: AccountLiquidity | null;
  analysisRole: AccountAnalysisRole | null;
  /** مصدر القيمة: الحساب نفسه أو أبٌ ورثها منه — يُعرَض في شاشة الشجرة حتى لا تُفهَم الوراثة كقيمة مخزَّنة */
  liquidityInherited: boolean;
  analysisRoleInherited: boolean;
}

/**
 * يحسب التصنيف الفعلي لكل حساب بالوراثة من أقرب أب مصنَّف. الوراثة لا تعبر نوع الحساب (أب أصل لا يمنح دوراً
 * لحساب التزام)، ولا تمنح دوراً لا يناسب نوع الحساب. محمي من الحلقات (شجرة تالفة) بحد عمق.
 */
export function resolveEffectiveClassification(accounts: ClassifiedAccount[]): Map<string, EffectiveClassification> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result = new Map<string, EffectiveClassification>();
  for (const account of accounts) {
    let liquidity: AccountLiquidity | null = LIQUIDITY_ACCOUNT_TYPES.includes(account.type) ? account.liquidity : null;
    let analysisRole: AccountAnalysisRole | null =
      account.analysisRole && isRoleAllowedForType(account.analysisRole, account.type) ? account.analysisRole : null;
    let liquidityInherited = false;
    let analysisRoleInherited = false;
    let parent = account.parentId ? byId.get(account.parentId) : undefined;
    for (let depth = 0; parent && depth < 16 && (!liquidity || !analysisRole); depth++) {
      if (parent.type === account.type) {
        if (!liquidity && LIQUIDITY_ACCOUNT_TYPES.includes(account.type) && parent.liquidity) {
          liquidity = parent.liquidity;
          liquidityInherited = true;
        }
        if (!analysisRole && parent.analysisRole && isRoleAllowedForType(parent.analysisRole, account.type)) {
          analysisRole = parent.analysisRole;
          analysisRoleInherited = true;
        }
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    result.set(account.id, { liquidity, analysisRole, liquidityInherited, analysisRoleInherited });
  }
  return result;
}

/** يرفض تصنيفاً لا يناسب نوع الحساب — رسالة عربية ثابتة لها مقابل إنجليزي في i18n/errorMessages.ts */
export function assertClassificationFitsType(account: { type: AccountType; liquidity?: AccountLiquidity | null; analysisRole?: AccountAnalysisRole | null }) {
  if (account.liquidity && !LIQUIDITY_ACCOUNT_TYPES.includes(account.type)) {
    throw badRequest("تصنيف متداول/غير متداول للأصول والالتزامات فقط");
  }
  if (account.analysisRole && !isRoleAllowedForType(account.analysisRole, account.type)) {
    throw badRequest("دور الحساب في التحليل المالي لا يناسب نوع الحساب");
  }
}
