import { prisma } from "../../lib/prisma";
import type { Account } from "@prisma/client";
import { notFound } from "../../lib/httpError";
import { rollupAccountValues, RollupOptions, buildAccountValueTree, pruneTree, TreeNode } from "../../lib/reportRollup";

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
  options: { hideZeroActivity?: boolean; search?: string },
) {
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
  const prunedTree = pruneTree(rawTree, {
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

/**
 * يجمّع صفوف حساب واحد الجانب (إيراد/مصروف أو أصل/التزام/حقوق) حسب نفس منطق التجميع المشترك
 * (rollupAccountValues) المستخدَم في ميزان المراجعة — مستوى مختار، أو فرع/حساب معيّن مع
 * تفاصيل/بدون تفاصيل. بلا أي فلتر (rollup فارغ) تُعيد بالضبط سطراً واحداً لكل حساب ترحيل، مطابقاً
 * تماماً للسلوك القديم قبل إضافة هذا المنطق.
 */
function rollupTypeRows(
  accounts: Account[],
  balances: Map<string, AccountBalance>,
  types: Account["type"][],
  amountOf: (b: AccountBalance) => number,
  rollup: ReportRollupParams,
) {
  const values = new Map<string, { amount: number }>();
  for (const b of balances.values()) {
    if (!b.account.isPosting || !types.includes(b.account.type)) continue;
    values.set(b.account.id, { amount: amountOf(b) });
  }
  const rolled = rollupAccountValues(accounts, values, { amount: 0 }, {
    level: rollup.level,
    accountId: rollup.accountId,
    includeDetails: rollup.includeDetails,
  });
  const rows = rolled.map((r) => ({
    accountId: r.account.id,
    code: r.account.code,
    name: r.account.name,
    level: r.account.level,
    amount: r.value.amount,
  }));
  return searchFilter(rows, rollup.search).sort((a, b) => a.code.localeCompare(b.code));
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

  const revenueRows = rollupTypeRows(accounts, balances, ["revenue"], (b) => b.credit - b.debit, rollup);
  const expenseRows = rollupTypeRows(accounts, balances, ["expense"], (b) => b.debit - b.credit, rollup);

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalRevenue - totalExpense;

  return { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome };
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

  const assetRows = rollupTypeRows(accounts, balances, ["asset"], (b) => b.debit - b.credit, rollup);
  const liabilityRows = rollupTypeRows(accounts, balances, ["liability"], (b) => b.credit - b.debit, rollup);
  const equityRows = rollupTypeRows(accounts, balances, ["equity"], (b) => b.credit - b.debit, rollup);

  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquityBase = equityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = totalEquityBase + netIncome;

  return {
    assetRows,
    liabilityRows,
    equityRows,
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
 * المرتبطة بـ customerId/supplierId **وعلى حساب الذمم نفسه فقط** ("ذمم مدينة" للعميل،
 * "ذمم دائنة - موردين" للمورد)، تماماً كمنطق getCustomerBalance/getSupplierBalance
 * الموجود مسبقاً في customers.controller.ts/suppliers.controller.ts — بقية أسطر نفس القيد
 * (حساب الإيراد/المصروف، الضريبة) موسومة بنفس customerId/supplierId أيضاً لأغراض تقارير
 * أخرى، لكنها ليست جزءاً من حركة حساب الذمم وستُكرّر المبلغ لو أُدرجت هنا.
 * إشارة الرصيد: للعميل نبدأ من صفر ونزيد (مدين - دائن) لأن حساب "ذمم مدينة" مدين الطبيعة
 * (رصيد موجب = العميل مدين لنا)؛ للمورد العكس (دائن - مدين، رصيد موجب = نحن مدينون له).
 */
async function buildPartyStatement(
  tenantId: string,
  filter: { customerId?: string; supplierId?: string },
  ledgerAccountName: string,
  companyId: string | undefined,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  sign: 1 | -1,
) {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      ...filter,
      account: { name: ledgerAccountName },
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
  const statement = await buildPartyStatement(tenantId, { customerId }, "ذمم مدينة", companyId, dateFrom, dateTo, 1);
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
  const statement = await buildPartyStatement(
    tenantId,
    { supplierId },
    "ذمم دائنة - موردين",
    companyId,
    dateFrom,
    dateTo,
    -1,
  );
  return { supplier, ...statement };
}
