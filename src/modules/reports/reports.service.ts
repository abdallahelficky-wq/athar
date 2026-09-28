import { prisma } from "../../lib/prisma";
import type { Account, Prisma } from "@prisma/client";
import { notFound } from "../../lib/httpError";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { Lang } from "../../lib/i18n/translate";
import {
  rollupAccountValues,
  RollupOptions,
  buildAccountValueTree,
  pruneTree,
  truncateTreeDepth,
  findTreeNode,
  TreeNode,
} from "../../lib/reportRollup";
import { foldAccountList, foldValueMap, personalFoldFromAccounts, loadPersonalFold, assertNotPersonalAccount } from "../../lib/personalAccounts";
import { collapseHrLines, hrEntryKinds, redactHrMemo } from "../../lib/hrRedaction";
import { monthlyAgingShape, payablesAgingAsOf, receivablesAgingAsOf } from "../../lib/aging";
import { COUNTED_ENTRY_WHERE, UNCOUNTED_DRAFT_WHERE } from "../../lib/countedEntries";

export interface DateRange {
  companyId?: string;
  // فرع اختياري (تصنيف/عرض فقط على مستوى سطر القيد، انظر Branch بالمخطط) — لو حُدِّد، تقتصر كل
  // التقارير المبنية عبر aggregateAccountBalances (ميزان المراجعة، قائمة الدخل، المركز المالي) على
  // الأسطر المرتبطة بهذا الفرع فقط؛ بدونه (الافتراضي) تُجمَّع كل أسطر الشركة بصرف النظر عن الفرع.
  branchId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AccountBalance {
  account: Account;
  debit: number;
  credit: number;
}

/**
 * تجميع أرصدة الحسابات من أسطر القيود المحتسبة فقط (COUNTED_ENTRY_WHERE): المرحَّلة، والمحفوظة فقط في
 * شركة لم يُفعَّل فيها بعدُ مفتاح balancesPostedOnly. قرار المالك (2026-09-27) عكس القرار السابق الذي
 * كان يحتسب "المحفوظ" فور حفظه: فك ترحيل قيد يدوي لم يكن يغيّر أي رقم، فكانت صلاحية فك الترحيل ورقمها
 * السري بلا أثر. ما يبقى محفوظاً يُعرَض في كل شاشة أرصدة كسطر مستقل "قيود محفوظة غير محتسبة" (راجع
 * getDraftEntriesSummary). كل التقارير تُحسب من هذه الدالة ولا تُخزَّن أرقامها في مكان منفصل.
 */
export async function aggregateAccountBalances(tenantId: string, range: DateRange): Promise<Map<string, AccountBalance>> {
  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId: range.companyId || { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, AccountBalance>();
  accounts.forEach((a) => map.set(a.id, { account: a, debit: 0, credit: 0 }));

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      branchId: range.branchId || undefined,
      journalEntry: {
        AND: [COUNTED_ENTRY_WHERE],
        tenantId,
        companyId: range.companyId || undefined,
        date: {
          gte: range.dateFrom,
          lte: range.dateTo,
        },
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });

  for (const line of lines) {
    const entry = map.get(line.accountId);
    if (!entry) continue;
    entry.debit += Number(line.debit);
    entry.credit += Number(line.credit);
  }

  return map;
}

export interface ReportRollupParams {
  level?: number; // 1-4، الافتراضي 4 (بلا تجميع)
  accountId?: string | null; // تقييد بفرع/حساب معيّن من أي مستوى
  includeDetails?: boolean; // فقط مع accountId: true = كل حسابات الترحيل تحته، false = سطر مجمَّع واحد
  search?: string; // فلترة نصية إضافية بالاسم أو الكود، تُطبَّق بعد التجميع
}

interface Zeroed {
  debit: number;
  credit: number;
  [key: string]: number;
}
const ZERO_DC: Zeroed = { debit: 0, credit: 0 };

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("صيغة الشهر غير صحيحة");
  const [year, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, m - 1, 1));
  const to = new Date(Date.UTC(year, m, 1) - 1);
  const previousFrom = new Date(Date.UTC(year, m - 2, 1));
  const previousTo = new Date(from.getTime() - 1);
  return { from, to, previousFrom, previousTo };
}

/** التقرير الشهري يستعمل نفس rollupAccountValues التي تستعملها القوائم الرئيسية؛ التصنيف
 * يعتمد على فروع الشجرة الفعلية، ولا يجمع أسطر القيود بمنطق موازٍ. */
export async function getComprehensiveMonthlyReport(tenantId: string, companyId: string | undefined, month: string, lang: Lang = "ar") {
  const en = lang === "en";
  const { from, to, previousFrom, previousTo } = monthRange(month);
  const accounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  const [currentRaw, previousRaw, closingRaw, companies, receivableAging, payableAging, employeeAccounts] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, dateFrom: from, dateTo: to }),
    aggregateAccountBalances(tenantId, { companyId, dateFrom: previousFrom, dateTo: previousTo }),
    aggregateAccountBalances(tenantId, { companyId, dateTo: to }),
    prisma.company.findMany({ where: { tenantId, id: companyId || undefined } }),
    // الأعمار كما في نهاية الشهر: ما خُصِّص أو سُدِّد بعده لا يُنقِص ذمة ذلك الشهر (راجع lib/aging.ts)
    receivablesAgingAsOf(tenantId, companyId, to),
    payablesAgingAsOf(tenantId, companyId, to),
    prisma.employee.findMany({ where: { tenantId, companyId: companyId || undefined, accountId: { not: null } }, select: { accountId: true } }),
  ]);
  const values = (raw: Map<string, AccountBalance>) => new Map([...raw].map(([id, b]) => [id, { debit: b.debit, credit: b.credit }]));
  const rolled = (raw: Map<string, AccountBalance>) => rollupAccountValues(accounts, values(raw), ZERO_DC, { level: 4 });
  const cur = rolled(currentRaw), prev = rolled(previousRaw), closing = rolled(closingRaw);
  const natural = (r: { account: Account; value: Zeroed }) => r.account.type === "revenue" || r.account.type === "liability" || r.account.type === "equity" ? r.value.credit - r.value.debit : r.value.debit - r.value.credit;
  const sumType = (rows: typeof cur, type: string) => money(rows.filter(r => r.account.type === type).reduce((s, r) => s + natural(r), 0));
  const EXPENSE_CATEGORIES = en ? ["Cost of revenue", "Operating expenses", "Administrative expenses"] : ["تكلفة الإيرادات", "مصروفات تشغيلية", "مصروفات إدارية"];
  const classifyExpense = (name: string) => /تكلفة|مبيعات|إيرادات/.test(name) ? EXPENSE_CATEGORIES[0] : /إدار/.test(name) ? EXPENSE_CATEGORIES[2] : EXPENSE_CATEGORIES[1];
  const expenseDetails = cur.filter(r => r.account.type === "expense" && natural(r) !== 0).map(r => ({ accountId: r.account.id, name: r.account.name, value: money(natural(r)), category: classifyExpense(r.account.name) })).sort((a,b) => b.value-a.value);
  const expenseSummary = EXPENSE_CATEGORIES.map(category => ({ category, value: money(expenseDetails.filter(x => x.category === category).reduce((s,x)=>s+x.value,0)) }));
  const revenue = sumType(cur, "revenue"), expense = sumType(cur, "expense");
  const previousRevenue = sumType(prev, "revenue"), previousExpense = sumType(prev, "expense");
  const cashRows = closing.filter(r => r.account.isBankOrCash).map(r => ({ accountId: r.account.id, name: r.account.name, balance: money(natural(r)) }));
  const cashIds = new Set(accounts.filter(a => a.isBankOrCash).map(a => a.id));
  const cashFlow = (rows: typeof cur) => rows.filter(r => cashIds.has(r.account.id)).reduce((a,r) => ({ receipts: a.receipts+r.value.debit, payments: a.payments+r.value.credit }), { receipts: 0, payments: 0 });
  const cf = cashFlow(cur), pcf = cashFlow(prev);
  const receivables = money(receivableAging.totals.total), payables = money(payableAging.totals.total);
  const liabilityRows = closing.filter(r => r.account.type === "liability" && /(قرض|قسط|ضريبة|قيمة مضافة|زكاة|مستحق)/.test(r.account.name)).map(r => ({ name:r.account.name, amount:money(natural(r)), dueDate:null }));
  const salaryAccounts = closing.filter(r => /(رواتب مستحقة|نهاية خدمة)/.test(r.account.name));
  // الرواتب المستحقة تقع في مكانين: حساب «رواتب مستحقة» (الترحيل بالإجماليات، ومن أي قيد يدوي)، والحسابات الفرعية
  // للموظفين (الترحيل القديم: صافي كل موظف على حسابه، وتسويات الإجازة). غير المدفوع = رصيد الأول + الأرصدة الدائنة
  // للحسابات الفرعية في نهاية الشهر (رصيد مدين لموظف ذمة عليه لا يُنقِص ما هو مستحق لغيره) — فتصحّ الأشهر القديمة أيضاً.
  // المصروف = ما سُدِّد خلال الشهر من هذه الحسابات نقداً أو بنكياً (راجع paysCash أدناه)، مطروحاً منه ما عُكِس من سداد.
  // الحسابات الفرعية للموظفين من شجرة الحسابات لا من صفوف الموظفين الحالية: حذف موظف يُبقي حسابه وقيوده، فلا يجوز
  // أن يختفي رصيده من أشهر مضت. المجموعات: «ذمم الموظفين» باسمها، وأي مجموعة تضم حساب موظف حالي.
  const employeeGroupIds = new Set([
    ...accounts.filter((a) => !a.isPosting && a.name === "ذمم الموظفين").map((a) => a.id),
    ...accounts.filter((a) => employeeAccounts.some((e) => e.accountId === a.id) && a.parentId).map((a) => a.parentId as string),
  ]);
  const employeeAccountIds = new Set(accounts.filter((a) => a.isPosting && a.parentId && employeeGroupIds.has(a.parentId)).map((a) => a.id));
  const payableIds = new Set(accounts.filter((a) => a.isPosting && /رواتب مستحقة/.test(a.name)).map((a) => a.id));
  const employeeOwed = [...employeeAccountIds].reduce((s, id) => {
    const b = closingRaw.get(id);
    return s + (b ? Math.max(b.credit - b.debit, 0) : 0);
  }, 0);
  const payableOwed = salaryAccounts.filter((r) => payableIds.has(r.account.id)).reduce((s, r) => s + natural(r), 0);
  const payrollAccountIds = [...payableIds, ...employeeAccountIds];
  const monthEntries = { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId: companyId || undefined, date: { gte: from, lte: to } };
  // السداد قيدٌ يُنقِص هذه الحسابات ويُخرِج نقداً أو من بنك في القيد نفسه — إعادة تصنيف بين حساب موظف و«رواتب مستحقة»
  // (أو أي تسوية بلا نقد) ليست صرفاً. عكس السداد (يُعيد النقد) يُطرَح بالقاعدة نفسها.
  // ⚠ حدّ معروف (docs/reports/comprehensive-monthly.md): صرف يمرّ بحساب وسيط في قيد منفصل — حماية الأجور (WPS) أو
  // «مدد»: «رواتب مستحقة» ← حساب وسيط، ثم الوسيط ← البنك — لا يُحتسَب مصروفاً، فيَنقص الرقم بلا أي إشارة. يصحّ اليوم
  // لأن الرواتب تُصرَف من البنك مباشرة. عند إضافة حساب وسيط للرواتب يجب توسيع paysCash ليعدّه (علامة على الحساب مثلاً).
  const paysCash = { lines: { some: { credit: { gt: 0 }, account: { isBankOrCash: true } } } };
  const receivesCash = { lines: { some: { debit: { gt: 0 }, account: { isBankOrCash: true } } } };
  const [payments, reversedPayments] = await Promise.all([
    prisma.journalEntryLine.aggregate({
      where: { accountId: { in: payrollAccountIds }, debit: { gt: 0 }, journalEntry: { ...monthEntries, ...paysCash, reversalOfEntryId: null, sourceModule: { not: "payroll" } } },
      _sum: { debit: true },
    }),
    prisma.journalEntryLine.aggregate({
      where: { accountId: { in: payrollAccountIds }, credit: { gt: 0 }, journalEntry: { ...monthEntries, ...receivesCash, reversalOfEntryId: { not: null } } },
      _sum: { credit: true },
    }),
  ]);
  const payroll = { paid: money(Number(payments._sum.debit || 0) - Number(reversedPayments._sum.credit || 0)), unpaid: money(payableOwed + employeeOwed), endOfService: money(salaryAccounts.filter(r=>/نهاية خدمة/.test(r.account.name)).reduce((s,r)=>s+natural(r),0)) };
  const pct = (now:number, old:number) => old === 0 ? null : money(((now-old)/Math.abs(old))*100);
  const comparisonLabels = en
    ? ["Revenue","Expenses","Net profit","Receipts","Payments","Net cash flow"]
    : ["الإيرادات","المصروفات","صافي الربح","المقبوضات","المدفوعات","صافي التدفق"];
  const comparison = [
    [comparisonLabels[0],revenue,previousRevenue], [comparisonLabels[1],expense,previousExpense], [comparisonLabels[2],revenue-expense,previousRevenue-previousExpense], [comparisonLabels[3],cf.receipts,pcf.receipts], [comparisonLabels[4],cf.payments,pcf.payments], [comparisonLabels[5],cf.receipts-cf.payments,pcf.receipts-pcf.payments],
  ].map(([label,current,previous]) => ({ label, current:money(current as number), previous:money(previous as number), difference:money((current as number)-(previous as number)), changePct:pct(current as number,previous as number) }));
  const settings = { expenseIncreasePct:Number(companies[0]?.expenseIncreaseThreshold ?? 15), minimumCash:Number(companies[0]?.lowCashThreshold ?? 0), maximumReceivables:Number(companies[0]?.receivablesThreshold ?? 0) };
  const notes:string[]=[]; expenseDetails.forEach(e => { const old=prev.find(r=>r.account.id===e.accountId); const change=pct(e.value,old?natural(old):0); if(change!=null && change>=settings.expenseIncreasePct) notes.push(en ? `Expense ${e.name} increased by ${change}% from the previous month.` : `مصروف ${e.name} زاد بنسبة ${change}% عن الشهر السابق.`); });
  if (pct(revenue-expense, previousRevenue-previousExpense)! < 0 && revenue>previousRevenue) notes.push(en ? "Net profit declined despite increased revenue — expenses are worth reviewing." : "صافي الربح انخفض رغم زيادة الإيرادات — يستحق مراجعة المصروفات.");
  const totalCash=money(cashRows.reduce((s,x)=>s+x.balance,0)); if(settings.maximumReceivables>0&&receivables>settings.maximumReceivables) notes.push(en ? `Receivables exceeded the set limit (${settings.maximumReceivables}).` : `الذمم المدينة تجاوزت الحد المحدد (${settings.maximumReceivables}).`); if(totalCash<settings.minimumCash) notes.push(en ? `Cash balance is below the set minimum (${settings.minimumCash}).` : `رصيد النقدية أقل من الحد الأدنى المحدد (${settings.minimumCash}).`);
  return { month, scope:companyId?"company":"group", revenue, expense, netProfit:money(revenue-expense), netProfitChangePct:pct(revenue-expense,previousRevenue-previousExpense), expenseSummary, expenseDetails:expenseDetails.slice(0,10), cashFlow:{ receipts:money(cf.receipts),payments:money(cf.payments),net:money(cf.receipts-cf.payments) }, cashAccounts:cashRows, totalCash, payroll, receivables:{ total:receivables,aging:monthlyAgingShape(receivableAging) }, payables:{ total:payables,aging:monthlyAgingShape(payableAging) }, liabilities:liabilityRows, comparison, settings, generatedNotes:notes };
}

export async function updateMonthlyReportSettings(tenantId:string, companyId:string, input:any) {
  return prisma.company.update({ where:{ id:companyId, tenantId }, data:{ expenseIncreaseThreshold:Number(input.expenseIncreasePct), lowCashThreshold:Number(input.minimumCash), receivablesThreshold:Number(input.maximumReceivables) }, select:{ expenseIncreaseThreshold:true,lowCashThreshold:true,receivablesThreshold:true } });
}

function searchFilter<T extends { name: string; code: string }>(rows: T[], search?: string): T[] {
  if (!search?.trim()) return rows;
  const q = search.trim().toLowerCase();
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.includes(q));
}

/**
 * ميزان مراجعة محاسبي كامل: لكل حساب — رصيد افتتاحي (تراكم كل الحركة قبل "من تاريخ")، حركة الفترة
 * (إجمالي مدين/دائن خام غير مصفّى)، ورصيد ختامي (افتتاحي + حركة الفترة)، معروضة بصيغة "مدين أو
 * دائن" (net موجب = مدين، سالب = دائن) وليس بحسب الجانب الطبيعي لنوع الحساب — هذا هو التعريف
 * القياسي لميزان المراجعة (يُتيح تحقّق التوازن: إجمالي المدين = إجمالي الدائن عند كل عمود).
 * "رصيد افتتاحي عند أي تاريخ" لا يحتاج أي بنية بيانات إضافية أو "سنة مالية" مقفلة: النظام لا يملك
 * مفهوم إقفال سنوي بعد، فرصيد أي حساب عند أي لحظة هو ببساطة تراكم كل قيد سابق لها — بالضبط ما
 * تحسبه aggregateAccountBalances أصلاً بإعطائها dateTo فقط بلا dateFrom.
 */
export async function getTrialBalanceReport(
  tenantId: string,
  companyId: string | undefined,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  rollup: ReportRollupParams,
  branchId?: string,
  hrView = true,
) {
  const allAccounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  const openingDateTo = dateFrom ? new Date(dateFrom.getTime() - 1) : undefined;

  const [openingBalances, periodBalances] = await Promise.all([
    dateFrom ? aggregateAccountBalances(tenantId, { companyId, branchId, dateTo: openingDateTo }) : null,
    aggregateAccountBalances(tenantId, { companyId, branchId, dateFrom, dateTo }),
  ]);

  let opening = new Map<string, Zeroed>();
  let period = new Map<string, Zeroed>();
  const accounts = allAccounts;
  for (const account of accounts) {
    if (!account.isPosting) continue;
    const o = openingBalances?.get(account.id);
    opening.set(account.id, { debit: o?.debit || 0, credit: o?.credit || 0 });
    const p = periodBalances.get(account.id);
    period.set(account.id, { debit: p?.debit || 0, credit: p?.credit || 0 });
  }

  // غير أدوار الموارد البشرية: مجموعات حسابات الأشخاص رصيد واحد (راجع personalAccounts.ts)
  const fold = hrView ? new Map() : personalFoldFromAccounts(allAccounts);
  const reportAccounts = foldAccountList(accounts, fold);
  opening = foldValueMap(opening, fold);
  period = foldValueMap(period, fold);

  const rollupOptions: RollupOptions = { level: rollup.level, accountId: rollup.accountId, includeDetails: rollup.includeDetails };
  const openingRolled = rollupAccountValues(reportAccounts, opening, ZERO_DC, rollupOptions);
  const periodRolled = rollupAccountValues(reportAccounts, period, ZERO_DC, rollupOptions);
  const periodByAccountId = new Map(periodRolled.map((r) => [r.account.id, r.value]));

  const netSplit = (net: number) => ({ debit: Math.max(net, 0), credit: Math.max(-net, 0) });

  let rows = openingRolled.map(({ account, value: o }) => {
    const p = periodByAccountId.get(account.id) || ZERO_DC;
    const openingNet = o.debit - o.credit;
    const closingNet = openingNet + p.debit - p.credit;
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      nameEn: account.nameEn,
      level: account.level,
      opening: netSplit(openingNet),
      period: { debit: p.debit, credit: p.credit },
      closing: netSplit(closingNet),
    };
  });

  // حسابات لها حركة خلال الفترة لكن بلا رصيد افتتاحي (لم تكن موجودة أصلاً قبل "من تاريخ")
  const coveredIds = new Set(rows.map((r) => r.accountId));
  for (const { account, value: p } of periodRolled) {
    if (coveredIds.has(account.id)) continue;
    const closingNet = p.debit - p.credit;
    rows.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      nameEn: account.nameEn,
      level: account.level,
      opening: { debit: 0, credit: 0 },
      period: { debit: p.debit, credit: p.credit },
      closing: netSplit(closingNet),
    });
  }

  rows = searchFilter(rows, rollup.search).sort((a, b) => a.code.localeCompare(b.code));

  const totals = rows.reduce(
    (acc, r) => ({
      openingDebit: acc.openingDebit + r.opening.debit,
      openingCredit: acc.openingCredit + r.opening.credit,
      periodDebit: acc.periodDebit + r.period.debit,
      periodCredit: acc.periodCredit + r.period.credit,
      closingDebit: acc.closingDebit + r.closing.debit,
      closingCredit: acc.closingCredit + r.closing.credit,
    }),
    { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 },
  );

  return {
    rows,
    totals,
    balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01,
  };
}

interface RawFlow extends Record<string, number> {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
}
const ZERO_FLOW: RawFlow = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0 };

export interface TrialBalanceTreeNode {
  accountId: string;
  code: string;
  name: string;
  nameEn: string | null;
  level: number;
  isPosting: boolean;
  opening: Zeroed;
  period: Zeroed;
  closing: Zeroed;
  children: TrialBalanceTreeNode[];
}

function finalizeTreeNode(node: TreeNode<RawFlow>): TrialBalanceTreeNode {
  const openingNet = node.value.openingDebit - node.value.openingCredit;
  const closingNet = openingNet + node.value.periodDebit - node.value.periodCredit;
  const split = (net: number) => ({ debit: Math.max(net, 0), credit: Math.max(-net, 0) });
  return {
    accountId: node.account.id,
    code: node.account.code,
    name: node.account.name,
    nameEn: node.account.nameEn,
    level: node.account.level,
    isPosting: node.account.isPosting,
    opening: split(openingNet),
    period: { debit: node.value.periodDebit, credit: node.value.periodCredit },
    closing: split(closingNet),
    children: node.children.map(finalizeTreeNode),
  };
}

/**
 * ميزان مراجعة هرمي (Tree View): نفس شكل شجرة الحسابات — كل حساب أب (مستوى 1-3) صف إجمالي
 * تلقائي لكل ما تحته، وصولاً لحسابات الترحيل الفعلية (المستوى الرابع) في الأوراق. تُبنى الشجرة
 * مرة واحدة فقط من قيم حسابات الترحيل (buildAccountValueTree يتصاعد بالجمع تلقائياً)، بدل تكرار
 * rollupAccountValues لكل مستوى على حدة — نفس منطق الرصيد الافتتاحي/حركة الفترة/الختامي المستخدَم
 * في getTrialBalanceReport أعلاه تماماً، فقط بشكل هرمي متداخل بدل صفوف مسطّحة بمستوى واحد مختار.
 *
 * hideZeroActivity/search يُشذّبان الشجرة عرضياً فقط (pruneTree) — لا يغيّران أي رقم إجمالي، لأن
 * قيمة كل عقدة أُصلاً محسوبة من كامل أحفادها بصرف النظر عمّا يظهر أو يُخفى.
 */
export async function getTrialBalanceTree(
  tenantId: string,
  companyId: string | undefined,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  options: { level?: number; hideZeroActivity?: boolean; search?: string },
  branchId?: string,
  hrView = true,
) {
  const level = options.level && options.level >= 1 && options.level <= 4 ? options.level : 4;
  const allAccounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  // غير أدوار الموارد البشرية: مجموعات حسابات الأشخاص رصيد واحد (راجع personalAccounts.ts)
  const fold = hrView ? new Map() : personalFoldFromAccounts(allAccounts);
  const accounts = foldAccountList(allAccounts, fold);
  const openingDateTo = dateFrom ? new Date(dateFrom.getTime() - 1) : undefined;

  const [openingBalances, periodBalances] = await Promise.all([
    dateFrom ? aggregateAccountBalances(tenantId, { companyId, branchId, dateTo: openingDateTo }) : null,
    aggregateAccountBalances(tenantId, { companyId, branchId, dateFrom, dateTo }),
  ]);

  // إجماليات الصف الأخير تُجمَع من صافي كل حساب ترحيل على حدة (مدين صافيه موجب يُضاف لعمود
  // المدين، دائن صافيه سالب يُضاف لعمود الدائن) — وليس من صافي مجموع كل الأرصدة الخام، لأن ذلك
  // الأخير يُصفّر نفسه دائماً (كل قيد متوازن أصلاً)، بينما ميزان المراجعة يعرض تحديداً مجموع
  // الأرصدة المدينة الصافية مقابل مجموع الأرصدة الدائنة الصافية لكل حساب — رقمان مختلفان يتساويان
  // فقط لأن النظام متوازن ككل، لا لأنهما نفس الجمع الخام. تبقى الإجماليات ثابتة بصرف النظر عن
  // التشذيب/الطي المعروض حالياً (بحث أو إخفاء المعدوم)، تماماً كما في getTrialBalanceReport.
  const rawValues = new Map<string, RawFlow>();
  for (const account of allAccounts) {
    if (!account.isPosting) continue;
    const o = openingBalances?.get(account.id);
    const p = periodBalances.get(account.id);
    rawValues.set(account.id, {
      openingDebit: o?.debit || 0,
      openingCredit: o?.credit || 0,
      periodDebit: p?.debit || 0,
      periodCredit: p?.credit || 0,
    });
  }
  const postingValues = foldValueMap(rawValues, fold);
  const totals = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
  for (const flow of postingValues.values()) {
    const openingNet = flow.openingDebit - flow.openingCredit;
    const closingNet = openingNet + flow.periodDebit - flow.periodCredit;
    totals.openingDebit += Math.max(openingNet, 0);
    totals.openingCredit += Math.max(-openingNet, 0);
    totals.periodDebit += flow.periodDebit;
    totals.periodCredit += flow.periodCredit;
    totals.closingDebit += Math.max(closingNet, 0);
    totals.closingCredit += Math.max(-closingNet, 0);
  }

  const rawTree = buildAccountValueTree(accounts, postingValues, ZERO_FLOW);
  // القص أولاً ثم التشذيب: بعد القص عند "level" تصبح أي عقدة عند هذا المستوى "ورقة" ظاهرياً
  // (بلا أبناء)، فيتعامل معها التشذيب (بحث/إخفاء المعدوم) على أساس قيمتها الإجمالية الخاصة —
  // بالضبط السلوك المطلوب: "تختفي أي مجموعة عند المستوى المختار ما لهاش حركة تحتها".
  const truncatedTree = truncateTreeDepth(rawTree, level);
  const prunedTree = pruneTree(truncatedTree, {
    hideZeroActivity: options.hideZeroActivity,
    search: options.search,
    hasActivity: (v) => Math.abs(v.openingDebit - v.openingCredit) > 0.005 || v.periodDebit > 0.005 || v.periodCredit > 0.005,
  });
  const roots = prunedTree.map(finalizeTreeNode);

  return {
    roots,
    totals,
    balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01,
  };
}

async function computeIncomeStatement(tenantId: string, companyId: string | undefined, dateFrom?: Date, dateTo?: Date, branchId?: string) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, branchId, dateFrom, dateTo });

  const revenueRows = [...balances.values()]
    .filter((b) => b.account.type === "revenue")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.credit - b.debit }));

  const expenseRows = [...balances.values()]
    .filter((b) => b.account.type === "expense")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.debit - b.credit }));

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalRevenue - totalExpense;

  return { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome };
}

interface AmountValue extends Record<string, number> {
  amount: number;
}

export interface AmountTreeNode {
  accountId: string;
  code: string;
  name: string;
  nameEn: string | null;
  level: number;
  isPosting: boolean;
  amount: number;
  children: AmountTreeNode[];
}

function finalizeAmountNode(node: TreeNode<AmountValue>): AmountTreeNode {
  return {
    accountId: node.account.id,
    code: node.account.code,
    name: node.account.name,
    nameEn: node.account.nameEn,
    level: node.account.level,
    isPosting: node.account.isPosting,
    amount: node.value.amount,
    children: node.children.map(finalizeAmountNode),
  };
}

/**
 * يبني شجرة عرض لجانب واحد (إيراد/مصروف أو أصل/التزام/حقوق) حسب "المستوى" كحدّ أقصى لعمق العرض
 * (نفس تعريف truncateTreeDepth المستخدَم في ميزان المراجعة تماماً — وليس عزل مستوى واحد بمفرده)،
 * أو حسب فرع/حساب معيّن مع تبديل تفاصيل/بدون تفاصيل. بلا أي فلتر (rollup فارغ) تُعيد الشجرة كاملة
 * حتى المستوى الرابع، أي بالضبط الحسابات الفردية كما كانت تُعرَض قبل إضافة هذا المنطق.
 */
function buildFilteredSectionTree(
  accounts: Account[],
  values: Map<string, AmountValue>,
  types: Account["type"][],
  rollup: ReportRollupParams,
): AmountTreeNode[] {
  const fullTree = buildAccountValueTree(accounts, values, { amount: 0 });
  const sectionRoots = fullTree.filter((root) => types.includes(root.account.type));

  if (rollup.accountId) {
    const target = findTreeNode(sectionRoots, rollup.accountId);
    if (!target) return [];
    const level = rollup.includeDetails ? 4 : target.account.level;
    const truncated = truncateTreeDepth([target], level);
    return pruneTree(truncated, { search: rollup.search }).map(finalizeAmountNode);
  }

  const level = rollup.level && rollup.level >= 1 && rollup.level <= 4 ? rollup.level : 4;
  const truncated = truncateTreeDepth(sectionRoots, level);
  return pruneTree(truncated, { search: rollup.search }).map(finalizeAmountNode);
}

export async function getIncomeStatement(
  tenantId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
  rollup: ReportRollupParams = {},
  branchId?: string,
  hrView = true,
) {
  const [balances, allAccounts] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, branchId, dateFrom, dateTo }),
    prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } }),
  ]);
  const fold = hrView ? new Map() : personalFoldFromAccounts(allAccounts);
  const accounts = foldAccountList(allAccounts, fold);

  // الإجماليات تُحسب مباشرة من كل الأرصدة دائماً (لا من الشجرة المعروضة) — تبقى صحيحة بصرف النظر
  // عن المستوى/الفرع/البحث المختار للعرض، تماماً كإجمالي ميزان المراجعة العام.
  const revenueValues = new Map<string, AmountValue>();
  const expenseValues = new Map<string, AmountValue>();
  let totalRevenue = 0;
  let totalExpense = 0;
  for (const b of balances.values()) {
    if (!b.account.isPosting) continue;
    if (b.account.type === "revenue") {
      const amount = b.credit - b.debit;
      revenueValues.set(b.account.id, { amount });
      totalRevenue += amount;
    }
    if (b.account.type === "expense") {
      const amount = b.debit - b.credit;
      expenseValues.set(b.account.id, { amount });
      totalExpense += amount;
    }
  }
  const netIncome = totalRevenue - totalExpense;

  const revenueRoots = buildFilteredSectionTree(accounts, foldValueMap(revenueValues, fold), ["revenue"], rollup);
  const expenseRoots = buildFilteredSectionTree(accounts, foldValueMap(expenseValues, fold), ["expense"], rollup);

  return { revenueRoots, expenseRoots, totalRevenue, totalExpense, netIncome };
}

export async function getBalanceSheet(
  tenantId: string,
  companyId?: string,
  asOfDate?: Date,
  rollup: ReportRollupParams = {},
  branchId?: string,
  hrView = true,
) {
  const [balances, allAccounts] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, branchId, dateTo: asOfDate }),
    prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } }),
  ]);
  // غير أدوار الموارد البشرية: مجموعات حسابات الأشخاص رصيد واحد (راجع personalAccounts.ts)
  const fold = hrView ? new Map() : personalFoldFromAccounts(allAccounts);
  const accounts = foldAccountList(allAccounts, fold);

  // صافي الربح التراكمي حتى تاريخ التقرير يُضاف لحقوق الملكية (أرباح مرحّلة) — رقم إجمالي على
  // مستوى الشركة كاملة دائماً، بصرف النظر عن أي فلتر عرض على صفوف الأصول/الالتزامات/حقوق الملكية،
  // لأنه ليس صفاً معروضاً بل مكوّن حسابي لبند "حقوق الملكية" الإجمالي. لو حُدِّد فرع، يتبعه صافي
  // الربح هنا أيضاً (نفس الفرع) حتى يبقى المركز المالي متوازناً فعلياً عند الفلترة بفرع.
  const { netIncome } = await computeIncomeStatement(tenantId, companyId, undefined, asOfDate, branchId);

  const assetValues = new Map<string, AmountValue>();
  const liabilityValues = new Map<string, AmountValue>();
  const equityValues = new Map<string, AmountValue>();
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquityBase = 0;
  for (const b of balances.values()) {
    if (!b.account.isPosting) continue;
    if (b.account.type === "asset") {
      const amount = b.debit - b.credit;
      assetValues.set(b.account.id, { amount });
      totalAssets += amount;
    }
    if (b.account.type === "liability") {
      const amount = b.credit - b.debit;
      liabilityValues.set(b.account.id, { amount });
      totalLiabilities += amount;
    }
    if (b.account.type === "equity") {
      const amount = b.credit - b.debit;
      equityValues.set(b.account.id, { amount });
      totalEquityBase += amount;
    }
  }
  const totalEquity = totalEquityBase + netIncome;

  const assetRoots = buildFilteredSectionTree(accounts, foldValueMap(assetValues, fold), ["asset"], rollup);
  const liabilityRoots = buildFilteredSectionTree(accounts, foldValueMap(liabilityValues, fold), ["liability"], rollup);
  const equityRoots = buildFilteredSectionTree(accounts, foldValueMap(equityValues, fold), ["equity"], rollup);

  return {
    assetRoots,
    liabilityRoots,
    equityRoots,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquityBase,
    totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
  };
}

/**
 * كشف حساب (سجل معاملات + رصيد متحرك) لعميل أو مورد — يقتصر على أسطر القيود المرحّلة
 * المرتبطة بحسابه التفصيلي المستقل تحديداً (Customer.accountId/Supplier.accountId، أو الحساب
 * المشترك القديم كشبكة أمان انتقالية ريثما يكتمل الـ backfill — انظر resolvePartyAccountId)،
 * تماماً كمنطق getCustomerBalance/getSupplierBalance في customers.controller.ts/suppliers.controller.ts.
 * إشارة الرصيد: للعميل نبدأ من صفر ونزيد (مدين - دائن) لأن حساب الذمم المدينة مدين الطبيعة
 * (رصيد موجب = العميل مدين لنا)؛ للمورد العكس (دائن - مدين، رصيد موجب = نحن مدينون له).
 */
async function buildPartyStatement(
  tenantId: string,
  accountId: string,
  companyId: string | undefined,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  sign: 1 | -1,
) {
  // رصيد افتتاحي = صافي كل الحركات من بداية عمر الحساب حتى يوم واحد قبل "من تاريخ" — بدونه، تطبيق
  // فلتر بداية يجعل الرصيد المتحرك (وبالتالي الختامي) يبدأ من صفر بدل الرصيد الحقيقي المتراكم،
  // فينقص كل رصيد لاحق بمقدار الرصيد الافتتاحي كاملاً (نفس منطق الرصيد الافتتاحي في
  // getTrialBalanceReport أعلاه، لكن لحساب واحد بدل كل الحسابات).
  let openingBalance = 0;
  if (dateFrom) {
    const openingDateTo = new Date(dateFrom.getTime() - 1);
    const opening = await prisma.journalEntryLine.aggregate({
      where: { accountId, journalEntry: { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId: companyId || undefined, date: { lte: openingDateTo } } },
      _sum: { debit: true, credit: true },
    });
    const od = Number(opening._sum.debit || 0);
    const oc = Number(opening._sum.credit || 0);
    openingBalance = sign === 1 ? od - oc : oc - od;
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      accountId,
      journalEntry: {
        AND: [COUNTED_ENTRY_WHERE],
        tenantId,
        companyId: companyId || undefined,
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    include: { journalEntry: { include: { company: true } }, account: true },
    orderBy: { journalEntry: { date: "asc" } },
  });

  let balance = openingBalance;
  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    balance += sign === 1 ? debit - credit : credit - debit;
    return {
      date: l.journalEntry.date,
      memo: l.journalEntry.memo,
      accountName: l.account.name,
      journalEntryId: l.journalEntryId,
      debit,
      credit,
      balance,
    };
  });

  return { rows, openingBalance, closingBalance: balance };
}

export async function getCustomerStatement(
  tenantId: string,
  customerId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw notFound("العميل غير موجود");
  const accountId = await resolvePartyAccountId(tenantId, customer.companyId, customer, "ذمم مدينة");
  const statement = await buildPartyStatement(tenantId, accountId, companyId, dateFrom, dateTo, 1);
  // accountId: الحساب الذي بُني منه الكشف — تحتاجه الشاشة لسطر "قيود محفوظة" على نفس الحساب
  return { customer, accountId, ...statement };
}

function collectPostingDescendants(accounts: Account[], rootId: string): string[] {
  const byParent = new Map<string | null, Account[]>();
  accounts.forEach((a) => byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]));
  const root = accounts.find((a) => a.id === rootId);
  if (!root) return [];
  if (root.isPosting) return [root.id];
  const result: string[] = [];
  const walk = (parentId: string) => {
    for (const child of byParent.get(parentId) || []) {
      if (child.isPosting) result.push(child.id);
      else walk(child.id);
    }
  };
  walk(rootId);
  return result;
}

/**
 * كشف حساب الأستاذ لأي حساب من شجرة الحسابات (وليس فقط ذمم العملاء/الموردين كما في
 * buildPartyStatement أعلاه) — يجلب كل أسطر القيود المرحّلة على هذا الحساب تحديداً، ويحسب رصيداً
 * متحركاً حسب "الجانب الطبيعي" لنوع الحساب (الأصول والمصروفات مدينة الطبيعة، وبقية الأنواع دائنة
 * الطبيعة) — نفس اصطلاح الإشارة المستخدَم في aggregateAccountBalances/getTrialBalance أعلاه.
 * يُرجِع أيضاً وصف كل سطر (JournalEntryLine.description) بجانب بيان القيد العام، لأن هذا هو
 * بالضبط ما يحتاجه المستخدم عند مراجعة كشف حساب لفهم تفاصيل كل حركة دون فتح القيد الكامل.
 *
 * accountId قد يكون حساب ترحيل بعينه (كالسابق تماماً) أو حساباً تجميعياً (فرعاً كاملاً من أي
 * مستوى) — في الحالة الثانية يُجمَع كشف حركة كل حسابات الترحيل تحته في كشف واحد مرتّب زمنياً،
 * وكل سطر موسوم باسم/كود حساب الترحيل الفعلي الذي رُحِّل عليه، فيصبح بالإمكان استعراض "كل عملاء
 * الذمم المدينة" في كشف واحد بدل فتح كل عميل على حدة.
 */
export async function getAccountLedger(
  tenantId: string,
  accountId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
  filters?: { costCenterId?: string; departmentId?: string; branchId?: string },
  hrView = true,
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId: companyId || undefined },
  });
  if (!account) throw notFound("الحساب غير موجود");
  // غير أدوار الموارد البشرية: لا كشف لحساب شخص بعينه — كشف المجموعة فقط (راجع personalAccounts.ts)
  await assertNotPersonalAccount(hrView, tenantId, account.id);

  const normalSide: "debit" | "credit" = account.type === "asset" || account.type === "expense" ? "debit" : "credit";

  const scopedAccountIds = account.isPosting
    ? [account.id]
    : collectPostingDescendants(
        await prisma.account.findMany({ where: { tenantId, companyId: companyId || undefined } }),
        account.id,
      );

  // رصيد افتتاحي = صافي كل حركات الحساب (بنفس فلاتر مركز التكلفة/القسم/الفرع) من بداية عمر الحساب
  // حتى يوم واحد قبل "من تاريخ" — بدون هذا، فلترة الكشف بتاريخ بداية كانت تصفّر الرصيد المتحرك عند
  // أول سطر داخل الفترة بدل استئنافه من الرصيد الحقيقي المتراكم، فينقص كل رصيد لاحق (بما فيه
  // الختامي) بمقدار الرصيد الافتتاحي كاملاً — تماماً كما رُصِد فعلياً على حساب حقيقي (فرق 1,711,305
  // بين كشف الفترة الكاملة وكشف "2026 فقط" يطابق رصيد الحساب المتراكم حتى نهاية 2025 بالضبط).
  let openingBalance = 0;
  if (dateFrom) {
    const openingDateTo = new Date(dateFrom.getTime() - 1);
    const opening = await prisma.journalEntryLine.aggregate({
      where: {
        accountId: { in: scopedAccountIds },
        costCenterId: filters?.costCenterId || undefined,
        departmentId: filters?.departmentId || undefined,
        branchId: filters?.branchId || undefined,
        journalEntry: { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId: companyId || undefined, date: { lte: openingDateTo } },
      },
      _sum: { debit: true, credit: true },
    });
    const od = Number(opening._sum.debit || 0);
    const oc = Number(opening._sum.credit || 0);
    openingBalance = normalSide === "debit" ? od - oc : oc - od;
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      accountId: { in: scopedAccountIds },
      costCenterId: filters?.costCenterId || undefined,
      departmentId: filters?.departmentId || undefined,
      branchId: filters?.branchId || undefined,
      journalEntry: {
        AND: [COUNTED_ENTRY_WHERE],
        tenantId,
        companyId: companyId || undefined,
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    include: { journalEntry: { include: { company: true } }, costCenter: true, departmentRef: true, branch: true, account: true },
    orderBy: { journalEntry: { date: "asc" } },
  });

  let visibleLines = lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }));
  const memoOf = new Map(lines.map((l) => [l.journalEntryId, l.journalEntry.memo]));
  if (!hrView) {
    // غير أدوار الموارد البشرية: حسابات الأشخاص تُنسَب لمجموعتها، وقيود الرواتب والتسويات (وعكسها) تُطوى
    // لسطر لكل حساب في القيد بلا وصف ولا اسم — راجع hrRedaction.ts. الرصيد المتحرك يُحسَب بعد الطيّ.
    const [fold, kinds] = await Promise.all([
      loadPersonalFold(tenantId, companyId),
      hrEntryKinds(tenantId, [...new Map(lines.map((l) => [l.journalEntryId, l.journalEntry])).values()]),
    ]);
    const byEntry = new Map<string, typeof visibleLines>();
    for (const l of visibleLines) byEntry.set(l.journalEntryId, [...(byEntry.get(l.journalEntryId) || []), l]);
    visibleLines = [...byEntry.entries()].flatMap(([entryId, entryLines]) => {
      const kind = kinds.get(entryId);
      if (kind) memoOf.set(entryId, redactHrMemo(kind, memoOf.get(entryId) ?? null));
      const folded = kind ? collapseHrLines(entryLines, fold) : entryLines;
      return folded.map((l) => {
        const group = fold.get(l.accountId);
        return group ? { ...l, accountId: group.id, account: group } : l;
      });
    });
  }

  let balance = openingBalance;
  const rows = visibleLines.map((l) => {
    const { debit, credit } = l;
    balance += normalSide === "debit" ? debit - credit : credit - debit;
    return {
      date: l.journalEntry.date,
      journalEntryId: l.journalEntryId,
      entryNumber: l.journalEntry.entryNumber,
      entryMemo: memoOf.get(l.journalEntryId) ?? null,
      lineDescription: l.description,
      costCenterName: l.costCenter?.name || null,
      departmentName: l.departmentRef?.name || l.department || null,
      branchName: l.branch?.nameAr || null,
      companyName: l.journalEntry.company.shortName || l.journalEntry.company.name,
      accountId: l.accountId,
      accountName: l.account.name,
      accountCode: l.account.code,
      debit,
      credit,
      balance,
    };
  });

  return { account, normalSide, openingBalance, rows, closingBalance: balance };
}

export async function getSupplierStatement(
  tenantId: string,
  supplierId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
  if (!supplier) throw notFound("المورد غير موجود");
  const accountId = await resolvePartyAccountId(tenantId, supplier.companyId, supplier, "ذمم دائنة - موردين");
  const statement = await buildPartyStatement(tenantId, accountId, companyId, dateFrom, dateTo, -1);
  return { supplier, accountId, ...statement };
}

/**
 * سطر "قيود محفوظة" في شاشات الأرصدة: القيود المحفوظة (غير المرحّلة) في نفس نطاق الشاشة (الشركة، الفترة،
 * الفرع، والحساب لشاشة الأستاذ) مقسومة قسمين:
 * - uncounted: في شركات تحتسب أرصدتها المرحَّل فقط — لا تدخل الأرقام المعروضة؛
 * - counted: في شركات لم يُفعَّل فيها المفتاح بعد — تدخل الأرقام المعروضة رغم أنها غير مرحّلة.
 */
export async function getDraftEntriesSummary(
  tenantId: string,
  filters: { companyId?: string; branchId?: string; accountId?: string; dateFrom?: Date; dateTo?: Date },
) {
  // حساب تجميعي (شاشة الأستاذ تقبله): نفس نطاقه في الأرصدة — هو وكل حساباته الفرعية
  let accountIds: string[] | undefined;
  if (filters.accountId) {
    accountIds = [filters.accountId];
    let frontier = [filters.accountId];
    while (frontier.length) {
      const children = await prisma.account.findMany({ where: { tenantId, parentId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id);
      accountIds.push(...frontier);
    }
  }
  const lineWhere = (entryScope: Prisma.JournalEntryWhereInput): Prisma.JournalEntryLineWhereInput => ({
    accountId: accountIds ? { in: accountIds } : undefined,
    branchId: filters.branchId || undefined,
    journalEntry: {
      AND: [entryScope],
      tenantId,
      companyId: filters.companyId || undefined,
      date: { gte: filters.dateFrom, lte: filters.dateTo },
    },
  });
  const summarize = async (entryScope: Prisma.JournalEntryWhereInput) => {
    const [agg, entries] = await Promise.all([
      prisma.journalEntryLine.aggregate({ where: lineWhere(entryScope), _sum: { debit: true, credit: true } }),
      prisma.journalEntryLine.findMany({ where: lineWhere(entryScope), distinct: ["journalEntryId"], select: { journalEntryId: true } }),
    ]);
    return { entryCount: entries.length, debit: money(Number(agg._sum.debit ?? 0)), credit: money(Number(agg._sum.credit ?? 0)) };
  };
  const [uncounted, counted] = await Promise.all([
    summarize(UNCOUNTED_DRAFT_WHERE),
    summarize({ status: "saved", company: { balancesPostedOnly: false } }),
  ]);
  return { uncounted, counted };
}
