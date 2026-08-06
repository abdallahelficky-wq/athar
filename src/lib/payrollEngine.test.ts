import { describe, it, expect } from "vitest";
import { computeEmployeePayroll, evaluateFormula, findCircularReference, PayrollComponentLike, PayrollSettingsLike } from "./payrollEngine";

const settings: PayrollSettingsLike = { standardHoursPerMonth: 240, standardDaysPerMonth: 30 };

const basic: PayrollComponentLike = {
  id: "basic", kind: "addition", calcMethod: "fixed", formula: null, adjustmentUnitBasis: null,
  sourceEmployeeField: "basicSalary", prorateOnPartialMonth: true,
};
const housing: PayrollComponentLike = {
  id: "housing", kind: "addition", calcMethod: "fixed", formula: null, adjustmentUnitBasis: null,
  sourceEmployeeField: "housingAllowance", prorateOnPartialMonth: true,
};
const transport: PayrollComponentLike = {
  id: "transport", kind: "addition", calcMethod: "fixed", formula: null, adjustmentUnitBasis: null,
  sourceEmployeeField: "transportAllowance", prorateOnPartialMonth: true,
};
const otherAllow: PayrollComponentLike = {
  id: "otherAllow", kind: "addition", calcMethod: "fixed", formula: null, adjustmentUnitBasis: null,
  sourceEmployeeField: "otherAllowance", prorateOnPartialMonth: true,
};

const employee = { basicSalary: 6000, housingAllowance: 1000, transportAllowance: 500, otherAllowance: 0 };

describe("evaluateFormula / computeEmployeePayroll — compound formula worked example", () => {
  it("computes 'أجر إضافي' = 1×ساعة من الإجمالي + 0.5×ساعة من الأساسي exactly as specified", () => {
    // GROSS_TOTAL anchor = basic+housing+transport+otherAllow = 6000+1000+500+0 = 7500
    // unit price (hour) of GROSS_TOTAL = 7500/240 = 31.25 ; of basic = 6000/240 = 25
    // extra pay = 1*31.25 + 0.5*25 = 43.75
    const extraPay: PayrollComponentLike = {
      id: "extraPay", kind: "addition", calcMethod: "formula",
      formula: {
        terms: [
          { quantity: 1, unitType: "hour", reference: { kind: "system", key: "GROSS_TOTAL" } },
          { quantity: 0.5, unitType: "hour", reference: { kind: "component", componentId: "basic" } },
        ],
      },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };

    const result = computeEmployeePayroll({
      employee,
      components: [basic, housing, transport, otherAllow, extraPay],
      fixedValues: new Map(),
      monthlyAdjustments: new Map(),
      settings,
      fullyOnLeave: false,
      prorationFactor: null,
    });

    expect(result.values.get("extraPay")).toBeCloseTo(43.75, 6);
    expect(result.totalAdditions).toBeCloseTo(7500 + 43.75, 6);
  });

  it("computes a plain percentage as a one-term formula with unitType null", () => {
    // بدل سكن = 25% من الأساسي = 0.25 * 6000 = 1500
    const housingPercent: PayrollComponentLike = {
      id: "housingPercent", kind: "addition", calcMethod: "formula",
      formula: { terms: [{ quantity: 0.25, unitType: null, reference: { kind: "component", componentId: "basic" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const result = computeEmployeePayroll({
      employee, components: [basic, housingPercent], fixedValues: new Map(), monthlyAdjustments: new Map(),
      settings, fullyOnLeave: false, prorationFactor: null,
    });
    expect(result.values.get("housingPercent")).toBeCloseTo(1500, 6);
  });

  it("matches GOSI's 9.75% rule (basic+housing) via a two-term formula", () => {
    const gosi: PayrollComponentLike = {
      id: "gosi", kind: "deduction", calcMethod: "formula",
      formula: {
        terms: [
          { quantity: 0.0975, unitType: null, reference: { kind: "component", componentId: "basic" } },
          { quantity: 0.0975, unitType: null, reference: { kind: "component", componentId: "housing" } },
        ],
      },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const result = computeEmployeePayroll({
      employee, components: [basic, housing, gosi], fixedValues: new Map(), monthlyAdjustments: new Map(),
      settings, fullyOnLeave: false, prorationFactor: null,
    });
    expect(result.values.get("gosi")).toBeCloseTo((6000 + 1000) * 0.0975, 6);
  });

  it("converts a units-based monthly adjustment (absence) using the same per-unit-rate logic as dailyRate", () => {
    // dailyRate القديم = (basic+housing+transport+otherAllow)/30 = 7500/30 = 250 ; 3 أيام غياب = 750
    const absence: PayrollComponentLike = {
      id: "absence", kind: "deduction", calcMethod: "fixed", formula: null,
      adjustmentUnitBasis: { unitType: "day", referenceComponentIds: ["basic", "housing", "transport", "otherAllow"] },
      sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const result = computeEmployeePayroll({
      employee, components: [basic, housing, transport, otherAllow, absence], fixedValues: new Map(),
      monthlyAdjustments: new Map([["absence", 3]]), settings, fullyOnLeave: false, prorationFactor: null,
    });
    expect(result.values.get("absence")).toBeCloseTo(250 * 3, 6);
  });

  it("applies a raw-amount monthly adjustment directly when adjustmentUnitBasis is null", () => {
    const bonus: PayrollComponentLike = {
      id: "bonus", kind: "addition", calcMethod: "fixed", formula: null, adjustmentUnitBasis: null,
      sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const result = computeEmployeePayroll({
      employee, components: [bonus], fixedValues: new Map(), monthlyAdjustments: new Map([["bonus", 500]]),
      settings, fullyOnLeave: false, prorationFactor: null,
    });
    expect(result.values.get("bonus")).toBe(500);
  });

  it("prorates only components flagged prorateOnPartialMonth", () => {
    const result = computeEmployeePayroll({
      employee, components: [basic, housing], fixedValues: new Map(), monthlyAdjustments: new Map(),
      settings, fullyOnLeave: false, prorationFactor: 0.5,
    });
    expect(result.values.get("basic")).toBeCloseTo(3000, 6);
    expect(result.values.get("housing")).toBeCloseTo(500, 6);
  });

  it("returns an all-zero blank result for an employee fully on leave this month", () => {
    const result = computeEmployeePayroll({
      employee, components: [basic, housing], fixedValues: new Map(), monthlyAdjustments: new Map(),
      settings, fullyOnLeave: true, prorationFactor: null,
    });
    expect(result.totalAdditions).toBe(0);
    expect(result.totalDeductions).toBe(0);
    expect(result.note).toContain("إجازة");
  });

  it("respects an EmployeePayrollComponent fixedValue override even for a formula component", () => {
    const gosi: PayrollComponentLike = {
      id: "gosi", kind: "deduction", calcMethod: "formula",
      formula: { terms: [{ quantity: 0.0975, unitType: null, reference: { kind: "component", componentId: "basic" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const result = computeEmployeePayroll({
      employee, components: [basic, gosi], fixedValues: new Map([["gosi", 900]]), monthlyAdjustments: new Map(),
      settings, fullyOnLeave: false, prorationFactor: null,
    });
    expect(result.values.get("gosi")).toBe(900);
  });
});

describe("findCircularReference", () => {
  it("detects a direct two-component cycle", () => {
    const a: PayrollComponentLike = {
      id: "a", kind: "addition", calcMethod: "formula",
      formula: { terms: [{ quantity: 1, unitType: null, reference: { kind: "component", componentId: "b" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    const b: PayrollComponentLike = {
      id: "b", kind: "addition", calcMethod: "formula",
      formula: { terms: [{ quantity: 1, unitType: null, reference: { kind: "component", componentId: "a" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    expect(findCircularReference([a, b])).not.toBeNull();
  });

  it("returns null when references form a DAG (no cycle)", () => {
    const a: PayrollComponentLike = {
      id: "a", kind: "addition", calcMethod: "formula",
      formula: { terms: [{ quantity: 1, unitType: null, reference: { kind: "component", componentId: "basic" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    expect(findCircularReference([basic, a])).toBeNull();
  });

  it("never treats a GROSS_TOTAL system reference as a cycle edge", () => {
    const a: PayrollComponentLike = {
      id: "a", kind: "addition", calcMethod: "formula",
      formula: { terms: [{ quantity: 1, unitType: "hour", reference: { kind: "system", key: "GROSS_TOTAL" } }] },
      adjustmentUnitBasis: null, sourceEmployeeField: null, prorateOnPartialMonth: false,
    };
    expect(findCircularReference([basic, a])).toBeNull();
  });
});

describe("evaluateFormula", () => {
  it("sums an unlimited number of terms", () => {
    const total = evaluateFormula(
      { terms: [
        { quantity: 1, unitType: null, reference: { kind: "system", key: "GROSS_TOTAL" } },
        { quantity: 2, unitType: null, reference: { kind: "system", key: "GROSS_TOTAL" } },
        { quantity: 3, unitType: null, reference: { kind: "system", key: "GROSS_TOTAL" } },
      ] },
      () => 10,
      settings,
    );
    expect(total).toBe(60);
  });
});
