import { Prisma, type AccountType, type ZakatMethod, type ZakatTreatment } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { toHalalas } from "../../lib/money";
import { inferLiquidityFromName, resolveEffectiveClassification } from "../../lib/accountClassification";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { computeZakat, type ZakatInputs } from "./zakatEngine";

/**
 * الزكاة: الوعاء الزكوي من أرصدة الدفاتر (قيود مرحَّلة فقط — إقرار نظامي لا يُبنى على مسودات) حتى نهاية الفترة،
 * مصنَّفة بحسب zakatTreatment لكل حساب: من الحساب نفسه، أو موروثاً من أقرب أب مصنَّف من نفس النوع، أو افتراضياً
 * من النوع والسيولة (متداول/غير متداول). صافي ربح/خسارة الفترات غير المقفلة جزء من حقوق الملكية في آخر المدة.
 * المحرّك (zakatEngine.ts) دالة نقية؛ هنا جمع الأرصدة وحفظ الإقرار وترحيل قيده.
 */

export const TREATMENTS_BY_TYPE: Record<AccountType, ZakatTreatment[]> = {
  asset: ["deductible_non_current_asset", "non_deductible_non_current_asset", "deductible_current_asset", "current_asset", "excluded"],
  liability: ["non_current_liability", "current_liability", "equity", "excluded"],
  equity: ["equity", "excluded"],
  revenue: ["excluded"],
  expense: ["excluded"],
};

export interface ZakatAdjustment {
  label: string;
  amount: number;
}

export interface ZakatOptions {
  periodStart: string;
  periodEnd: string;
  hijriYear?: boolean;
  method?: ZakatMethod;
  zakatableOwnershipPct?: number;
  adjustments?: ZakatAdjustment[];
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const endOfDay = (d: Date) => new Date(d.getTime() + 86_400_000 - 1);

type Source = "own" | "inherited" | "default";

function defaultTreatment(type: AccountType, liquidity: "current" | "non_current" | null): ZakatTreatment {
  if (type === "equity") return "equity";
  if (type === "liability") return liquidity === "non_current" ? "non_current_liability" : "current_liability";
  if (type === "asset") return liquidity === "non_current" ? "deductible_non_current_asset" : "current_asset";
  return "excluded";
}

export async function computeCompanyZakat(tenantId: string, companyId: string, opts: ZakatOptions) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId },
    select: { id: true, name: true, zakatMethod: true, zakatableOwnershipPct: true },
  });
  if (!company) throw notFound("الشركة غير موجودة");
  const start = day(opts.periodStart);
  const end = day(opts.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw badRequest("فترة الزكاة غير صالحة");
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId },
    select: { id: true, parentId: true, code: true, name: true, nameEn: true, type: true, liquidity: true, analysisRole: true, zakatTreatment: true, isPosting: true },
  });
  const effective = resolveEffectiveClassification(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const [toEnd, inPeriod] = await Promise.all([
    prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { journalEntry: { tenantId, companyId, status: "posted", date: { lte: endOfDay(end) } } },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { account: { type: { in: ["revenue", "expense"] } }, journalEntry: { tenantId, companyId, status: "posted", date: { gte: start, lte: endOfDay(end) } } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const treatmentOf = (id: string): { treatment: ZakatTreatment; source: Source; liquidityKnown: boolean } => {
    const account = byId.get(id)!;
    if (account.zakatTreatment && TREATMENTS_BY_TYPE[account.type].includes(account.zakatTreatment)) return { treatment: account.zakatTreatment, source: "own", liquidityKnown: true };
    let parent = account.parentId ? byId.get(account.parentId) : undefined;
    for (let depth = 0; parent && depth < 16; depth++) {
      if (parent.type === account.type && parent.zakatTreatment && TREATMENTS_BY_TYPE[account.type].includes(parent.zakatTreatment)) {
        return { treatment: parent.zakatTreatment, source: "inherited", liquidityKnown: true };
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    // السيولة: المخزَّنة (أو الموروثة) أولاً، وإلا من اسم الحساب أو أقرب أب من نفس النوع («الأصول الثابتة»، «قروض طويلة الأجل»…)
    let liquidity = effective.get(id)?.liquidity ?? null;
    for (let node: typeof account | undefined = account, depth = 0; !liquidity && node && depth < 16; depth++) {
      if (node.type === account.type) liquidity = inferLiquidityFromName(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    const needsLiquidity = account.type === "asset" || account.type === "liability";
    return { treatment: defaultTreatment(account.type, liquidity), source: "default", liquidityKnown: !needsLiquidity || liquidity !== null };
  };

  const sums = { equity: 0, nonCurrentLiabilities: 0, currentLiabilities: 0, deductibleNonCurrentAssets: 0, nonDeductibleNonCurrentAssets: 0, deductibleCurrentAssets: 0, nonDeductibleCurrentAssets: 0 };
  let cumulativeProfit = 0;
  const lines: {
    accountId: string; code: string; name: string; nameEn: string | null; type: AccountType;
    balance: number; treatment: ZakatTreatment; source: Source; needsReview: boolean;
  }[] = [];
  for (const row of toEnd) {
    const account = byId.get(row.accountId);
    if (!account) continue;
    const dr = toHalalas(Number(row._sum.debit ?? 0));
    const cr = toHalalas(Number(row._sum.credit ?? 0));
    if (account.type === "revenue" || account.type === "expense") {
      cumulativeProfit += cr - dr;
      continue;
    }
    const balance = account.type === "asset" ? dr - cr : cr - dr;
    if (balance === 0) continue;
    const { treatment, source, liquidityKnown } = treatmentOf(account.id);
    switch (treatment) {
      case "equity": sums.equity += balance; break;
      case "non_current_liability": sums.nonCurrentLiabilities += balance; break;
      case "current_liability": sums.currentLiabilities += balance; break;
      case "deductible_non_current_asset": sums.deductibleNonCurrentAssets += balance; break;
      case "non_deductible_non_current_asset": sums.nonDeductibleNonCurrentAssets += balance; break;
      case "deductible_current_asset": sums.deductibleCurrentAssets += balance; break;
      case "current_asset": sums.nonDeductibleCurrentAssets += balance; break;
      default: break;
    }
    lines.push({ accountId: account.id, code: account.code, name: account.name, nameEn: account.nameEn, type: account.type, balance: balance / 100, treatment, source, needsReview: !liquidityKnown });
  }
  const bookNetProfit = inPeriod.reduce((s, r) => s + toHalalas(Number(r._sum.credit ?? 0)) - toHalalas(Number(r._sum.debit ?? 0)), 0);
  const adjustments = (opts.adjustments ?? []).filter((a) => a && a.label?.trim() && Number.isFinite(Number(a.amount)) && Number(a.amount) !== 0);
  const profitAdjustments = adjustments.reduce((s, a) => s + toHalalas(Number(a.amount)), 0);

  const method = opts.method ?? company.zakatMethod;
  const zakatableOwnershipPct = opts.zakatableOwnershipPct ?? Number(company.zakatableOwnershipPct);
  const inputs: ZakatInputs = {
    method,
    ...sums,
    equity: sums.equity + cumulativeProfit,
    bookNetProfit,
    profitAdjustments,
    periodDays,
    hijriYear: Boolean(opts.hijriYear),
    zakatableOwnershipPct,
  };
  const result = computeZakat(inputs);
  const riyal = (h: number) => h / 100;
  return {
    company: { id: company.id, name: company.name },
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    periodDays,
    hijriYear: Boolean(opts.hijriYear),
    method,
    zakatableOwnershipPct,
    adjustments: adjustments.map((a) => ({ label: a.label.trim(), amount: Number(a.amount) })),
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, typeof v === "number" && !["periodDays", "zakatableOwnershipPct"].includes(k) ? riyal(v) : v])),
    cumulativeProfit: riyal(cumulativeProfit),
    result: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, typeof v === "number" && k !== "ratePpm" ? riyal(v) : v])) as Record<string, number | boolean>,
    ratePercent: result.ratePpm / 10_000,
    accounts: lines.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
    reviewCount: lines.filter((l) => l.needsReview).length,
  };
}

export async function setAccountTreatment(tenantId: string, accountId: string, treatment: ZakatTreatment | null) {
  const account = await prisma.account.findFirst({ where: { id: accountId, tenantId }, select: { id: true, type: true, companyId: true } });
  if (!account) throw notFound("الحساب غير موجود");
  if (treatment && !TREATMENTS_BY_TYPE[account.type].includes(treatment)) throw badRequest("تصنيف الزكاة لا يناسب نوع الحساب");
  await prisma.account.update({ where: { id: accountId }, data: { zakatTreatment: treatment } });
  return { accountId, treatment };
}

export async function updateZakatSettings(tenantId: string, companyId: string, settings: { zakatMethod?: ZakatMethod; zakatableOwnershipPct?: number }) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  return prisma.company.update({
    where: { id: companyId },
    data: {
      ...(settings.zakatMethod ? { zakatMethod: settings.zakatMethod } : {}),
      ...(settings.zakatableOwnershipPct !== undefined ? { zakatableOwnershipPct: settings.zakatableOwnershipPct } : {}),
    },
    select: { id: true, zakatMethod: true, zakatableOwnershipPct: true },
  });
}

export async function listDeclarations(tenantId: string, companyId: string) {
  return prisma.zakatDeclaration.findMany({
    where: { tenantId, companyId },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    select: { id: true, periodStart: true, periodEnd: true, method: true, zakatDue: true, status: true, journalEntryId: true, createdAt: true, journalEntry: { select: { entryNumber: true } } },
  });
}

export async function saveDeclaration(tenantId: string, userId: string, companyId: string, opts: ZakatOptions) {
  const computed = await computeCompanyZakat(tenantId, companyId, opts);
  return prisma.zakatDeclaration.create({
    data: {
      tenantId,
      companyId,
      periodStart: day(opts.periodStart),
      periodEnd: day(opts.periodEnd),
      hijriYear: computed.hijriYear,
      method: computed.method,
      zakatableOwnershipPct: computed.zakatableOwnershipPct,
      adjustments: computed.adjustments as unknown as Prisma.InputJsonValue,
      result: computed as unknown as Prisma.InputJsonValue,
      zakatDue: Number(computed.result.zakatDue),
      createdById: userId,
    },
  });
}

export async function getDeclaration(tenantId: string, id: string) {
  const declaration = await prisma.zakatDeclaration.findFirst({
    where: { id, tenantId },
    include: { journalEntry: { select: { id: true, entryNumber: true, status: true } } },
  });
  if (!declaration) throw notFound("إقرار الزكاة غير موجود");
  return declaration;
}

export async function deleteDeclaration(tenantId: string, id: string) {
  const declaration = await getDeclaration(tenantId, id);
  if (declaration.journalEntryId) throw conflict("للإقرار قيد زكاة مرحَّل — احذف القيد أو اعكسه أولاً");
  await prisma.zakatDeclaration.delete({ where: { id } });
}

/** قيد الزكاة المستحقة: من ح/ مصروف الزكاة إلى ح/ مخصص (التزام) الزكاة، بتاريخ نهاية الفترة وبمبلغ الإقرار المحفوظ. */
export async function postDeclaration(tenantId: string, userId: string, id: string, input: { expenseAccountId: string; payableAccountId: string }) {
  const declaration = await getDeclaration(tenantId, id);
  if (declaration.journalEntryId) throw conflict("للإقرار قيد زكاة بالفعل");
  const amount = Number(declaration.zakatDue);
  if (!(amount > 0)) throw badRequest("لا زكاة مستحقة في هذا الإقرار");
  const [expense, payable] = await Promise.all([
    prisma.account.findFirst({ where: { id: input.expenseAccountId, tenantId, companyId: declaration.companyId }, select: { type: true } }),
    prisma.account.findFirst({ where: { id: input.payableAccountId, tenantId, companyId: declaration.companyId }, select: { type: true } }),
  ]);
  if (!expense || expense.type !== "expense") throw badRequest("اختر حساب مصروف للزكاة");
  if (!payable || payable.type !== "liability") throw badRequest("اختر حساب التزام لمخصص الزكاة");
  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: declaration.companyId,
      date: declaration.periodEnd,
      memo: `زكاة الفترة ${declaration.periodStart.toISOString().slice(0, 10)} — ${declaration.periodEnd.toISOString().slice(0, 10)}`,
      sourceModule: "manual",
      createdBy: userId,
      lines: [
        { accountId: input.expenseAccountId, debit: amount, credit: 0 },
        { accountId: input.payableAccountId, debit: 0, credit: amount },
      ],
    });
    return tx.zakatDeclaration.update({ where: { id }, data: { journalEntryId: entry.id, status: "posted" }, include: { journalEntry: { select: { id: true, entryNumber: true, status: true } } } });
  });
}
