import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { toHalalas } from "../../lib/money";

/**
 * الموازنات التقديرية: 12 شهراً من startMonth، مبلغ لكل حساب ترحيل في كل شهر (m01..m12)، واختيارياً لمركز تكلفة واحد.
 * تقرير الموازنة مقابل الفعلي من القيود المرحَّلة فقط في نفس الشركة (ومركز التكلفة إن وُجد): الإيراد دائن−مدين، وغيره
 * مدين−دائن، فيُقارَن المبلغ بإشارة الموازنة نفسها. الانحراف = الفعلي − الموازنة؛ «ملائم» للإيراد إن زاد، ولغيره إن نقص.
 */
export const MONTHS = 12;
const MONTH_KEYS = Array.from({ length: MONTHS }, (_, i) => `m${String(i + 1).padStart(2, "0")}`) as `m${string}`[];

export interface BudgetLineInput {
  accountId: string;
  months: number[];
}

export interface BudgetInput {
  companyId: string;
  name: string;
  startMonth: string; // YYYY-MM
  costCenterId?: string | null;
  notes?: string | null;
  lines: BudgetLineInput[];
}

const monthStart = (ym: string) => {
  const d = new Date(`${ym}-01T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw badRequest("شهر بداية الموازنة غير صالح");
  return d;
};
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const monthIndex = (start: Date, d: Date) => (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + (d.getUTCMonth() - start.getUTCMonth());

const budgetInclude = {
  costCenter: { select: { id: true, name: true } },
  lines: { include: { account: { select: { id: true, code: true, name: true, nameEn: true, type: true } } } },
};

async function validate(tenantId: string, input: BudgetInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  monthStart(input.startMonth);
  const ids = input.lines.map((l) => l.accountId);
  if (new Set(ids).size !== ids.length) throw badRequest("الحساب مكرر في الموازنة");
  for (const l of input.lines) {
    if (l.months.length !== MONTHS || l.months.some((v) => !Number.isFinite(Number(v)))) throw badRequest("كل سطر في الموازنة يحتاج 12 مبلغاً شهرياً");
  }
  if (ids.length) {
    const count = await prisma.account.count({ where: { id: { in: ids }, tenantId, companyId: input.companyId, isPosting: true } });
    if (count !== ids.length) throw badRequest("أحد حسابات الموازنة لا ينتمي إلى شجرة الشركة أو ليس حساب ترحيل");
  }
  if (input.costCenterId) {
    const cc = await prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId }, select: { id: true } });
    if (!cc) throw badRequest("مركز التكلفة غير موجود");
  }
}

function lineRows(tenantId: string, companyId: string, lines: BudgetLineInput[]) {
  return lines.map((l) => ({
    tenantId,
    companyId,
    accountId: l.accountId,
    ...Object.fromEntries(MONTH_KEYS.map((k, i) => [k, new Prisma.Decimal(Math.round(Number(l.months[i] || 0) * 100) / 100)])),
  }));
}

export async function listBudgets(tenantId: string, companyId: string) {
  return prisma.budget.findMany({
    where: { tenantId, companyId },
    orderBy: [{ startMonth: "desc" }, { createdAt: "desc" }],
    include: { costCenter: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
  });
}

export async function getBudget(tenantId: string, id: string) {
  const budget = await prisma.budget.findFirst({ where: { id, tenantId }, include: budgetInclude });
  if (!budget) throw notFound("الموازنة غير موجودة");
  return budget;
}

export async function createBudget(tenantId: string, userId: string, input: BudgetInput) {
  await validate(tenantId, input);
  const created = await prisma.budget.create({
    data: {
      tenantId,
      companyId: input.companyId,
      name: input.name.trim(),
      startMonth: monthStart(input.startMonth),
      costCenterId: input.costCenterId || null,
      notes: input.notes?.trim() || null,
      createdById: userId,
      lines: { create: lineRows(tenantId, input.companyId, input.lines) },
    },
  });
  return getBudget(tenantId, created.id);
}

export async function updateBudget(tenantId: string, id: string, input: BudgetInput) {
  const existing = await getBudget(tenantId, id);
  if (existing.companyId !== input.companyId) throw badRequest("لا يمكن نقل الموازنة لشركة أخرى");
  if (existing.status === "approved") throw badRequest("الموازنة معتمدة — أعدها مسودة أولاً لتعديلها");
  await validate(tenantId, input);
  await prisma.$transaction(async (tx) => {
    await tx.budgetLine.deleteMany({ where: { budgetId: id } });
    await tx.budget.update({
      where: { id },
      data: {
        name: input.name.trim(),
        startMonth: monthStart(input.startMonth),
        costCenterId: input.costCenterId || null,
        notes: input.notes?.trim() || null,
        lines: { create: lineRows(tenantId, existing.companyId, input.lines) },
      },
    });
  });
  return getBudget(tenantId, id);
}

export async function setBudgetStatus(tenantId: string, id: string, status: "draft" | "approved") {
  await getBudget(tenantId, id);
  await prisma.budget.update({ where: { id }, data: { status } });
  return getBudget(tenantId, id);
}

export async function deleteBudget(tenantId: string, id: string) {
  const existing = await getBudget(tenantId, id);
  if (existing.status === "approved") throw badRequest("الموازنة معتمدة — أعدها مسودة أولاً لحذفها");
  await prisma.budget.delete({ where: { id } });
}

/** الفعلي شهرياً لحسابات بعينها: Map<accountId, halalas[12]> بالإشارة الطبيعية لنوع الحساب */
async function monthlyActuals(tenantId: string, companyId: string, start: Date, accounts: { id: string; type: string }[], costCenterId: string | null) {
  const result = new Map<string, number[]>(accounts.map((a) => [a.id, Array(MONTHS).fill(0)]));
  if (!accounts.length) return result;
  const end = addMonths(start, MONTHS);
  const rows = await prisma.$queryRaw<{ accountId: string; month: Date; debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }[]>`
    SELECT l."accountId", date_trunc('month', e."date") AS month, SUM(l."debit") AS debit, SUM(l."credit") AS credit
    FROM "journal_entry_lines" l JOIN "journal_entries" e ON e."id" = l."journalEntryId"
    WHERE e."tenantId" = ${tenantId} AND e."companyId" = ${companyId} AND e."status" = 'posted'
      AND e."date" >= ${start} AND e."date" < ${end}
      AND l."accountId" IN (${Prisma.join(accounts.map((a) => a.id))})
      ${costCenterId ? Prisma.sql`AND l."costCenterId" = ${costCenterId}` : Prisma.empty}
    GROUP BY 1, 2
  `;
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  for (const r of rows) {
    const idx = monthIndex(start, new Date(r.month));
    if (idx < 0 || idx >= MONTHS) continue;
    const dr = toHalalas(Number(r.debit ?? 0));
    const cr = toHalalas(Number(r.credit ?? 0));
    result.get(r.accountId)![idx] += typeOf.get(r.accountId) === "revenue" ? cr - dr : dr - cr;
  }
  return result;
}

/** موازنة مقابل الفعلي حتى شهر معيّن (throughMonth 1..12؛ الافتراضي الشهر الحالي داخل الموازنة) */
export async function budgetVsActual(tenantId: string, id: string, throughMonth?: number) {
  const budget = await getBudget(tenantId, id);
  const start = budget.startMonth;
  const now = new Date();
  const current = Math.min(MONTHS, Math.max(0, monthIndex(start, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) + 1));
  const through = Math.min(MONTHS, Math.max(1, throughMonth ?? (current || MONTHS)));
  const actuals = await monthlyActuals(tenantId, budget.companyId, start, budget.lines.map((l) => ({ id: l.accountId, type: l.account.type })), budget.costCenterId);
  const money = (h: number) => h / 100;
  const lines = budget.lines
    .map((l) => {
      const plan = MONTH_KEYS.map((k) => toHalalas(Number((l as unknown as Record<string, Prisma.Decimal>)[k])));
      const actual = actuals.get(l.accountId)!;
      const planYtd = plan.slice(0, through).reduce((s, v) => s + v, 0);
      const actualYtd = actual.slice(0, through).reduce((s, v) => s + v, 0);
      const variance = actualYtd - planYtd;
      const favorable = l.account.type === "revenue" ? variance >= 0 : variance <= 0;
      return {
        accountId: l.accountId,
        code: l.account.code,
        name: l.account.name,
        nameEn: l.account.nameEn,
        type: l.account.type,
        plan: plan.map(money),
        actual: actual.map(money),
        planYtd: money(planYtd),
        actualYtd: money(actualYtd),
        variance: money(variance),
        variancePct: planYtd !== 0 ? Math.round((variance / Math.abs(planYtd)) * 1000) / 10 : null,
        favorable,
        planYear: money(plan.reduce((s, v) => s + v, 0)),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const sumBy = (type: string, key: "planYtd" | "actualYtd" | "planYear") => lines.filter((l) => l.type === type).reduce((s, l) => s + toHalalas(l[key]), 0) / 100;
  const totals = {
    revenue: { planYtd: sumBy("revenue", "planYtd"), actualYtd: sumBy("revenue", "actualYtd"), planYear: sumBy("revenue", "planYear") },
    expense: { planYtd: sumBy("expense", "planYtd"), actualYtd: sumBy("expense", "actualYtd"), planYear: sumBy("expense", "planYear") },
  };
  return {
    budget: { id: budget.id, name: budget.name, startMonth: budget.startMonth, status: budget.status, costCenter: budget.costCenter },
    months: Array.from({ length: MONTHS }, (_, i) => addMonths(start, i).toISOString().slice(0, 7)),
    through,
    lines,
    totals: {
      ...totals,
      netPlanYtd: Math.round((totals.revenue.planYtd - totals.expense.planYtd) * 100) / 100,
      netActualYtd: Math.round((totals.revenue.actualYtd - totals.expense.actualYtd) * 100) / 100,
    },
  };
}

/**
 * اقتراح أسطر موازنة من فعلي 12 شهراً تبدأ من sourceStartMonth لحسابات الإيرادات والمصروفات، مضروباً في (1 + نمو%) —
 * للتعبئة في الشاشة قبل الحفظ (لا يكتب شيئاً).
 */
export async function suggestFromActuals(tenantId: string, companyId: string, sourceStartMonth: string, growthPct: number, costCenterId: string | null) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId, isPosting: true, type: { in: ["revenue", "expense"] } },
    select: { id: true, type: true, code: true, name: true },
  });
  const actuals = await monthlyActuals(tenantId, companyId, monthStart(sourceStartMonth), accounts, costCenterId);
  const factor = 1 + (Number(growthPct) || 0) / 100;
  return accounts
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, type: a.type, months: actuals.get(a.id)!.map((h) => Math.round(h * factor) / 100) }))
    .filter((l) => l.months.some((v) => v !== 0))
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}
