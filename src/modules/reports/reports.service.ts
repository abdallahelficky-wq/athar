import { prisma } from "../../lib/prisma";
import type { Account } from "@prisma/client";
import { notFound } from "../../lib/httpError";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import {
  rollupAccountValues,
  RollupOptions,
  buildAccountValueTree,
  pruneTree,
  truncateTreeDepth,
  findTreeNode,
  TreeNode,
} from "../../lib/reportRollup";

export interface DateRange {
  companyId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AccountBalance {
  account: Account;
  debit: number;
  credit: number;
}

/**
 * تجميع أرصدة الحسابات من أسطر كل القيود — "محفوظة" (saved) أو "مرحّلة" (posted) معاً، بلا فلتر
 * status هنا عمداً: قرار صريح من المستخدم أن يؤثر القيد "المحفوظ" على كل التقارير المالية فور
 * حفظه (لا يقتصر التأثير على "مرحّل" فقط كما كان سابقاً)، طالما لا يوجد إطلاقاً في هذا النظام أي
 * حالة ثالثة "لا تؤثر" (مثل "مسودة" القديمة) — أي قيد موجود في الجدول يُحتسَب. مطابق أصلاً لمنطق
 * aggregateAccounts في AtharAlMuhasabi.jsx، مع إضافة تصفية بالتاريخ والشركة كما تتطلبها توقيعات
 * endpoints في القسم 5 من المستند. كل التقارير تُحسب من هذه الدالة فقط ولا تُخزَّن أرقامها في
 * مكان منفصل (مبدأ القسم 3).
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
      journalEntry: {
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
export async function getComprehensiveMonthlyReport(tenantId: string, companyId: string | undefined, month: string) {
  const { from, to, previousFrom, previousTo } = monthRange(month);
  const accounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  const [currentRaw, previousRaw, closingRaw, companies, receivableAging, payableAging, payrollRuns] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, dateFrom: from, dateTo: to }),
    aggregateAccountBalances(tenantId, { companyId, dateFrom: previousFrom, dateTo: previousTo }),
    aggregateAccountBalances(tenantId, { companyId, dateTo: to }),
    prisma.company.findMany({ where: { tenantId, id: companyId || undefined } }),
    prisma.salesInvoice.findMany({ where: { tenantId, companyId: companyId || undefined, status: "posted", date: { lte: to } }, include: { receiptAllocations: true } }),
    prisma.purchaseInvoice.findMany({ where: { tenantId, companyId: companyId || undefined, status: "posted", date: { lte: to } } }),
    prisma.payrollRun.findMany({ where: { tenantId, companyId: companyId || undefined, month } }),
  ]);
  const values = (raw: Map<string, AccountBalance>) => new Map([...raw].map(([id, b]) => [id, { debit: b.debit, credit: b.credit }]));
  const rolled = (raw: Map<string, AccountBalance>) => rollupAccountValues(accounts, values(raw), ZERO_DC, { level: 4 });
  const cur = rolled(currentRaw), prev = rolled(previousRaw), closing = rolled(closingRaw);
  const natural = (r: { account: Account; value: Zeroed }) => r.account.type === "revenue" || r.account.type === "liability" || r.account.type === "equity" ? r.value.credit - r.value.debit : r.value.debit - r.value.credit;
  const sumType = (rows: typeof cur, type: string) => money(rows.filter(r => r.account.type === type).reduce((s, r) => s + natural(r), 0));
  const classifyExpense = (name: string) => /تكلفة|مبيعات|إيرادات/.test(name) ? "تكلفة الإيرادات" : /إدار/.test(name) ? "مصروفات إدارية" : "مصروفات تشغيلية";
  const expenseDetails = cur.filter(r => r.account.type === "expense" && natural(r) !== 0).map(r => ({ accountId: r.account.id, name: r.account.name, value: money(natural(r)), category: classifyExpense(r.account.name) })).sort((a,b) => b.value-a.value);
  const expenseSummary = ["تكلفة الإيرادات", "مصروفات تشغيلية", "مصروفات إدارية"].map(category => ({ category, value: money(expenseDetails.filter(x => x.category === category).reduce((s,x)=>s+x.value,0)) }));
  const revenue = sumType(cur, "revenue"), expense = sumType(cur, "expense");
  const previousRevenue = sumType(prev, "revenue"), previousExpense = sumType(prev, "expense");
  const cashRows = closing.filter(r => r.account.isBankOrCash).map(r => ({ accountId: r.account.id, name: r.account.name, balance: money(natural(r)) }));
  const cashIds = new Set(accounts.filter(a => a.isBankOrCash).map(a => a.id));
  const cashFlow = (rows: typeof cur) => rows.filter(r => cashIds.has(r.account.id)).reduce((a,r) => ({ receipts: a.receipts+r.value.debit, payments: a.payments+r.value.credit }), { receipts: 0, payments: 0 });
  const cf = cashFlow(cur), pcf = cashFlow(prev);
  const aging = (docs: Array<{ date: Date; due: number }>) => docs.reduce((a,d) => { const days=Math.floor((to.getTime()-d.date.getTime())/86400000); const k=days<=30?"under30":days<=60?"d30to60":days<=90?"d60to90":"over90"; a[k]+=Math.max(d.due,0); return a; }, { under30:0,d30to60:0,d60to90:0,over90:0 });
  const arDocs = receivableAging.map(i => ({ date:i.date, due:Number(i.grandTotal)-i.receiptAllocations.reduce((s,a)=>s+Number(a.amount),0) }));
  const apDocs = payableAging.map(i => ({ date:i.date, due:Number(i.grandTotal) }));
  const receivables = money(arDocs.reduce((s,x)=>s+Math.max(x.due,0),0)), payables = money(apDocs.reduce((s,x)=>s+x.due,0));
  const liabilityRows = closing.filter(r => r.account.type === "liability" && /(قرض|قسط|ضريبة|قيمة مضافة|زكاة|مستحق)/.test(r.account.name)).map(r => ({ name:r.account.name, amount:money(natural(r)), dueDate:null }));
  const salaryAccounts = closing.filter(r => /(رواتب مستحقة|نهاية خدمة)/.test(r.account.name));
  const payroll = { paid: money(payrollRuns.filter(r=>r.status === "posted").reduce((s,r)=>s + Number((r.overrides as any)?.netTotal || 0),0)), unpaid: money(salaryAccounts.filter(r=>/رواتب/.test(r.account.name)).reduce((s,r)=>s+natural(r),0)), endOfService: money(salaryAccounts.filter(r=>/نهاية خدمة/.test(r.account.name)).reduce((s,r)=>s+natural(r),0)) };
  const pct = (now:number, old:number) => old === 0 ? null : money(((now-old)/Math.abs(old))*100);
  const comparison = [
    ["الإيرادات",revenue,previousRevenue], ["المصروفات",expense,previousExpense], ["صافي الربح",revenue-expense,previousRevenue-previousExpense], ["المقبوضات",cf.receipts,pcf.receipts], ["المدفوعات",cf.payments,pcf.payments], ["صافي التدفق",cf.receipts-cf.payments,pcf.receipts-pcf.payments],
  ].map(([label,current,previous]) => ({ label, current:money(current as number), previous:money(previous as number), difference:money((current as number)-(previous as number)), changePct:pct(current as number,previous as number) }));
  const settings = { expenseIncreasePct:Number(companies[0]?.expenseIncreaseThreshold ?? 15), minimumCash:Number(companies[0]?.lowCashThreshold ?? 0), maximumReceivables:Number(companies[0]?.receivablesThreshold ?? 0) };
  const notes:string[]=[]; expenseDetails.forEach(e => { const old=prev.find(r=>r.account.id===e.accountId); const change=pct(e.value,old?natural(old):0); if(change!=null && change>=settings.expenseIncreasePct) notes.push(`مصروف ${e.name} زاد بنسبة ${change}% عن الشهر السابق.`); });
  if (pct(revenue-expense, previousRevenue-previousExpense)! < 0 && revenue>previousRevenue) notes.push("صافي الربح انخفض رغم زيادة الإيرادات — يستحق مراجعة المصروفات.");
  const totalCash=money(cashRows.reduce((s,x)=>s+x.balance,0)); if(settings.maximumReceivables>0&&receivables>settings.maximumReceivables) notes.push(`الذمم المدينة تجاوزت الحد المحدد (${settings.maximumReceivables}).`); if(totalCash<settings.minimumCash) notes.push(`رصيد النقدية أقل من الحد الأدنى المحدد (${settings.minimumCash}).`);
  return { month, scope:companyId?"company":"group", revenue, expense, netProfit:money(revenue-expense), netProfitChangePct:pct(revenue-expense,previousRevenue-previousExpense), expenseSummary, expenseDetails:expenseDetails.slice(0,10), cashFlow:{ receipts:money(cf.receipts),payments:money(cf.payments),net:money(cf.receipts-cf.payments) }, cashAccounts:cashRows, totalCash, payroll, receivables:{ total:receivables,aging:aging(arDocs) }, payables:{ total:payables,aging:aging(apDocs) }, liabilities:liabilityRows, comparison, settings, generatedNotes:notes };
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
) {
  const accounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  const openingDateTo = dateFrom ? new Date(dateFrom.getTime() - 1) : undefined;

  const [openingBalances, periodBalances] = await Promise.all([
    dateFrom ? aggregateAccountBalances(tenantId, { companyId, dateTo: openingDateTo }) : null,
    aggregateAccountBalances(tenantId, { companyId, dateFrom, dateTo }),
  ]);

  const opening = new Map<string, Zeroed>();
  const period = new Map<string, Zeroed>();
  for (const account of accounts) {
    if (!account.isPosting) continue;
    const o = openingBalances?.get(account.id);
    opening.set(account.id, { debit: o?.debit || 0, credit: o?.credit || 0 });
    const p = periodBalances.get(account.id);
    period.set(account.id, { debit: p?.debit || 0, credit: p?.credit || 0 });
  }

  const rollupOptions: RollupOptions = { level: rollup.level, accountId: rollup.accountId, includeDetails: rollup.includeDetails };
  const openingRolled = rollupAccountValues(accounts, opening, ZERO_DC, rollupOptions);
  const periodRolled = rollupAccountValues(accounts, period, ZERO_DC, rollupOptions);
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
) {
  const level = options.level && options.level >= 1 && options.level <= 4 ? options.level : 4;
  const accounts = await prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } });
  const openingDateTo = dateFrom ? new Date(dateFrom.getTime() - 1) : undefined;

  const [openingBalances, periodBalances] = await Promise.all([
    dateFrom ? aggregateAccountBalances(tenantId, { companyId, dateTo: openingDateTo }) : null,
    aggregateAccountBalances(tenantId, { companyId, dateFrom, dateTo }),
  ]);

  // إجماليات الصف الأخير تُجمَع من صافي كل حساب ترحيل على حدة (مدين صافيه موجب يُضاف لعمود
  // المدين، دائن صافيه سالب يُضاف لعمود الدائن) — وليس من صافي مجموع كل الأرصدة الخام، لأن ذلك
  // الأخير يُصفّر نفسه دائماً (كل قيد متوازن أصلاً)، بينما ميزان المراجعة يعرض تحديداً مجموع
  // الأرصدة المدينة الصافية مقابل مجموع الأرصدة الدائنة الصافية لكل حساب — رقمان مختلفان يتساويان
  // فقط لأن النظام متوازن ككل، لا لأنهما نفس الجمع الخام. تبقى الإجماليات ثابتة بصرف النظر عن
  // التشذيب/الطي المعروض حالياً (بحث أو إخفاء المعدوم)، تماماً كما في getTrialBalanceReport.
  const postingValues = new Map<string, RawFlow>();
  const totals = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
  for (const account of accounts) {
    if (!account.isPosting) continue;
    const o = openingBalances?.get(account.id);
    const p = periodBalances.get(account.id);
    const flow: RawFlow = {
      openingDebit: o?.debit || 0,
      openingCredit: o?.credit || 0,
      periodDebit: p?.debit || 0,
      periodCredit: p?.credit || 0,
    };
    postingValues.set(account.id, flow);

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

async function computeIncomeStatement(tenantId: string, companyId: string | undefined, dateFrom?: Date, dateTo?: Date) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, dateFrom, dateTo });

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
) {
  const [balances, accounts] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, dateFrom, dateTo }),
    prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } }),
  ]);

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

  const revenueRoots = buildFilteredSectionTree(accounts, revenueValues, ["revenue"], rollup);
  const expenseRoots = buildFilteredSectionTree(accounts, expenseValues, ["expense"], rollup);

  return { revenueRoots, expenseRoots, totalRevenue, totalExpense, netIncome };
}

export async function getBalanceSheet(
  tenantId: string,
  companyId?: string,
  asOfDate?: Date,
  rollup: ReportRollupParams = {},
) {
  const [balances, accounts] = await Promise.all([
    aggregateAccountBalances(tenantId, { companyId, dateTo: asOfDate }),
    prisma.account.findMany({ where: { tenantId, companyId: companyId || { not: null } } }),
  ]);

  // صافي الربح التراكمي حتى تاريخ التقرير يُضاف لحقوق الملكية (أرباح مرحّلة) — رقم إجمالي على
  // مستوى الشركة كاملة دائماً، بصرف النظر عن أي فلتر عرض على صفوف الأصول/الالتزامات/حقوق الملكية،
  // لأنه ليس صفاً معروضاً بل مكوّن حسابي لبند "حقوق الملكية" الإجمالي.
  const { netIncome } = await computeIncomeStatement(tenantId, companyId, undefined, asOfDate);

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

  const assetRoots = buildFilteredSectionTree(accounts, assetValues, ["asset"], rollup);
  const liabilityRoots = buildFilteredSectionTree(accounts, liabilityValues, ["liability"], rollup);
  const equityRoots = buildFilteredSectionTree(accounts, equityValues, ["equity"], rollup);

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
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      accountId,
      journalEntry: {
        tenantId,
        companyId: companyId || undefined,
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    include: { journalEntry: { include: { company: true } }, account: true },
    orderBy: { journalEntry: { date: "asc" } },
  });

  let balance = 0;
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

  return { rows, closingBalance: balance };
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
  return { customer, ...statement };
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
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId: companyId || undefined },
  });
  if (!account) throw notFound("الحساب غير موجود");

  const normalSide: "debit" | "credit" = account.type === "asset" || account.type === "expense" ? "debit" : "credit";

  const scopedAccountIds = account.isPosting
    ? [account.id]
    : collectPostingDescendants(
        await prisma.account.findMany({ where: { tenantId, companyId: companyId || undefined } }),
        account.id,
      );

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      accountId: { in: scopedAccountIds },
      journalEntry: {
        tenantId,
        companyId: companyId || undefined,
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    include: { journalEntry: { include: { company: true } }, costCenter: true, account: true },
    orderBy: { journalEntry: { date: "asc" } },
  });

  let balance = 0;
  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    balance += normalSide === "debit" ? debit - credit : credit - debit;
    return {
      date: l.journalEntry.date,
      journalEntryId: l.journalEntryId,
      entryMemo: l.journalEntry.memo,
      lineDescription: l.description,
      costCenterName: l.costCenter?.name || null,
      companyName: l.journalEntry.company.shortName || l.journalEntry.company.name,
      accountId: l.accountId,
      accountName: l.account.name,
      accountCode: l.account.code,
      debit,
      credit,
      balance,
    };
  });

  return { account, normalSide, rows, closingBalance: balance };
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
  return { supplier, ...statement };
}
