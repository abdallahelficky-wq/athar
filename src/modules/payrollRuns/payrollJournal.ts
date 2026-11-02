/**
 * بناء أسطر قيد الرواتب من صفوف الكشف — دالة نقية بلا قاعدة بيانات (كل الحسابات والتخصيصات تُحَلّ قبلها في
 * postPayrollRun)، فيُختبَر شكل القيد بالضبط كما يُرحَّل.
 *
 * قواعد التوجيه (قرار المالك 2026-11-01، بعد تحقيق J02074):
 * - الإضافات: مدين حساب البند، موسومة بقسم الموظف ومركز تكلفته.
 * - الغياب والجزاءات والاستقطاعات الأخرى (absence/penalty/otherDed): دائن مصروف رواتب الموظف نفسه (حساب بند
 *   «الراتب الأساسي») بنفس قسمه ومركزه — تخفيض للمصروف، لا التزام. كان الارتداد بالأسماء يوجّهها إلى «رواتب مستحقة».
 * - المخالفات (violation): دائن حساب ذمة الموظف الفرعي — يحتاج resolveViolationAccount؛ بدونه يفشل الترحيل.
 * - تأمينات الموظف وأي خصم آخر: دائن حساب البند.
 * - مساهمة صاحب العمل (kind=employer): مدين حساب البند (مصروف، موسوم) / دائن contraAccountId — لا تمسّ الصافي.
 * - أقساط السلف: سطر لكل موظف وسلفة في الوضعين، دائن حساب السلفة نفسها (EmployeeAdvance.accountId — حساب ذمة الموظف
 *   للسلف الجديدة، والحساب المشترك القديم لسلف ما قبل إعادة التصنيف حيث رصيدها فعلاً).
 * - الصافي: في وضع الإجماليات سطر واحد دائن على «رواتب مستحقة»؛ في الوضع القديم على حساب كل موظف.
 * - لا سطر غير الصافي يقع على حساب الصافي — يُرفَض الترحيل برسالة تسمّي البند (ضابط J02074).
 * - التخصيص (القسم/المركز) يُوسَم على أسطر حسابات المصروفات فقط؛ موظف بلا قسم ولا مركز يقع في مجموعة «غير مخصص»
 *   صريحة (department = UNASSIGNED_DEPARTMENT_LABEL، والمعرّفان null) — لا قسم افتراضي.
 * التقريب: قيمة كل بند لكل موظف تُقرَّب للهللة قبل التجميع، وكل سطر نهائي يُقرَّب للهللة، والصافي يُحسَب من الأسطر
 * المقرَّبة نفسها، فيتوازن القيد للهللة دائماً.
 */
import { badRequest } from "../../lib/httpError";

export const NET_PAYABLE_ACCOUNT_NAME = "رواتب مستحقة";
export const UNASSIGNED_DEPARTMENT_LABEL = "غير مخصص";
export const EXPENSE_REDUCTION_KEYS = new Set(["absence", "otherDed", "penalty"]);
export const VIOLATION_KEY = "violation";
export const BASIC_KEY = "basic";

export interface JournalComponent {
  id: string;
  name: string;
  kind: "addition" | "deduction" | "employer";
  accountId: string;
  contraAccountId?: string | null;
  systemKey?: string | null;
}

export interface EmployeeAllocation {
  departmentId: string | null;
  departmentName: string | null;
  costCenterId: string | null;
  /** حساب صافي الموظف في الوضع القديم (حسابه الفرعي أو «رواتب مستحقة» احتياطاً) */
  netAccountId?: string;
}

/** قسط سلفة محسوب في صف الكشف — يُرحَّل دائناً على حساب السلفة نفسها (حساب ذمة الموظف للسلف الجديدة) */
export interface JournalInstallment { advanceId: string; accountId: string; amount: number }
export const ADVANCES_COLUMN_ID = "advances";

export interface PayrollJournalLine {
  accountId: string;
  department: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  debit: number;
  credit: number;
  lineDescription?: string;
  employeeId?: string;
  employeeAdvanceId?: string;
}

export interface BuildPayrollJournalInput {
  mode: "totals" | "perEmployee";
  rows: { employeeId: string; employeeName?: string; componentValues: Record<string, number>; advanceInstallments?: JournalInstallment[] }[];
  components: Map<string, JournalComponent>;
  employees: Map<string, EmployeeAllocation>;
  accountTypeById: Map<string, string>;
  netPayableAccountId: string;
  resolveViolationAccount?: (employeeId: string) => string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface RawLine extends PayrollJournalLine { componentName: string; perEmployeeOnly?: boolean }

export function buildPayrollJournal(input: BuildPayrollJournalInput): { lines: PayrollJournalLine[]; advanceDeductions: { advanceId: string; amount: number }[] } {
  const { components, employees, accountTypeById, netPayableAccountId } = input;
  const basic = [...components.values()].find((c) => c.systemKey === BASIC_KEY);
  const raw: RawLine[] = [];
  const advanceDeductions: { advanceId: string; amount: number }[] = [];

  for (const row of input.rows) {
    const employee = employees.get(row.employeeId);
    if (!employee) throw badRequest("أحد موظفي الكشف غير موجود ضمن هذه الشركة");
    const allocate = (accountId: string) =>
      accountTypeById.get(accountId) === "expense"
        ? { department: employee.departmentName || UNASSIGNED_DEPARTMENT_LABEL, departmentId: employee.departmentId, costCenterId: employee.costCenterId }
        : { department: null, departmentId: null, costCenterId: null };
    const push = (component: JournalComponent, accountId: string, side: "debit" | "credit", value: number, extra: Partial<RawLine> = {}) => {
      if (accountId === netPayableAccountId) {
        throw badRequest(`البند «${component.name}» مربوط بحساب «${NET_PAYABLE_ACCOUNT_NAME}» المخصص لصافي الرواتب وحده — غيّر حساب البند من إعدادات الرواتب`);
      }
      raw.push({
        accountId, ...allocate(accountId), debit: side === "debit" ? value : 0, credit: side === "credit" ? value : 0,
        employeeId: row.employeeId, componentName: component.name, ...extra,
      });
    };

    for (const [componentId, rawValue] of Object.entries(row.componentValues)) {
      if (!rawValue || componentId === ADVANCES_COLUMN_ID) continue; // عمود الأقساط يُفصَّل لكل سلفة أدناه
      const component = components.get(componentId);
      if (!component) continue;
      // كل قيمة تُقرَّب للهللة لكل موظف قبل التجميع (كما في قسيمته)، فمجموع أي مجموعة دقيق بالهللات، ومساهمة صاحب
      // العمل يتساوى مدينها ودائنها بعد التجميع فلا تمسّ الصافي ولو بهللة
      const value = round2(rawValue);
      if (!value) continue;

      if (component.kind === "employer") {
        if (!component.contraAccountId) throw badRequest(`بند مساهمة صاحب العمل «${component.name}» بلا حساب دائن (الالتزام) — حدّده من إعدادات الرواتب`);
        push(component, component.accountId, "debit", value);
        push(component, component.contraAccountId, "credit", value);
      } else if (component.kind === "addition") {
        push(component, component.accountId, "debit", value);
      } else if (component.systemKey && EXPENSE_REDUCTION_KEYS.has(component.systemKey)) {
        if (!basic) throw badRequest(`لا يمكن ترحيل «${component.name}»: يُخصم من مصروف الراتب الأساسي ولا يوجد بند «الراتب الأساسي» فعّال في هذه الشركة`);
        push(component, basic.accountId, "credit", value);
      } else if (component.systemKey === VIOLATION_KEY) {
        if (!input.resolveViolationAccount) {
          throw badRequest(`لا يمكن ترحيل «${component.name}»: يُرحَّل على حساب ذمة الموظف الفرعي، وحسابات ذمم الموظفين غير مهيأة بعد في إعدادات الرواتب`);
        }
        push(component, input.resolveViolationAccount(row.employeeId), "credit", value);
      } else {
        push(component, component.accountId, "credit", value);
      }
    }

    // أقساط السلف: سطر لكل موظف وسلفة في الوضعين، دائن حساب السلفة نفسها
    for (const installment of row.advanceInstallments || []) {
      const amount = round2(installment.amount);
      if (!amount) continue;
      const pseudo: JournalComponent = { id: installment.advanceId, name: `قسط سلفة — ${row.employeeName ?? ""}`.trim(), kind: "deduction", accountId: installment.accountId };
      push(pseudo, installment.accountId, "credit", amount, { employeeAdvanceId: installment.advanceId, perEmployeeOnly: true });
      advanceDeductions.push({ advanceId: installment.advanceId, amount });
    }
  }

  const lines: PayrollJournalLine[] = [];
  const strip = ({ componentName: _n, perEmployeeOnly: _p, ...line }: RawLine): PayrollJournalLine => line;
  const finalize = (l: PayrollJournalLine): PayrollJournalLine | null => {
    const debit = round2(l.debit), credit = round2(l.credit);
    return debit || credit ? { ...l, debit, credit } : null;
  };

  if (input.mode === "perEmployee") {
    // الترحيل القديم: سطر لكل موظف لكل بند، ثم صافي كل موظف على حسابه — من أسطره المقرَّبة نفسها
    const byEmployee = new Map<string, PayrollJournalLine[]>();
    for (const r of raw) {
      const l = finalize(strip(r));
      if (!l) continue;
      if (!byEmployee.has(r.employeeId!)) byEmployee.set(r.employeeId!, []);
      byEmployee.get(r.employeeId!)!.push(l);
    }
    for (const row of input.rows) {
      const own = byEmployee.get(row.employeeId) || [];
      lines.push(...own);
      const net = round2(own.reduce((s, l) => s + l.debit - l.credit, 0));
      if (!net) continue;
      const netAccountId = employees.get(row.employeeId)!.netAccountId || netPayableAccountId;
      lines.push({ accountId: netAccountId, department: null, departmentId: null, costCenterId: null, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, employeeId: row.employeeId });
    }
    return { lines, advanceDeductions };
  }

  // الإجماليات: تجميع بـ(الحساب، الجانب، القسم، مركز التكلفة) بلا وسم موظف؛ أقساط السلف تبقى لكل موظف
  const groups = new Map<string, PayrollJournalLine & { names: string[] }>();
  const perEmployee: PayrollJournalLine[] = [];
  for (const r of raw) {
    if (r.perEmployeeOnly) {
      const l = finalize({ ...strip(r), lineDescription: r.componentName });
      if (l) perEmployee.push(l);
      continue;
    }
    const side = r.debit ? "D" : "C";
    const key = [r.accountId, side, r.departmentId ?? "", r.costCenterId ?? "", r.department ?? ""].join("|");
    const g = groups.get(key);
    if (g) {
      g.debit += r.debit; g.credit += r.credit;
      if (!g.names.includes(r.componentName)) g.names.push(r.componentName);
    } else {
      groups.set(key, { accountId: r.accountId, department: r.department, departmentId: r.departmentId, costCenterId: r.costCenterId, debit: r.debit, credit: r.credit, names: [r.componentName] });
    }
  }
  for (const { names, ...g } of groups.values()) {
    const l = finalize({ ...g, lineDescription: names.join("، ") });
    if (l) lines.push(l);
  }
  lines.push(...perEmployee);
  const net = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  if (net) {
    lines.push({
      accountId: netPayableAccountId, department: null, departmentId: null, costCenterId: null, lineDescription: "صافي الرواتب المستحقة",
      debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0,
    });
  }
  return { lines, advanceDeductions };
}
