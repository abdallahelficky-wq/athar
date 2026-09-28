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
 * الذمم المدينة: الفاتورة المفتوحة = قيمتها − ما كان مخصَّصاً لها من سندات قبض في ذلك التاريخ − المرتجعات المرتبطة بها
 * المؤرَّخة حتى ذلك التاريخ والمُسوّاة على حساب العميل (لا نقداً ولا بنكياً — تلك لا تمسّ الذمة). "ما كان مخصَّصاً في ذلك
 * التاريخ" يشمل تخصيصاً فُكَّ لاحقاً: فكّه بعد ذلك التاريخ حدث لاحق لا يغيّره (يُستعاد من سجل التدقيق
 * receipt.allocation_removed، منذ #112). تاريخ التخصيص الفعلي: التخصيص المُسجَّل مع السند نفسه (أو القديم بلا وقت تسجيل) بتاريخ
 * السند؛ التخصيص المُضاف لاحقاً بوقت إضافته — فسند يوليو خُصِّص في سبتمبر نقدٌ غير مخصَّص في نهاية يوليو، والفاتورة
 * مفتوحة. الإشعار المدين مستند مفتوح بتاريخه.
 *
 * الذمم الدائنة — ⚠ افتراض: كل سداد يسدّد أقدم الفواتير أولاً (لا واقعة مسجَّلة؛ قد يُسدَّد المورد مقابل فاتورة بعينها، والنظام
 * لا يعرف ذلك). لا يوجد بعد سند صرف يخصّص السداد لفواتير الموردين — السداد قيد يومية على حساب المورد. فالرصيد في
 * ذلك التاريخ يُوزَّع على فواتير المورد المؤرَّخة حتى ذلك التاريخ — كلٌّ بعد طرح مرتجعات المشتريات المرتبطة بها حتى ذلك
 * التاريخ — من الأحدث إلى الأقدم (الأقدم يُفترض مسدَّداً أولاً)، والزائد عن مجموعها "غير مخصَّص".
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

/**
 * تخصيصات كانت قائمة في asOf ثم فُكَّت بعده — تُستعاد لكل فاتورة من سجل التدقيق (receipt.allocation_removed/added، منذ
 * #112): الفكّ بعد asOf، والتخصيص نفسه فعّال قبله (أُضيف قبله، أو سُجِّل مع السند فتاريخه تاريخ السند). ما قبل #112
 * (تخصيصات عُدِّلت بتعديل السند نفسه) لا سجل له فلا يُستعاد.
 */
type AllocationEvent = { entityId: string | null; action: string; createdAt: Date; metadata: unknown };

async function loadAllocationEvents(tenantId: string, companyId: string | undefined): Promise<AllocationEvent[]> {
  return prisma.auditLog.findMany({
    where: { tenantId, companyId: companyId || undefined, entityType: "Receipt", action: { in: ["receipt.allocation_added", "receipt.allocation_removed"] } },
    select: { entityId: true, action: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
}

const eventInvoice = (e: AllocationEvent) => (e.metadata as { invoiceId?: string } | null)?.invoiceId;

async function allocationsRemovedAfter(tenantId: string, events: AllocationEvent[], asOf: Date): Promise<Map<string, number>> {
  const restored = new Map<string, number>();
  const removals = events.filter((e) => e.action === "receipt.allocation_removed" && e.createdAt > asOf);
  if (!removals.length) return restored;
  const receipts = await prisma.receipt.findMany({
    where: { tenantId, id: { in: [...new Set(removals.map((r) => r.entityId as string))] } },
    select: { id: true, date: true, status: true },
  });
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  for (const removal of removals) {
    const meta = removal.metadata as { invoiceId?: string; amount?: number } | null;
    const receipt = receiptById.get(removal.entityId as string);
    if (!meta?.invoiceId || !meta.amount || !receipt || receipt.status !== "posted" || receipt.date > asOf) continue;
    const added = events
      .filter((e) => e.action === "receipt.allocation_added" && e.entityId === removal.entityId && eventInvoice(e) === meta.invoiceId && e.createdAt < removal.createdAt)
      .pop();
    const effective = added ? added.createdAt : receipt.date;
    if (effective > asOf) continue;
    restored.set(meta.invoiceId, (restored.get(meta.invoiceId) || 0) + Number(meta.amount));
  }
  return restored;
}

/**
 * تاريخ التخصيص الفعلي: المُضاف لاحقاً (له صف تدقيق receipt.allocation_added) بوقت إضافته؛ المُسجَّل مع السند (لا صف
 * تدقيق له) — ومنه القديم بلا وقت — بتاريخ السند.
 */
function allocationDate(a: { receiptId: string; invoiceId: string; receipt: { date: Date } }, events: AllocationEvent[]) {
  const added = events.filter((e) => e.action === "receipt.allocation_added" && e.entityId === a.receiptId && eventInvoice(e) === a.invoiceId).pop();
  return added ? added.createdAt : a.receipt.date;
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
        receiptAllocations: { select: { receiptId: true, invoiceId: true, amount: true, receipt: { select: { date: true, status: true } } } },
      },
    }),
    // المرتجع والإشعار المدين المُسوّيان نقداً أو بنكياً لا يمسّان الذمة (قيدهما على الصندوق/البنك) — السجلات القديمة بلا
    // طريقة كانت على الحساب (الافتراضي)
    prisma.salesReturn.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf }, relatedInvoiceId: { not: null }, OR: [{ refundMethod: null }, { refundMethod: "account" }] },
      select: { relatedInvoiceId: true, grandTotal: true },
    }),
    prisma.salesDebitNote.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf }, OR: [{ chargeMethod: null }, { chargeMethod: "account" }] },
      select: { customerId: true, date: true, grandTotal: true },
    }),
  ]);
  const events = await loadAllocationEvents(tenantId, companyId);
  const restored = await allocationsRemovedAfter(tenantId, events, asOf);

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
      .filter((a) => a.receipt.status === "posted" && a.receipt.date <= asOf && allocationDate(a, events) <= asOf)
      .reduce((s, a) => s + Number(a.amount), 0);
    const open = Number(inv.grandTotal) - applied - (restored.get(inv.id) || 0) - (returnedByInvoice.get(inv.id) || 0);
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
  const [suppliers, invoices, returns] = await Promise.all([
    prisma.supplier.findMany({ where: scope, select: { id: true, name: true, accountId: true } }),
    prisma.purchaseInvoice.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf } },
      select: { id: true, supplierId: true, date: true, grandTotal: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    // مرتجع المشتريات يُنقِص فاتورته هو (قيده دائماً على حساب المورد) — قبل التوزيع، لا كسداد يُوزَّع على الأقدم
    prisma.purchaseReturn.findMany({
      where: { ...scope, status: "posted", date: { lte: asOf }, relatedInvoiceId: { not: null } },
      select: { relatedInvoiceId: true, grandTotal: true },
    }),
  ]);
  const returnedByInvoice = new Map<string, number>();
  for (const r of returns) returnedByInvoice.set(r.relatedInvoiceId!, (returnedByInvoice.get(r.relatedInvoiceId!) || 0) + Number(r.grandTotal));
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
      const open = Number(inv.grandTotal) - (returnedByInvoice.get(inv.id) || 0);
      if (open <= 0.005) continue;
      const take = Math.min(open, remaining);
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
