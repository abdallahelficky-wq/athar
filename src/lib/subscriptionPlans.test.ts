import { describe, expect, it } from "vitest";
import { POSITION_RESOURCES } from "./positionMatrix";
import {
  ADDON_MODULES,
  ALWAYS_MODULES,
  type CompanyEntitlementInput,
  companyEntitlements,
  INCLUDED_USERS,
  isModuleAllowed,
  planModules,
  PLANS,
  posUserLimit,
  userLimit,
} from "./subscriptionPlans";

/** docs/design/subscription-plans.md §2 — الخريطة مقابل سجلّ الصلاحيات الحقيقي (POSITION_RESOURCES)، لا قائمة مكتوبة هنا */
const company = (over: Partial<CompanyEntitlementInput> = {}): CompanyEntitlementInput => ({
  plan: "basic",
  posEnabled: false,
  stationsAddon: "off",
  stablesAddon: "off",
  businessActivity: "retail",
  ...over,
});

describe("subscription plan map", () => {
  it("classifies every registered permission id exactly once: always, a plan tier, or an add-on", () => {
    const tierOf = new Map<string, string[]>();
    const add = (id: string, where: string) => tierOf.set(id, [...(tierOf.get(id) ?? []), where]);
    ALWAYS_MODULES.forEach((id) => add(id, "always"));
    let previous = new Set<string>();
    for (const plan of PLANS) {
      const mods = planModules(plan);
      for (const id of mods) if (!previous.has(id)) add(id, plan);
      previous = mods;
    }
    Object.entries(ADDON_MODULES).forEach(([addon, ids]) => ids.forEach((id) => add(id, `addon:${addon}`)));

    const registered = POSITION_RESOURCES.map((r) => r.id);
    const unclassified = registered.filter((id) => !tierOf.has(id));
    const duplicated = [...tierOf].filter(([, where]) => where.length > 1);
    const unknown = [...tierOf.keys()].filter((id) => !registered.includes(id));
    expect({ unclassified, duplicated, unknown }).toEqual({ unclassified: [], duplicated: [], unknown: [] });
  });

  it("nests the plans: basic ⊂ professional ⊂ enterprise", () => {
    const [b, p, e] = PLANS.map(planModules);
    expect([...b].every((m) => p.has(m))).toBe(true);
    expect([...p].every((m) => e.has(m))).toBe(true);
    expect([b.size < p.size, p.size < e.size]).toEqual([true, true]);
  });

  it("puts sales, purchases, accounting, reports, ZATCA, items, cost centers and departments in every plan (D11, D12)", () => {
    for (const id of ["salesInvoices", "receipts", "quotations", "purchaseInvoices", "journalEntries", "accounts", "reports", "vatReconciliation", "companiesZatca", "items", "costCenters", "departments"]) {
      expect(isModuleAllowed(company(), id), id).toBe(true);
    }
  });

  it("splits stock: basic keeps items only; professional adds warehouses, movements, periodic settlement, inventory reports and fixed assets (D11)", () => {
    const pro = ["stockMovements", "warehouses", "periodicSettlement", "inventoryReports", "fixedAssets", "depreciation", "assetCategories"];
    expect(pro.filter((id) => isModuleAllowed(company(), id))).toEqual([]);
    expect(pro.filter((id) => !isModuleAllowed(company({ plan: "professional" }), id))).toEqual([]);
  });

  it("keeps HR, payroll, sensitive HR data and Athar AI for enterprise only (D15)", () => {
    const ent = ["employees", "payrollRuns", "payrollSettings", "leaveSettlements", "leaveReturns", "hrActions", "employeeAdvances", "hrReports", "attendance", "hrSensitiveData", "ai"];
    expect(ent.filter((id) => isModuleAllowed(company({ plan: "professional" }), id))).toEqual([]);
    expect(ent.filter((id) => !isModuleAllowed(company({ plan: "enterprise" }), id))).toEqual([]);
    expect(companyEntitlements(company({ plan: "enterprise" })).employeesScope).toBe("all");
  });

  it("leaves branches and the infrastructure ids open on every plan (branches are descriptive only, D4)", () => {
    for (const plan of PLANS) for (const id of ALWAYS_MODULES) expect(isModuleAllowed(company({ plan }), id)).toBe(true);
  });

  it("opens POS only when POS is enabled, on any plan (D27)", () => {
    expect(isModuleAllowed(company({ plan: "enterprise" }), "pos")).toBe(false);
    expect(isModuleAllowed(company({ posEnabled: true }), "pos")).toBe(true);
  });

  it("turns the stations add-on on by activity and grants station-worker employee records only, on any plan (D13, D20)", () => {
    const basicStation = companyEntitlements(company({ businessActivity: "fuel_stations" }));
    for (const id of ["stationSetup", "stationShiftsReports", "stationSales", "employees"]) expect(basicStation.modules.has(id), id).toBe(true);
    expect(basicStation.employeesScope).toBe("stationWorkers");
    // بلا رواتب ولا إجازات ولا بيانات حساسة
    for (const id of ["payrollRuns", "leaveSettlements", "hrReports", "hrSensitiveData", "attendance"]) expect(basicStation.modules.has(id), id).toBe(false);
    // نشاط آخر: لا محطات ولا موظفين على الأساسية
    expect(companyEntitlements(company()).employeesScope).toBe("none");
    expect(isModuleAllowed(company(), "stationSetup")).toBe(false);
    // منح صريح من المدير يفتحها لنشاط آخر
    expect(isModuleAllowed(company({ stationsAddon: "free" }), "stationSetup")).toBe(true);
    // المؤسسية مع المحطات: كل الموظفين
    expect(companyEntitlements(company({ plan: "enterprise", businessActivity: "fuel_stations" })).employeesScope).toBe("all");
  });

  it("turns the stables add-on on by activity only, unless granted explicitly (D13)", () => {
    expect(isModuleAllowed(company({ businessActivity: "horse_stables" }), "stables")).toBe(true);
    expect(isModuleAllowed(company({ plan: "enterprise" }), "stables")).toBe(false);
    expect(isModuleAllowed(company({ stablesAddon: "paid" }), "stables")).toBe(true);
  });

  it("limits users per company to the plan's included users plus purchased extra users", () => {
    expect(INCLUDED_USERS).toEqual({ basic: 2, professional: 5, enterprise: 15 });
    expect(userLimit("basic", 3)).toBe(5);
  });

  it("limits POS users to one free seat plus the additional paid seats, and to zero without POS (D27)", () => {
    expect([posUserLimit(false, 0), posUserLimit(true, 0), posUserLimit(true, 2)]).toEqual([0, 1, 3]);
  });
});
