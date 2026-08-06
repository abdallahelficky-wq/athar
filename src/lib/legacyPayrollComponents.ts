/**
 * الوصف الثابت للبنود الاثني عشر التي كانت مقفولة سابقاً في hrCalculations.ts (WidePayrollRow/
 * PAYROLL_JOURNAL_MAP) — مصدر واحد يُستخدَم من مكانين: scripts/backfillPayrollComponents.ts (لبناء
 * PayrollComponent حقيقية في القاعدة) و payrollRuns.service.ts (لتوليف نفس البنود مؤقتاً في
 * الذاكرة لأي شركة لم يُشغَّل لها الـ backfill بعد — نفس النتيجة الحسابية دون أي كتابة لقاعدة
 * البيانات، ضماناً لعدم تغيّر سلوك أي شركة قبل تشغيل الـ backfill صراحة).
 */
import type { AdjustmentUnitBasis, PayrollFormula, SourceEmployeeField } from "./payrollEngine";

export type LegacyComponentKey =
  | "basic" | "housing" | "transport" | "otherAllow" | "otherAdd" | "overtime"
  | "advance" | "violation" | "penalty" | "otherDed" | "gosi" | "absence";

export interface LegacyComponentSpec {
  key: LegacyComponentKey;
  name: string;
  kind: "addition" | "deduction";
  calcMethod: "fixed" | "formula";
  accountName: string;
  sourceEmployeeField?: SourceEmployeeField;
  prorateOnPartialMonth: boolean;
  allowsMonthlyAdjustments: boolean;
  adjustmentUnitBasisKeys?: { unitType: "hour" | "day"; referenceKeys: LegacyComponentKey[] };
  formulaTerms?: { quantity: number; referenceKey: LegacyComponentKey }[]; // كلها unitType:null (نسبة مباشرة)
}

// مطابقة حرفية لـ PAYROLL_JOURNAL_MAP القديم، بترتيب يضمن أن أي بند formula/adjustmentUnitBasis
// يُنشأ بعد البنود التي يشير إليها. "absence" إضافة جديدة (لم يكن لها حساب في PAYROLL_JOURNAL_MAP
// القديم رغم خصمها فعلياً من الصافي — كان هذا خللاً في توازن القيد القديم، انظر تعليق backfillPayrollComponents.ts).
export const LEGACY_PAYROLL_COMPONENTS: LegacyComponentSpec[] = [
  { key: "basic", name: "الراتب الأساسي", kind: "addition", calcMethod: "fixed", accountName: "مصروف رواتب أساسية", sourceEmployeeField: "basicSalary", prorateOnPartialMonth: true, allowsMonthlyAdjustments: false },
  { key: "housing", name: "بدل السكن", kind: "addition", calcMethod: "fixed", accountName: "مصروف بدل سكن", sourceEmployeeField: "housingAllowance", prorateOnPartialMonth: true, allowsMonthlyAdjustments: false },
  { key: "transport", name: "بدل المواصلات", kind: "addition", calcMethod: "fixed", accountName: "مصروف بدل مواصلات", sourceEmployeeField: "transportAllowance", prorateOnPartialMonth: true, allowsMonthlyAdjustments: false },
  { key: "otherAllow", name: "بدلات أخرى", kind: "addition", calcMethod: "fixed", accountName: "مصروف بدلات أخرى", sourceEmployeeField: "otherAllowance", prorateOnPartialMonth: true, allowsMonthlyAdjustments: false },
  { key: "otherAdd", name: "إضافات وحوافز أخرى", kind: "addition", calcMethod: "fixed", accountName: "مصروف إضافات وحوافز أخرى", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "overtime", name: "أجر إضافي", kind: "addition", calcMethod: "fixed", accountName: "مصروف بدل إضافي (عمل إضافي)", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "advance", name: "سلف الموظفين", kind: "deduction", calcMethod: "fixed", accountName: "سلف الموظفين", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "violation", name: "خصم مخالفات", kind: "deduction", calcMethod: "fixed", accountName: "صندوق العاملين - مخالفات وعقوبات", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "penalty", name: "خصم جزاءات", kind: "deduction", calcMethod: "fixed", accountName: "صندوق العاملين - مخالفات وعقوبات", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "otherDed", name: "استقطاعات أخرى", kind: "deduction", calcMethod: "fixed", accountName: "استقطاعات أخرى مستحقة", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true },
  { key: "gosi", name: "التأمينات الاجتماعية", kind: "deduction", calcMethod: "formula", accountName: "التأمينات الاجتماعية - مستحقة", prorateOnPartialMonth: false, allowsMonthlyAdjustments: false, formulaTerms: [{ quantity: 0.0975, referenceKey: "basic" }, { quantity: 0.0975, referenceKey: "housing" }] },
  { key: "absence", name: "خصم الغياب", kind: "deduction", calcMethod: "fixed", accountName: "استقطاعات أخرى مستحقة", prorateOnPartialMonth: false, allowsMonthlyAdjustments: true, adjustmentUnitBasisKeys: { unitType: "day", referenceKeys: ["basic", "housing", "transport", "otherAllow"] } },
];

// actionType الحر القديم -> مفتاح البند الجديد؛ "warning" بلا أثر مالي فيبقى بلا بند (كما كان بالضبط)
export const LEGACY_ACTION_TYPE_TO_KEY: Record<string, LegacyComponentKey> = {
  absence: "absence", overtime: "overtime", bonus: "otherAdd", other_addition: "otherAdd",
  advance: "advance", violation: "violation", penalty: "penalty", other_deduction: "otherDed",
};

// عكس الخريطة أعلاه (تمثيل واحد لكل مفتاح) — يُستخدَم عند إنشاء HrAction جديد لشركة لم يُشغَّل لها
// backfillPayrollComponents.ts بعد: يُخزَّن actionType نصياً (بلا componentId حقيقي) بنفس الاسم الذي
// تبحث عنه computeRun في payrollRuns.service.ts عبر LEGACY_ACTION_TYPE_TO_KEY. البنود الأربعة
// الثابتة (basic/housing/transport/otherAllow) وGOSI غير قابلة للتسوية الشهرية أصلاً فلا تحتاج تمثيلاً هنا.
export const LEGACY_KEY_TO_ACTION_TYPE: Partial<Record<LegacyComponentKey, string>> = {
  absence: "absence", overtime: "overtime", otherAdd: "other_addition",
  advance: "advance", violation: "violation", penalty: "penalty", otherDed: "other_deduction",
};

export function buildLegacyFormula(spec: LegacyComponentSpec, idByKey: Map<LegacyComponentKey, string>): PayrollFormula | null {
  if (!spec.formulaTerms) return null;
  return { terms: spec.formulaTerms.map((t) => ({ quantity: t.quantity, unitType: null, reference: { kind: "component" as const, componentId: idByKey.get(t.referenceKey)! } })) };
}

export function buildLegacyAdjustmentUnitBasis(spec: LegacyComponentSpec, idByKey: Map<LegacyComponentKey, string>): AdjustmentUnitBasis | null {
  if (!spec.adjustmentUnitBasisKeys) return null;
  return { unitType: spec.adjustmentUnitBasisKeys.unitType, referenceComponentIds: spec.adjustmentUnitBasisKeys.referenceKeys.map((k) => idByKey.get(k)!) };
}
