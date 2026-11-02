import { CardSettlementChannel, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { createJournalEntryTx, reserveEntryNumber, recomputeEntryTotal, type PostingLine } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { INPUT_VAT_ACCOUNT_NAME } from "../../lib/vatAccounts";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { FUEL_CARD_RECEIVABLE_ACCOUNT_NAME, NETWORK_RECEIVABLE_ACCOUNT_NAME } from "../stationShifts/stationShifts.service";

/**
 * تسويات الشبكة (مدى) وبطاقات الوقود — مطابقة ما سجّلته الورديات تحصيلاً بالبطاقات مع ما أودعه البنك فعلاً، وإقفال الذمم.
 *
 * الوردية المرحَّلة تقيّد تحصيل البطاقات مديناً على ذمم القناة (ذمم شبكة نقاط البيع (مدى) / ذمم شركات بطاقات الوقود)،
 * موسوماً بمركز تكلفة المحطة. التسوية تغطي أيام ورديات [salesFrom, salesTo] لمحطة وقناة، وقيدها:
 *   مدين البنك بالصافي المودَع + مدين عمولة البنك + مدين ضريبة المدخلات على العمولة / دائن ذمم القناة بالإجمالي
 * الإجمالي = الصافي + العمولة + ضريبتها، وهو ما يُقفَل من الذمم. expectedAmount لقطة مجموع تحصيل القناة في ورديات الفترة
 * المرحَّلة؛ الفرق بينه وبين الإجمالي (مبلغ لم يُدفع أو دُفع زائداً) يبقى في حساب الذمم ظاهراً في المطابقة.
 *
 * لا تُسجَّل تسوية لفترة فيها وردية لم تُرحَّل بعد (لا قيد لها على الذمم، وأيامها ستُغلَق بلا تحصيلها)، ولا تتداخل فترتا
 * تسويتين قائمتين لنفس المحطة والقناة (فحص تحت قفل صف المحطة). القيد مصدره card_settlement: لا يُعكَس ولا يُفَك ترحيله
 * ولا يُعدَّل ولا يُنشأ له قيد مرآة من شاشة القيود العامة — العكس من هنا فقط، فيعود أيام الفترة "غير مسوّاة".
 */

export const CARD_FEE_ACCOUNT_MISSING = "لم يُحدَّد حساب عمولات البنك على تسويات البطاقات لهذه الشركة — اضبطه من إعدادات الشركة أولاً";
export const CARD_SETTLEMENT_OVERLAP = "فترة هذه التسوية تتداخل مع تسوية قائمة لنفس المحطة والقناة";
export const CARD_SETTLEMENT_PENDING_SHIFTS = "توجد ورديات في هذه الفترة لم تُرحَّل بعد — رحّلها أو ارفضها قبل تسجيل التسوية";

const PENDING_SHIFT_STATUSES = ["open", "submitted", "under_review", "approved"] as const;
const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const round2 = (n: number) => Math.round(n * 100) / 100;

const receivableAccountName = (channel: CardSettlementChannel) => (channel === "network" ? NETWORK_RECEIVABLE_ACCOUNT_NAME : FUEL_CARD_RECEIVABLE_ACCOUNT_NAME);
const channelAmount = (channel: CardSettlementChannel, c: { networkAmount: Prisma.Decimal; fuelCardAmount: Prisma.Decimal } | null) =>
  c ? d(channel === "network" ? c.networkAmount : c.fuelCardAmount) : d(0);

/** ورديات محطة مرحَّلة (بلا البذرة) بتاريخ وردية داخل [from, to] — تحصيل القناة لكل وردية. */
async function postedShiftAmounts(tenantId: string, companyId: string, filter: { from: string; to: string; channel: CardSettlementChannel; costCenterId?: string }) {
  const shifts = await prisma.stationShift.findMany({
    where: {
      tenantId, companyId, status: "posted", isSeedData: false,
      ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
      shiftDate: { gte: dayStart(filter.from), lte: dayStart(filter.to) },
    },
    select: { id: true, costCenterId: true, shiftDate: true, collection: { select: { networkAmount: true, fuelCardAmount: true } } },
  });
  return shifts.map((s) => ({ id: s.id, costCenterId: s.costCenterId, day: s.shiftDate.toISOString().slice(0, 10), amount: channelAmount(filter.channel, s.collection) }));
}

export interface CreateSettlementInput {
  companyId: string;
  costCenterId: string;
  channel: CardSettlementChannel;
  salesFrom: string;
  salesTo: string;
  settledOn: string;
  bankAccountId: string;
  netAmount: number;
  feeAmount?: number;
  feeVatAmount?: number;
  reference?: string;
  note?: string;
}

export async function createCardSettlement(tenantId: string, userId: string, input: CreateSettlementInput) {
  if (input.salesFrom > input.salesTo) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  if (input.settledOn < input.salesFrom) throw badRequest("تاريخ الإيداع يسبق أول يوم مبيعات في التسوية");
  const net = d(input.netAmount).toDecimalPlaces(2);
  const fee = d(input.feeAmount ?? 0).toDecimalPlaces(2);
  const feeVat = d(input.feeVatAmount ?? 0).toDecimalPlaces(2);
  if (net.isNegative() || fee.isNegative() || feeVat.isNegative()) throw badRequest("مبالغ التسوية لا تكون سالبة");
  const gross = net.plus(fee).plus(feeVat);
  if (!gross.greaterThan(0)) throw badRequest("أدخل المبلغ المودَع في البنك");

  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const station = await prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId, companyId: company.id } });
  if (!station) throw badRequest("المحطة غير موجودة ضمن هذه الشركة");
  const bank = await prisma.account.findFirst({
    where: { id: input.bankAccountId, tenantId, companyId: company.id, isPosting: true, isActive: true, isArchived: false, isBankOrCash: true },
  });
  if (!bank) throw badRequest("حساب الإيداع يجب أن يكون حساب بنك/نقدية للترحيل من نفس الشركة");
  if (fee.greaterThan(0) && !company.cardFeeExpenseAccountId) throw badRequest(CARD_FEE_ACCOUNT_MISSING);
  const receivableAccountId = await getAccountIdByName(tenantId, company.id, receivableAccountName(input.channel));
  const inputVatAccountId = feeVat.greaterThan(0) ? await getAccountIdByName(tenantId, company.id, INPUT_VAT_ACCOUNT_NAME) : null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cost_centers WHERE id = ${station.id} AND "tenantId" = ${tenantId} FOR UPDATE`;

    const overlap = await tx.cardSettlement.findFirst({
      where: {
        tenantId, companyId: company.id, costCenterId: station.id, channel: input.channel, status: "posted",
        salesFrom: { lte: input.salesTo }, salesTo: { gte: input.salesFrom },
      },
      select: { id: true },
    });
    if (overlap) throw badRequest(CARD_SETTLEMENT_OVERLAP);

    const pending = await tx.stationShift.count({
      where: {
        tenantId, companyId: company.id, costCenterId: station.id, isSeedData: false, status: { in: [...PENDING_SHIFT_STATUSES] },
        shiftDate: { gte: dayStart(input.salesFrom), lte: dayStart(input.salesTo) },
      },
    });
    if (pending > 0) throw badRequest(CARD_SETTLEMENT_PENDING_SHIFTS);

    const shifts = await tx.stationShift.findMany({
      where: {
        tenantId, companyId: company.id, costCenterId: station.id, isSeedData: false, status: "posted",
        shiftDate: { gte: dayStart(input.salesFrom), lte: dayStart(input.salesTo) },
      },
      select: { collection: { select: { networkAmount: true, fuelCardAmount: true } } },
    });
    const amounts = shifts.map((s) => channelAmount(input.channel, s.collection)).filter((a) => a.greaterThan(0));
    const expected = amounts.reduce((sum, a) => sum.plus(a), d(0)).toDecimalPlaces(2);
    if (!expected.greaterThan(0)) throw badRequest("لا توجد مبيعات بهذه القناة في ورديات مرحَّلة لهذه المحطة في الفترة");

    const settledOn = dayStart(input.settledOn);
    const settlement = await tx.cardSettlement.create({
      data: {
        tenantId, companyId: company.id, costCenterId: station.id, channel: input.channel, salesFrom: input.salesFrom, salesTo: input.salesTo,
        settledOn, bankAccountId: bank.id, expectedAmount: expected, grossAmount: gross, feeAmount: fee, feeVatAmount: feeVat, netAmount: net,
        shiftCount: amounts.length, reference: input.reference?.trim() || null, note: input.note?.trim() || null, createdByUserId: userId,
      },
    });

    const label = input.channel === "network" ? "تسوية مبيعات الشبكة" : "تسوية بطاقات الوقود";
    const description = `${label} — ${station.name} ${input.salesFrom} إلى ${input.salesTo}`;
    const lines: PostingLine[] = [];
    if (net.greaterThan(0)) lines.push({ accountId: bank.id, lineDescription: description, debit: net.toNumber(), credit: 0 });
    if (fee.greaterThan(0)) lines.push({ accountId: company.cardFeeExpenseAccountId!, costCenterId: station.id, lineDescription: `عمولة البنك — ${description}`, debit: fee.toNumber(), credit: 0 });
    if (feeVat.greaterThan(0)) lines.push({ accountId: inputVatAccountId!, lineDescription: `ضريبة عمولة البنك — ${description}`, debit: feeVat.toNumber(), credit: 0 });
    lines.push({ accountId: receivableAccountId, costCenterId: station.id, lineDescription: description, debit: 0, credit: gross.toNumber() });

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: company.id,
      date: settledOn,
      memo: `${description}${input.reference?.trim() ? ` — مرجع ${input.reference.trim()}` : ""}`,
      sourceModule: "card_settlement",
      sourceId: settlement.id,
      createdBy: userId,
      lines,
    });
    return tx.cardSettlement.update({ where: { id: settlement.id }, data: { journalEntryId: entry.id } });
  });
}

export interface ReverseSettlementInput {
  reason: string;
  date?: string;
}

/** عكس تسوية: قيد عكسي مربوط بـreversalOfEntryId (بنفس المصدر فيبقى محمياً)، والحالة reversed — فتعود أيامها غير مسوّاة. */
export async function reverseCardSettlement(tenantId: string, userId: string, settlementId: string, input: ReverseSettlementInput) {
  const reason = input.reason.trim();
  if (!reason) throw badRequest("سبب عكس التسوية مطلوب");
  const settlement = await prisma.cardSettlement.findFirst({ where: { id: settlementId, tenantId } });
  if (!settlement) throw notFound("التسوية غير موجودة");
  if (settlement.status !== "posted") throw badRequest("التسوية معكوسة بالفعل");
  if (!settlement.journalEntryId) throw badRequest("لا قيد محاسبي مرتبط بهذه التسوية — لا يوجد ما يُعكَس");

  const entry = await prisma.journalEntry.findFirst({ where: { id: settlement.journalEntryId, tenantId, companyId: settlement.companyId }, include: { lines: true } });
  if (!entry) throw notFound("قيد التسوية غير موجود");
  if (entry.status !== "posted") throw badRequest("قيد التسوية ليس مرحّلاً — لا يمكن عكسه");
  if (entry.mirrorEntryId) throw badRequest("لقيد هذه التسوية قيد مرآة في شركة أخرى — لا يمكن عكسها قبل معالجة قيد المرآة");
  const alreadyReversed = await prisma.journalEntry.findFirst({ where: { tenantId, companyId: settlement.companyId, reversalOfEntryId: entry.id } });
  if (alreadyReversed) throw badRequest("قيد هذه التسوية معكوس بالفعل بقيد آخر");

  const date = dayStart(input.date ?? riyadhCalendarDay(new Date()));
  if (Number.isNaN(date.getTime())) throw badRequest("تاريخ قيد العكس غير صالح");

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.cardSettlement.updateMany({ where: { id: settlement.id, tenantId, status: "posted" }, data: { status: "reversed" } });
    if (claimed.count !== 1) throw badRequest("التسوية معكوسة بالفعل");
    const { entryNumber, entrySeq } = await reserveEntryNumber(tx, tenantId, settlement.companyId, date);
    const reversal = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: settlement.companyId,
        date,
        memo: `عكس ${entry.memo ?? "قيد تسوية بطاقات"} — ${reason}`,
        status: "posted",
        entryNumber,
        entrySeq,
        sourceModule: "card_settlement",
        sourceId: settlement.id,
        createdBy: userId,
        reversalOfEntryId: entry.id,
        lines: {
          create: entry.lines.map((l) => ({
            accountId: l.accountId,
            costCenterId: l.costCenterId,
            department: l.department,
            departmentId: l.departmentId,
            branchId: l.branchId,
            description: l.description,
            debit: l.credit,
            credit: l.debit,
          })),
        },
      },
    });
    await recomputeEntryTotal(tx, reversal.id);
    return tx.cardSettlement.update({
      where: { id: settlement.id },
      data: { reversedAt: new Date(), reversedByUserId: userId, reverseReason: reason, reversalEntryId: reversal.id },
    });
  });
}

export async function listCardSettlements(tenantId: string, companyId: string, filter: { from?: string; to?: string; channel?: CardSettlementChannel; costCenterId?: string }) {
  const rows = await prisma.cardSettlement.findMany({
    where: {
      tenantId, companyId,
      ...(filter.channel ? { channel: filter.channel } : {}),
      ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
      ...(filter.to ? { salesFrom: { lte: filter.to } } : {}),
      ...(filter.from ? { salesTo: { gte: filter.from } } : {}),
    },
    include: { bankAccount: { select: { id: true, code: true, name: true } } },
    orderBy: [{ settledOn: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const entryIds = rows.flatMap((r) => [r.journalEntryId, r.reversalEntryId]).filter((id): id is string => !!id);
  const entries = await prisma.journalEntry.findMany({ where: { tenantId, companyId, id: { in: entryIds } }, select: { id: true, entryNumber: true } });
  const numberOf = new Map(entries.map((e) => [e.id, e.entryNumber]));
  return rows.map((r) => ({
    ...r,
    difference: round2(Number(r.grossAmount) - Number(r.expectedAmount)),
    entryNumber: r.journalEntryId ? numberOf.get(r.journalEntryId) ?? null : null,
    reversalEntryNumber: r.reversalEntryId ? numberOf.get(r.reversalEntryId) ?? null : null,
  }));
}

/**
 * مطابقة الفترة لقناة: لكل محطة ويوم ورديات فيه تحصيل بالقناة — المبلغ، والتسوية القائمة التي تغطيه (أو لا شيء = بانتظار
 * البنك، مع عمر الأيام). ملخص لكل محطة: المبيعات، المسوّى (بلقطة المتوقع)، غير المسوّى، العمولات، ورصيد حساب الذمم للمحطة
 * في دفتر الأستاذ حتى نهاية الفترة (من القيود المرحَّلة نفسها) للتحقق.
 */
export async function cardReconciliation(tenantId: string, companyId: string, filter: { from: string; to: string; channel: CardSettlementChannel; costCenterId?: string }) {
  if (filter.from > filter.to) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  const [shifts, settlements, stations, pendingShifts] = await Promise.all([
    postedShiftAmounts(tenantId, companyId, filter),
    prisma.cardSettlement.findMany({
      where: {
        tenantId, companyId, channel: filter.channel, status: "posted",
        ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
        salesFrom: { lte: filter.to }, salesTo: { gte: filter.from },
      },
    }),
    prisma.costCenter.findMany({ where: { tenantId, companyId }, select: { id: true, name: true } }),
    prisma.stationShift.groupBy({
      by: ["costCenterId"],
      where: {
        tenantId, companyId, isSeedData: false, status: { in: [...PENDING_SHIFT_STATUSES] },
        ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
        shiftDate: { gte: dayStart(filter.from), lte: dayStart(filter.to) },
      },
      _count: { _all: true },
    }),
  ]);
  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const today = riyadhCalendarDay(new Date());
  const ageDays = (day: string) => Math.max(0, Math.round((dayStart(today).getTime() - dayStart(day).getTime()) / 86_400_000));

  const byDay = new Map<string, { costCenterId: string; day: string; amount: Prisma.Decimal; shiftCount: number }>();
  for (const s of shifts) {
    if (!s.amount.greaterThan(0)) continue;
    const key = `${s.costCenterId}|${s.day}`;
    const row = byDay.get(key) ?? { costCenterId: s.costCenterId, day: s.day, amount: d(0), shiftCount: 0 };
    row.amount = row.amount.plus(s.amount);
    row.shiftCount += 1;
    byDay.set(key, row);
  }
  const days = [...byDay.values()]
    .map((r) => {
      const covering = settlements.find((st) => st.costCenterId === r.costCenterId && st.salesFrom <= r.day && st.salesTo >= r.day);
      return {
        costCenterId: r.costCenterId, stationName: stationName.get(r.costCenterId) ?? "", day: r.day, amount: r.amount.toDecimalPlaces(2).toNumber(),
        shiftCount: r.shiftCount, settlementId: covering?.id ?? null, ageDays: covering ? null : ageDays(r.day),
      };
    })
    .sort((a, b) => (a.day === b.day ? a.stationName.localeCompare(b.stationName) : b.day.localeCompare(a.day)));

  // رصيد ذمم القناة لكل محطة في الدفتر حتى نهاية الفترة — من أسطر القيود المرحَّلة الموسومة بمركز تكلفة المحطة
  let ledger = new Map<string, number>();
  try {
    const receivableAccountId = await getAccountIdByName(tenantId, companyId, receivableAccountName(filter.channel));
    const sums = await prisma.journalEntryLine.groupBy({
      by: ["costCenterId"],
      where: {
        accountId: receivableAccountId,
        ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
        journalEntry: { tenantId, companyId, status: "posted", date: { lte: dayStart(filter.to) } },
      },
      _sum: { debit: true, credit: true },
    });
    ledger = new Map(sums.map((s) => [s.costCenterId ?? "", round2(Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0))]));
  } catch {
    // الشركة بلا حساب ذمم لهذه القناة في شجرتها — لا رصيد يُعرض
  }

  const stationIds = [...new Set([...days.map((r) => r.costCenterId), ...settlements.map((s) => s.costCenterId), ...pendingShifts.map((p) => p.costCenterId)])];
  const summary = stationIds.map((id) => {
    const own = days.filter((r) => r.costCenterId === id);
    const ownSettlements = settlements.filter((s) => s.costCenterId === id);
    const sales = round2(own.reduce((s, r) => s + r.amount, 0));
    const unsettled = round2(own.filter((r) => !r.settlementId).reduce((s, r) => s + r.amount, 0));
    return {
      costCenterId: id,
      stationName: stationName.get(id) ?? "",
      sales,
      unsettled,
      unsettledDays: own.filter((r) => !r.settlementId).length,
      oldestUnsettledDays: Math.max(0, ...own.filter((r) => !r.settlementId).map((r) => r.ageDays ?? 0)),
      settledGross: round2(ownSettlements.reduce((s, x) => s + Number(x.grossAmount), 0)),
      fees: round2(ownSettlements.reduce((s, x) => s + Number(x.feeAmount) + Number(x.feeVatAmount), 0)),
      difference: round2(ownSettlements.reduce((s, x) => s + Number(x.grossAmount) - Number(x.expectedAmount), 0)),
      pendingShifts: pendingShifts.find((p) => p.costCenterId === id)?._count._all ?? 0,
      ledgerBalance: ledger.get(id) ?? 0,
    };
  }).sort((a, b) => a.stationName.localeCompare(b.stationName));

  return { from: filter.from, to: filter.to, channel: filter.channel, days, summary };
}
