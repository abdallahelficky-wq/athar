import { PayrollComponent } from "@prisma/client";
import { AdjustmentUnitBasis, PayrollComponentLike, PayrollFormula, SourceEmployeeField } from "./payrollEngine";

/** يحوّل صف PayrollComponent من قاعدة البيانات إلى الشكل الذي يفهمه محرّك الحساب (payrollEngine.ts) */
export function toComponentLike(c: PayrollComponent): PayrollComponentLike {
  return {
    id: c.id,
    kind: c.kind as "addition" | "deduction",
    calcMethod: c.calcMethod as "fixed" | "formula",
    formula: c.formula as unknown as PayrollFormula | null,
    adjustmentUnitBasis: c.adjustmentUnitBasis as unknown as AdjustmentUnitBasis | null,
    sourceEmployeeField: c.sourceEmployeeField as SourceEmployeeField | null,
    prorateOnPartialMonth: c.prorateOnPartialMonth,
  };
}
