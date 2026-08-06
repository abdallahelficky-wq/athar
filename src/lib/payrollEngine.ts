/**
 * محرّك حساب الرواتب المرن (Phase H) — يحل محل الجزء المتغيّر من hrCalculations.ts
 * (computeWidePayrollRow/PAYROLL_ROW_FIELDS/PAYROLL_JOURNAL_MAP) ببنود قابلة للتعديل الكامل.
 * البنية والتصميم موثّقان في /root/.claude/plans/shimmering-popping-thunder.md.
 *
 * "الراتب الإجمالي" (GROSS_TOTAL) كمرجع صيغة = مجموع بنود الإضافة ذات calcMethod="fixed" فقط
 * (الباقة الثابتة: الأساسي والبدلات)، وليس كل بنود الإضافة — هذا تعريف مستقر لا يدخل في حلقة
 * مع أي بند صيغة يشير إليه (بند صيغة لا يمكن أن يكون جزءاً من "الإجمالي" الذي يشير إليه بالتعريف)،
 * ويطابق المعنى المحاسبي المعتاد لـ"الأجر الإجمالي" المستخدَم كأساس لحساب الأجر الإضافي في نظام
 * العمل السعودي (باقة ثابتة، لا تشمل بنوداً متغيرة كالأجر الإضافي نفسه).
 */

export type PayrollFormulaReference = { kind: "component"; componentId: string } | { kind: "system"; key: "GROSS_TOTAL" };

export interface PayrollFormulaTerm {
  quantity: number;
  // null = quantity مضروبة مباشرة في قيمة المرجع (نسبة مئوية)؛ "hour"/"day" = تحويل بسعر الوحدة
  unitType: "hour" | "day" | null;
  reference: PayrollFormulaReference;
}

export interface PayrollFormula {
  terms: PayrollFormulaTerm[];
}

export interface AdjustmentUnitBasis {
  unitType: "hour" | "day";
  referenceComponentIds: string[];
}

export type SourceEmployeeField = "basicSalary" | "housingAllowance" | "transportAllowance" | "otherAllowance";

export interface PayrollComponentLike {
  id: string;
  kind: "addition" | "deduction";
  calcMethod: "fixed" | "formula";
  formula: PayrollFormula | null;
  adjustmentUnitBasis: AdjustmentUnitBasis | null;
  sourceEmployeeField: SourceEmployeeField | null;
  prorateOnPartialMonth: boolean;
}

export interface PayrollSettingsLike {
  standardHoursPerMonth: number;
  standardDaysPerMonth: number;
}

export interface EmployeeBaseSalary {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
}

/**
 * يكتشف الحلقات الدائرية بين البنود عبر مراجع formula/adjustmentUnitBasis الصريحة فقط (لا يشمل
 * GROSS_TOTAL إطلاقاً — انظر تعليق الملف أعلاه لسبب أمان هذا التبسيط). يُستدعى وقت حفظ أي بند
 * بصيغة formula عبر واجهة الإعدادات، ويجب رفض الحفظ برسالة واضحة عند اكتشاف حلقة.
 * يُرجع مسار الحلقة (لعرضه في رسالة الخطأ) أو null إن لم توجد حلقة.
 */
export function findCircularReference(components: PayrollComponentLike[]): string[] | null {
  const edgesOf = (c: PayrollComponentLike): string[] => {
    const deps = new Set<string>();
    for (const term of c.formula?.terms || []) {
      if (term.reference.kind === "component") deps.add(term.reference.componentId);
    }
    for (const id of c.adjustmentUnitBasis?.referenceComponentIds || []) deps.add(id);
    return [...deps];
  };
  const byId = new Map(components.map((c) => [c.id, c]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const state = new Map<string, number>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, GRAY);
    path.push(id);
    const component = byId.get(id);
    for (const dep of component ? edgesOf(component) : []) {
      const depState = state.get(dep) ?? WHITE;
      if (depState === GRAY) return [...path.slice(path.indexOf(dep)), dep];
      if (depState === WHITE) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    path.pop();
    state.set(id, BLACK);
    return null;
  };

  for (const c of components) {
    if ((state.get(c.id) ?? WHITE) === WHITE) {
      const cycle = visit(c.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

function unitDivisor(unitType: "hour" | "day", settings: PayrollSettingsLike): number {
  return unitType === "hour" ? settings.standardHoursPerMonth : settings.standardDaysPerMonth;
}

/** يقيّم صيغة مركّبة واحدة: مجموع كل الحدود، كل حدّ = quantity × (قيمة المرجع، أو سعر وحدتها). */
export function evaluateFormula(
  formula: PayrollFormula,
  resolveReference: (ref: PayrollFormulaReference) => number,
  settings: PayrollSettingsLike,
): number {
  return formula.terms.reduce((sum, term) => {
    const refValue = resolveReference(term.reference);
    const termValue = term.unitType ? term.quantity * (refValue / unitDivisor(term.unitType, settings)) : term.quantity * refValue;
    return sum + termValue;
  }, 0);
}

export interface ComputeEmployeePayrollParams {
  employee: EmployeeBaseSalary;
  components: PayrollComponentLike[]; // كل البنود المُسنَدة الفعّالة لهذا الموظف
  fixedValues: Map<string, number>; // componentId -> EmployeePayrollComponent.fixedValue
  // componentId -> مجموع HrAction.value الخام لهذا الشهر (وحدات إن كان adjustmentUnitBasis محدداً، وإلا مبلغ مباشر)
  monthlyAdjustments: Map<string, number>;
  settings: PayrollSettingsLike;
  // true = الموظف في إجازة كامل الشهر: كل البنود صفر (تسويتها منفصلة عبر تسويات الإجازة)
  fullyOnLeave: boolean;
  // نسبة تناسب (0..1) تُطبَّق فقط على بنود prorateOnPartialMonth (عودة من إجازة منتصف الشهر)؛ null = شهر كامل
  prorationFactor: number | null;
}

export interface EmployeePayrollResult {
  values: Map<string, number>; // القيمة النهائية (أساس + تسوية شهرية) لكل بند
  totalAdditions: number;
  totalDeductions: number;
  net: number;
  note: string;
}

const blankResult = (note: string): EmployeePayrollResult => ({ values: new Map(), totalAdditions: 0, totalDeductions: 0, net: 0, note });

export function computeEmployeePayroll(params: ComputeEmployeePayrollParams): EmployeePayrollResult {
  const { employee, components, fixedValues, monthlyAdjustments, settings, fullyOnLeave, prorationFactor } = params;
  if (fullyOnLeave) return blankResult("الموظف في إجازة — تمت تسوية مستحقاته بشكل منفصل");

  const byId = new Map(components.map((c) => [c.id, c]));
  const baseValues = new Map<string, number>();

  const proratedIf = (component: PayrollComponentLike, value: number) =>
    component.prorateOnPartialMonth && prorationFactor != null ? value * prorationFactor : value;

  // 1) البنود الثابتة أولاً (لا تعتمد على أي بند آخر) — مرآة لعمود الموظف أو قيمة EmployeePayrollComponent
  //    (أو تجاوز يدوي: fixedValue محدد حتى لو كان calcMethod="formula"، لحالات مثل تأمينات موظف بقيمة ثابتة استثنائية)
  for (const c of components) {
    const overrideValue = fixedValues.get(c.id);
    if (overrideValue != null) {
      baseValues.set(c.id, proratedIf(c, overrideValue));
      continue;
    }
    if (c.calcMethod === "fixed") {
      const value = c.sourceEmployeeField ? employee[c.sourceEmployeeField] : 0;
      baseValues.set(c.id, proratedIf(c, value));
    }
  }

  // 2) الإجمالي الثابت (GROSS_TOTAL) = مجموع بنود الإضافة ذات calcMethod="fixed" (بعد التناسب) — انظر تعليق الملف
  const grossTotalAnchor = components
    .filter((c) => c.kind === "addition" && c.calcMethod === "fixed")
    .reduce((s, c) => s + (baseValues.get(c.id) || 0), 0);

  // 3) البنود ذات الصيغة المركّبة — حل تكراري بالتذكّر (memoized)، لا حلقات (مُتحقَّق منها وقت الحفظ)
  const resolving = new Set<string>();
  const resolveComponentValue = (id: string): number => {
    if (baseValues.has(id)) return baseValues.get(id)!;
    if (resolving.has(id)) return 0; // احتياط دفاعي فقط — لا يجب الوصول هنا لو findCircularReference طُبِّق وقت الحفظ
    const component = byId.get(id);
    if (!component || component.calcMethod !== "formula" || !component.formula) return 0;
    resolving.add(id);
    const value = evaluateFormula(
      component.formula,
      (ref) => (ref.kind === "system" ? grossTotalAnchor : resolveComponentValue(ref.componentId)),
      settings,
    );
    resolving.delete(id);
    const finalValue = proratedIf(component, value);
    baseValues.set(id, finalValue);
    return finalValue;
  };
  for (const c of components) if (c.calcMethod === "formula") resolveComponentValue(c.id);

  // 4) التسويات الشهرية (HrAction) فوق القيمة الأساسية — وحدات (أيام/ساعات) تُحوَّل بسعر الوحدة، أو مبلغ مباشر
  const values = new Map<string, number>();
  for (const c of components) {
    const base = baseValues.get(c.id) || 0;
    const rawAdjustment = monthlyAdjustments.get(c.id);
    let adjustmentAmount = 0;
    if (rawAdjustment) {
      if (c.adjustmentUnitBasis) {
        const referencedTotal = c.adjustmentUnitBasis.referenceComponentIds.reduce((s, refId) => s + (baseValues.get(refId) || 0), 0);
        adjustmentAmount = rawAdjustment * (referencedTotal / unitDivisor(c.adjustmentUnitBasis.unitType, settings));
      } else {
        adjustmentAmount = rawAdjustment;
      }
    }
    values.set(c.id, base + adjustmentAmount);
  }

  const totalAdditions = components.filter((c) => c.kind === "addition").reduce((s, c) => s + (values.get(c.id) || 0), 0);
  const totalDeductions = components.filter((c) => c.kind === "deduction").reduce((s, c) => s + (values.get(c.id) || 0), 0);

  return { values, totalAdditions, totalDeductions, net: totalAdditions - totalDeductions, note: "" };
}
