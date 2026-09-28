import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { PersonalFold } from "./personalAccounts";

/**
 * قيود الموارد البشرية لغير أدوار الموارد البشرية (قرار المالك 2026-09-28):
 * - قيد الرواتب: يُعرَض إجمالياً لكل حساب — لا سطر لكل موظف، ولا اسم موظف، ولا حساب موظف بعينه (يُطوى
 *   لمجموعته). القيود المرحَّلة قبل التحويل للترحيل بالإجماليات لا يُعاد كتابتها؛ الطيّ عند العرض فقط،
 *   فيبقى الأستاذ مطابقاً لميزان المراجعة.
 * - تسوية الإجازة وصرفها: نفس الطيّ، ويُحذَف اسم الموظف من البيان («مستحقات إجازة — الاسم»).
 * - السلف وأقساطها تبقى باسم صاحبها للجميع: أسطر السلف (employeeAdvanceId) لا تُطوى.
 * - قيد العكس ينسخ بيان الأصل وأسطره بمصدر "manual"، فيُعامَل عكس قيد حساس معاملة الأصل — وإلا صار العكس
 *   طريقاً جانبياً للاسم.
 */
export type HrEntryKind = "payroll" | "leave_settlement";

const HR_MODULES: readonly string[] = ["payroll", "leave_settlement"];

export async function hrEntryKinds(
  tenantId: string,
  entries: { id: string; sourceModule: string; reversalOfEntryId?: string | null }[],
): Promise<Map<string, HrEntryKind>> {
  const kinds = new Map<string, HrEntryKind>();
  const reversalTargets = new Map<string, string[]>();
  for (const e of entries) {
    if (HR_MODULES.includes(e.sourceModule)) kinds.set(e.id, e.sourceModule as HrEntryKind);
    else if (e.reversalOfEntryId) reversalTargets.set(e.reversalOfEntryId, [...(reversalTargets.get(e.reversalOfEntryId) || []), e.id]);
  }
  if (reversalTargets.size) {
    const sources = await prisma.journalEntry.findMany({
      where: { tenantId, id: { in: [...reversalTargets.keys()] }, sourceModule: { in: ["payroll", "leave_settlement"] } },
      select: { id: true, sourceModule: true },
    });
    for (const s of sources) for (const id of reversalTargets.get(s.id) || []) kinds.set(id, s.sourceModule as HrEntryKind);
  }
  return kinds;
}

/** بيان قيد التسوية يحمل اسم الموظف بعد « — »؛ يُحذَف. بيان الرواتب («كشف رواتب شهر — N موظف») لا اسم فيه. */
export function redactHrMemo(kind: HrEntryKind | undefined, memo: string | null): string | null {
  if (kind !== "leave_settlement" || !memo) return memo;
  return memo.split(" — ")[0];
}

type LineLike = {
  id: string;
  accountId: string;
  account?: unknown;
  debit: Prisma.Decimal | number;
  credit: Prisma.Decimal | number;
  description?: string | null;
  employeeId?: string | null;
  employeeAdvanceId?: string | null;
  costCenterId?: string | null;
  departmentId?: string | null;
  department?: string | null;
  branchId?: string | null;
};

const toDecimal = (v: Prisma.Decimal | number) => new Prisma.Decimal(v as Prisma.Decimal.Value);

/**
 * أسطر قيد حساس مطويّة: كل سطر يحمل موظفاً أو حساب شخص يُجمَع في سطر واحد لكل (حساب بعد الطيّ، جانب، مركز
 * تكلفة، قسم، فرع) بلا وصف ولا موظف.
 * الأبعاد تبقى جزءاً من المفتاح حتى تبقى تقارير مراكز التكلفة والأقسام مطابقة.
 */
export function collapseHrLines<L extends LineLike>(lines: L[], fold: PersonalFold): L[] {
  const numeric = lines.length > 0 && typeof lines[0].debit === "number";
  const out: L[] = [];
  const byKey = new Map<string, L>();
  for (const line of lines) {
    const group = fold.get(line.accountId);
    // سطر السلفة يبقى باسم صاحبها؛ وسطر بلا موظف ولا حساب شخص (إجماليات الرواتب الجديدة) لا شيء فيه يُطوى
    if (line.employeeAdvanceId || (!line.employeeId && !group)) {
      out.push(line);
      continue;
    }
    const accountId = group?.id ?? line.accountId;
    const side = toDecimal(line.debit).gt(0) ? "d" : "c";
    const key = [accountId, side, line.costCenterId, line.departmentId, line.department, line.branchId].join("|");
    const existing = byKey.get(key);
    if (existing) {
      existing.debit = toDecimal(existing.debit).plus(toDecimal(line.debit));
      existing.credit = toDecimal(existing.credit).plus(toDecimal(line.credit));
      continue;
    }
    const collapsed = {
      ...line,
      accountId,
      ...(line.account !== undefined && group ? { account: group } : {}),
      description: null,
      employeeId: null,
      debit: toDecimal(line.debit),
      credit: toDecimal(line.credit),
    } as L;
    byKey.set(key, collapsed);
    out.push(collapsed);
  }
  // الأرقام تعود بنوع السطر الأصلي: Decimal من Prisma، أو رقم في صفوف التقارير
  if (numeric) for (const l of out) Object.assign(l, { debit: Number(l.debit), credit: Number(l.credit) });
  return out;
}
