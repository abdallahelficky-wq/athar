import type { ActivityAddonState, BusinessActivity, SubscriptionPlan } from "@prisma/client";

/**
 * خريطة الباقات إلى معرّفات الصلاحيات (docs/design/subscription-plans.md §2) — المصدر الوحيد لما تشمله كل باقة. الإنفاذ على
 * الخادم (P4) يسأل isModuleAllowed قبل فحص المنصب في requirePositionAction، والواجهة (P10) تشتقّ القوائم منها. المعرّفات هي
 * نفسها معرّفات POSITION_RESOURCES (src/lib/positionMatrix.ts)، واختبار التغطية يفرض أن كل معرّف مسجَّل مصنَّف هنا مرة واحدة.
 *
 * لا شيء يستدعي هذه الدوال بعد (المرحلة P2): لا تغيير في السلوك.
 */

export const PLANS = ["basic", "professional", "enterprise"] as const satisfies readonly SubscriptionPlan[];

/** المستخدمون المشمولون لكل شركة (§5.3) — يُضاف إليها extraUsers المشتراة */
export const INCLUDED_USERS: Record<SubscriptionPlan, number> = { basic: 2, professional: 5, enterprise: 15 };

/** الفروع وصفية فقط ولا تُنفَّذ (D4) — للعرض في بطاقات الباقات وحدها. null = غير محدود */
export const DESCRIPTIVE_BRANCHES: Record<SubscriptionPlan, number | null> = { basic: 1, professional: 3, enterprise: null };

/** بنية تحتية متاحة في كل باقة بلا شرط (§2 "Always available") */
export const ALWAYS_MODULES = [
  "companySettings",
  "userAdministration",
  "branches",
  "documentNumberingSettings",
  "companyBankAccounts",
  "companyDocuments",
  "attachments",
  "leaseContracts",
] as const;

/** ما تضيفه كل باقة فوق السابقة — الأساسية ⊂ الاحترافية ⊂ المؤسسية */
const PLAN_ADDS: Record<SubscriptionPlan, readonly string[]> = {
  basic: [
    // المبيعات والعملاء وعروض الأسعار
    "salesInvoices", "salesReturns", "salesDebitNotes", "receipts", "salesReports", "customers", "quotations",
    // المشتريات والموردون
    "purchaseInvoices", "purchaseReturns", "suppliers", "purchaseReports",
    // القيود وشجرة الحسابات، ومراكز التكلفة والأقسام (D12)
    "journalEntries", "accounts", "costCenters", "departments",
    // التقارير والمطابقة الضريبية والتقارير المجدولة ولوحة المعلومات
    "reports", "vatReconciliation", "reportSchedules", "dashboard",
    // زاتكا المرحلة الثانية في كل باقة
    "companiesZatca",
    // كتالوج الأصناف + حركة المخزون التلقائية على المستودع الافتراضي + رصيد بسيط (D11)
    "items",
  ],
  professional: [
    // مستودعات متعددة، حركات يدوية، سندات صرف، تحويلات، تسوية دورية، تقارير مخزون (D11)
    "stockMovements", "warehouses", "periodicSettlement", "inventoryReports",
    // الأصول الثابتة
    "fixedAssets", "depreciation", "assetCategories",
  ],
  enterprise: [
    // الموارد البشرية والرواتب
    "employees", "payrollRuns", "payrollSettings", "leaveSettlements", "leaveReturns", "hrActions", "employeeAdvances",
    "hrReports", "attendance",
    // ليس مساراً بل علَم إظهار البيانات الشخصية والرواتب في التقارير والمرفقات — بيانات لا توجد إلا مع الموارد البشرية
    "hrSensitiveData",
    // أثر AI — غير ظاهر للمستخدم بعد (D15)
    "ai",
  ],
};

/** المعرّفات التي تفتحها كل إضافة (§2 Add-ons). الموظفون لإضافة المحطات محصورون في عمّال المحطات — انظر employeesScope */
export const ADDON_MODULES = {
  pos: ["pos"],
  stations: ["stationSetup", "stationShiftsReports", "stationSales"],
  stables: ["stables"],
} as const;

/** النشاط الذي يفعّل كل إضافة نشاط تلقائياً (D13) — مطابق لإظهار الواجهة اليوم (frontend/src/App.jsx) */
export const ACTIVITY_ADDON_TRIGGER = {
  stations: "fuel_stations",
  stables: "horse_stables",
} as const satisfies Record<"stations" | "stables", BusinessActivity>;

export function planModules(plan: SubscriptionPlan): Set<string> {
  const order = PLANS.slice(0, PLANS.indexOf(plan) + 1);
  return new Set(order.flatMap((p) => PLAN_ADDS[p]));
}

export type CompanyEntitlementInput = {
  plan: SubscriptionPlan;
  posEnabled: boolean;
  stationsAddon: ActivityAddonState;
  stablesAddon: ActivityAddonState;
  businessActivity: BusinessActivity | null;
};

/** إضافة نشاط فعّالة إذا طابق نشاط الشركة (تلقائياً، D13) أو منحها المدير صراحةً (free/paid) */
export function activityAddonActive(kind: "stations" | "stables", input: CompanyEntitlementInput): boolean {
  const state = kind === "stations" ? input.stationsAddon : input.stablesAddon;
  return input.businessActivity === ACTIVITY_ADDON_TRIGGER[kind] || state !== "off";
}

export type CompanyEntitlements = {
  modules: Set<string>;
  /** all = كل الموظفين (المؤسسية)، stationWorkers = عمّال المحطات فقط (assignedCostCenterId معيَّن، D20)، none = لا شيء */
  employeesScope: "all" | "stationWorkers" | "none";
};

export function companyEntitlements(input: CompanyEntitlementInput): CompanyEntitlements {
  const modules = new Set<string>([...ALWAYS_MODULES, ...planModules(input.plan)]);
  if (input.posEnabled) ADDON_MODULES.pos.forEach((m) => modules.add(m));
  const stations = activityAddonActive("stations", input);
  if (stations) ADDON_MODULES.stations.forEach((m) => modules.add(m));
  if (activityAddonActive("stables", input)) ADDON_MODULES.stables.forEach((m) => modules.add(m));

  let employeesScope: CompanyEntitlements["employeesScope"] = "none";
  if (modules.has("employees")) employeesScope = "all";
  else if (stations) {
    // D20: إضافة المحطات تفتح سجلات عمّال المحطات وحدها على أي باقة — بلا رواتب ولا إجازات ولا تقارير موارد بشرية
    modules.add("employees");
    employeesScope = "stationWorkers";
  }
  return { modules, employeesScope };
}

export function isModuleAllowed(input: CompanyEntitlementInput, moduleId: string): boolean {
  return companyEntitlements(input).modules.has(moduleId);
}

/** حد المستخدمين لكل شركة (§5.3) */
export function userLimit(plan: SubscriptionPlan, extraUsers: number): number {
  return INCLUDED_USERS[plan] + extraUsers;
}

/** حد مستخدمي نقطة البيع (D27): مستخدم واحد مجاني ضمن التفعيل + المقاعد الإضافية المدفوعة؛ صفر بلا تفعيل */
export function posUserLimit(posEnabled: boolean, additionalPosUsers: number): number {
  return posEnabled ? 1 + additionalPosUsers : 0;
}
