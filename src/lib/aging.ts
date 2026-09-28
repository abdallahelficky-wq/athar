import { prisma } from "./prisma";
import { COUNTED_ENTRY_WHERE } from "./countedEntries";
import { getAccountIdByName } from "./wellKnownAccounts";
import { HttpError } from "./httpError";

/**
 * أعمار الذمم كما في تاريخ محدَّد (asOf) — مركز الذمة في ذلك اليوم، لا اليوم الحالي مُسقَطاً على الماضي.
 *
 * الإجمالي لكل طرف هو رصيد حسابه في دفتر الأستاذ في ذلك التاريخ (القيود المحتسبة فقط)، فيطابق ميزان المراجعة.
 * الأعمار تُوزَّع على المستندات؛ ما لا يفسّره أي مستند مفتوح (سند قبض غير مخصَّص، رصيد افتتاحي، قيد يدوي) يظهر في
 * عمود "غير مخصَّص" بدل أن يُسقَط أو يُلصَق بفاتورة لا تخصّه.
 *
 * الذمم المدينة: الفاتورة المفتوحة = قيمتها − ما خُصِّص لها من سندات قبض حتى ذلك التاريخ − المرتجعات المرتبطة بها
 * المؤرَّخة حتى ذلك التاريخ. تاريخ التخصيص الفعلي: التخصيص المُسجَّل مع السند نفسه (أو القديم بلا وقت تسجيل) بتاريخ
 * السند؛ التخصيص المُضاف لاحقاً بوقت إضافته — فسند يوليو خُصِّص في سبتمبر نقدٌ غير مخصَّص في نهاية يوليو، والفاتورة
 * مفتوحة. الإشعار المدين مستند مفتوح بتاريخه.
 *
 * الذمم الدائنة: لا يوجد بعد سند صرف يخصّص السداد لفواتير الموردين — السداد قيد يومية على حساب المورد. فالرصيد في
 * ذلك التاريخ يُوزَّع على فواتير المورد المؤرَّخة حتى ذلك التاريخ من الأحدث إلى الأقدم (الأقدم يُفترض مسدَّداً أولاً)،
 * والزائد عن مجموعها "غير مخصَّص".
 *
 * العمر بالأيام من تاريخ المستند إلى asOf (لا من تاريخ الاستحقاق — راجع ملاحظة dueDate في README).
 */
export interface AgingBuckets {
  current: number; // 0-30
  d30: number; // 31-60
  d60: number; // 61-90
  d90: number; // 90+
  unallocated: number;
  total: number;
}

export interface AgingRow extends AgingBuckets {
  partyId: string;
  partyName: string;
}

export interface AgingReport {
  asOf: Date;
  rows: AgingRow[];
  totals: AgingBuckets;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const zero = (): AgingBuckets => ({ current: 0, d30: 0, d60: 0, d90: 0, unallocated: 0, total: 0 });

function addToBucket(b: AgingBuckets, date: Date, asOf: Date, amount: number) {
  const days = Math.floor((asOf.getTime() - date.getTime()) / DAY);
  if (days <= 30) b.current += amount;
  else if (days <= 60) b.d30 += amount;
  else if (days <= 90) b.d60 += amount;
  else b.d90 += amount;
}

/** نهاية اليوم المعطى (23:59:59.999 UTC) — "كما في تاريخ" يشمل كل حركات ذلك اليوم */
export function endOfDay(date: Date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

type Party = { id: string; name: string; accountId: string | null };

/** التخصيص المُسجَّل مع السند (خلال دقيقة من إنشائه) جزء من السند فيأخذ تاريخه؛ المُضاف بعده يأخذ وقت إضافته */
function allocationDate(a: { createdAt: Date | null; receipt: { date: Date; createdAt: Date } }) {
  if (!a.createdAt) return a.receipt.date;
  return Math.abs(a.createdAt.getTime() - a.receipt.createdAt.getTime()) < 60_000 ? a.receipt.date : a.createdAt;
}

/**
 * رصيد كل طرف في دفتر الأستاذ في asOf، بإشارته الطبيعية (المدينة: مدين − دائن؛ الدائنة: دائن − مدين). الطرف
 * الذي لم يُنقَل بعد لحساب مستقل يُقرأ من الحساب المشترك القديم بأسطره الموسومة به فقط (كـresolvePartyAccountId).
 */
async function ledgerBalances(
  tenantId: string,
  companyId: string | undefined,
  asOf: Date,
  parties: Party[],
  kind: "customer" | "supplier",
): Promise<Map<string, number>> {
  const sign = kind === "customer" ? 1 : -1;
  const entry = { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId: companyId || undefined, date: { lte: asOf } };
  const balances = new Map<string, number>();

  const own = parties.filter((p) => p.accountId);
  const partyByAccount = new Map(own.map((p) => [p.accountId as string, p.id]));
  if (own.length) {
    const sums = await prisma.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { accountId: { in: [...partyByAccount.keys()] }, journalEntry: entry },
      _sum: { debit: true, credit: true },
    });
    for (const s of sums) {
      const net = Number(s._sum.debit || 0) - Number(s._sum.credit || 0);
      balances.set(partyByAccount.get(s.accountId)!, sign * net);
    }
  }

  const legacy = parties.filter((p) => !p.accountId);
  if (legacy.length) {
    const sharedName = kind === "customer" ? "ذمم مدينة" : "ذمم دائنة - موردين";
    const companies = companyId ? [companyId] : (await prisma.company.findMany({ where: { tenantId }, select: { id: true } })).map((c) => c.id);
    const sharedIds: string[] = [];
    for (const c of companies) {
      try {
        sharedIds.push(await getAccountIdByName(tenantId, c, sharedName));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
      }
    }
    if (sharedIds.length) {
      const field = kind === "customer" ? "customerId" : "supplierId";
      const sums = await prisma.journalEntryLine.groupBy({
        by: [field],
        where: { accountId: { in: sharedIds }, [field]: { in: legacy.map((p) => p.id) }, journalEntry: entry },
        _sum: { debit: true, credit: true },
      });
      for (const s of sums as unknown as { customerId?: string; supplierId?: string; _sum: { debit: unknown; credit: unknown } }[]) {
        const id = (s.customerId ?? s.supplierId) as string;
        balances.set(id, sign * (Number(s._sum.debit || 0) - Number(s._sum.credit || 0)));
      }
    }
  }
  return balances;
}

function finish(asOf: Date, byParty: Map<string, AgingRow>): AgingReport {
  const totals = zero();
  const rows = [...byParty.values()]
    .map((r) => {
      const row = { ...r };
      (["current", "d30", "d60", "d90", "unallocated", "total"] as const).forEach((k) => {
        row[k] = round2(row[k]);
        totals[k] += row[k];
      });
      return row;
    })
    .filter((r) => Math.abs(r.total) >= 0.005 || [r.current, r.d30, r.d60, r.d90].some((v) => Math.abs(v) >= 0.005))
    .sort((a, b) => b.total - a.total);
  (Object.keys(totals) as (keyof AgingBuckets)[]).forEach((k) => (totals[k] = round2(totals[k])));
  return { asOf, rows, totals };
}

export async function receivablesAgingAsOf(tenantId: string, companyId: string | undefined, asOfDate: Date): Promise<AgingReport> {
  const asOf = endOfDay(asOfDate);
  const scope = { tenantId, companyId: companyId || undefined };
  const [customers, invoices, returns, debitNotes] = await Promise.all([
    prisma.customer.findMany({ where: scope, select: { id: true, name: true, accountId: true } }),
    prisma.salesInvoice.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf } },
      select: {
        id: true, customerId: true, date: true, grandTotal: true,
        receiptAllocations: { select: { amount: true, createdAt: true, receipt: { select: { date: true, status: true, createdAt: true } } } },
      },
    }),
    prisma.salesReturn.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf }, relatedInvoiceId: { not: null } },
      select: { relatedInvoiceId: true, grandTotal: true },
    }),
    prisma.salesDebitNote.findMany({ where: { ...scope, status: "posted", date: { lte: asOf } }, select: { customerId: true, date: true, grandTotal: true } }),
  ]);

  const returnedByInvoice = new Map<string, number>();
  for (const r of returns) returnedByInvoice.set(r.relatedInvoiceId!, (returnedByInvoice.get(r.relatedInvoiceId!) || 0) + Number(r.grandTotal));

  const nameOf = new Map(customers.map((c) => [c.id, c.name]));
  const byParty = new Map<string, AgingRow>();
  const rowFor = (id: string) => {
    let row = byParty.get(id);
    if (!row) byParty.set(id, (row = { partyId: id, partyName: nameOf.get(id) ?? "—", ...zero() }));
    return row;
  };

  for (const inv of invoices) {
    const applied = inv.receiptAllocations
      .filter((a) => a.receipt.status === "posted" && a.receipt.date <= asOf && allocationDate(a) <= asOf)
      .reduce((s, a) => s + Number(a.amount), 0);
    const open = Number(inv.grandTotal) - applied - (returnedByInvoice.get(inv.id) || 0);
    if (Math.abs(open) < 0.005) continue;
    addToBucket(rowFor(inv.customerId), inv.date, asOf, open);
  }
  for (const dn of debitNotes) addToBucket(rowFor(dn.customerId), dn.date, asOf, Number(dn.grandTotal));

  const ledger = await ledgerBalances(tenantId, companyId, asOf, customers, "customer");
  for (const id of new Set([...byParty.keys(), ...ledger.keys()])) {
    const row = rowFor(id);
    row.total = ledger.get(id) ?? 0;
    row.unallocated = row.total - (row.current + row.d30 + row.d60 + row.d90);
  }
  return finish(asOf, byParty);
}

export async function payablesAgingAsOf(tenantId: string, companyId: string | undefined, asOfDate: Date): Promise<AgingReport> {
  const asOf = endOfDay(asOfDate);
  const scope = { tenantId, companyId: companyId || undefined };
  const [suppliers, invoices] = await Promise.all([
    prisma.supplier.findMany({ where: scope, select: { id: true, name: true, accountId: true } }),
    prisma.purchaseInvoice.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf } },
      select: { supplierId: true, date: true, grandTotal: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const ledger = await ledgerBalances(tenantId, companyId, asOf, suppliers, "supplier");
  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
  const invoicesBySupplier = new Map<string, typeof invoices>();
  for (const inv of invoices) invoicesBySupplier.set(inv.supplierId, [...(invoicesBySupplier.get(inv.supplierId) || []), inv]);

  const byParty = new Map<string, AgingRow>();
  for (const [id, balance] of ledger) {
    const row: AgingRow = { partyId: id, partyName: nameOf.get(id) ?? "—", ...zero(), total: balance };
    // الأحدث أولاً: الرصيد القائم هو آخر ما فُوتِر؛ الأقدم يُفترض مسدَّداً أولاً
    let remaining = balance;
    for (const inv of invoicesBySupplier.get(id) || []) {
      if (remaining <= 0.005) break;
      const take = Math.min(Number(inv.grandTotal), remaining);
      addToBucket(row, inv.date, asOf, take);
      remaining -= take;
    }
    row.unallocated = remaining;
    byParty.set(id, row);
  }
  return finish(asOf, byParty);
}

/** ملخص الحِزَم بالأسماء التي يعرضها التقرير الشهري والداشبورد */
export function monthlyAgingShape(report: AgingReport) {
  const t = report.totals;
  return { under30: t.current, d30to60: t.d30, d60to90: t.d60, over90: t.d90, unallocated: t.unallocated };
}
