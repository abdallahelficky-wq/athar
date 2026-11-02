import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { createJournalEntryTx, reserveEntryNumber, recomputeEntryTotal } from "../../lib/journalPosting";
import { riyadhCalendarDay, riyadhDayStartUtc, riyadhDayEndExclusiveUtc } from "../../lib/riyadhDate";
import { stockAccountFor } from "../../lib/stockAccount";
import { FUEL_ITEM_FIELD, FUEL_PRODUCT_LABEL_AR, STATION_WAREHOUSE_MISSING, warehouseBalanceTx } from "../stationShifts/stationShiftCogs";
import { reconcile } from "./stationTanks.service";

/**
 * ترحيل فرق مطابقة خزان لفترة — يحوّل فرق المطابقة (لترات) إلى أثر محاسبي ومخزني في معاملة واحدة:
 *   القيمة = |الفرق| × متوسط التكلفة المرجّح الحالي لصنف الوقود المربوط بمنتج الخزان (بعد قفل صف الصنف)
 *   العجز:  مدين حساب فروقات قياس الخزانات / دائن حساب مخزون مستودع المحطة
 *   الزيادة: مدين حساب مخزون مستودع المحطة / دائن حساب فروقات قياس الخزانات
 *   + حركة تسوية (adjustment) بإشارة الفرق في مستودع المحطة، فيطابق رصيد المستودع ما في الخزان.
 * أرقام المطابقة تُحسَب بنفس دالة شاشة المطابقة (reconcile) وتُحفَظ لقطةً في سجل الترحيل.
 *
 * السلسلة لكل خزان: الترحيلات متتابعة لا تتداخل (افتتاح الجديد لا يسبق إقفال آخر ترحيل قائم)، والعكس للأحدث أولاً. قفل صف
 * الخزان طوال المعاملة يرتّب ترحيلين متزامنين لنفس الخزان، والفهرس الجزئي الفريد (خزان + قراءة إقفال، للحالة posted) يمنع
 * تكرار نفس الفترة. قراءتا الافتتاح والإقفال المستخدمتان لا تُلغيان، ولا يُسجَّل أو يُلغى توريد داخل فترة مرحَّلة
 * (stationTanks.service.ts) — كلاهما يغيّر رقماً رُحِّل فعلاً.
 *
 * القيد مصدره station_tank_variance: لا يُعكَس ولا يُفَك ترحيله ولا يُعدَّل ولا يُنشأ له قيد مرآة من شاشة القيود العامة
 * (journalEntries.service.ts) — العكس الوحيد من هنا، لأنه يحذف حركة المخزون ويضبط حالة الترحيل مع القيد.
 */

export const TANK_VARIANCE_ACCOUNT_MISSING = "لم يُحدَّد حساب فروقات قياس الخزانات لهذه الشركة — اضبطه من إعدادات الشركة أولاً";
export const TANK_VARIANCE_OVERLAP = "فترة هذا الترحيل تبدأ قبل نهاية فرق مرحَّل سابقاً لنفس الخزان — رحّل الفترة التي تليه فقط";
export const TANK_VARIANCE_LATER_EXISTS = "يوجد فرق مرحَّل أحدث لنفس الخزان — اعكسه أولاً";

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface PostVarianceInput {
  companyId: string;
  tankId: string;
  from: string;
  to: string;
  note?: string;
}

export async function postTankVariance(tenantId: string, userId: string, input: PostVarianceInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  if (!company.tankVarianceAccountId) throw badRequest(TANK_VARIANCE_ACCOUNT_MISSING);
  const varianceAccountId = company.tankVarianceAccountId;

  const tank = await prisma.stationTank.findFirst({ where: { id: input.tankId, tenantId, companyId: company.id } });
  if (!tank) throw notFound("الخزان غير موجود");
  if (!tank.isActive) throw badRequest("الخزان موقوف");

  const { rows } = await reconcile(tenantId, company.id, { from: input.from, to: input.to, costCenterId: tank.costCenterId });
  const row = rows.find((r) => r.tankId === tank.id);
  if (!row || row.status === "insufficient_readings" || !row.openingReadingId || !row.closingReadingId || !row.openingAt || !row.closingAt) {
    throw badRequest("لا توجد قراءتا افتتاح وإقفال للخزان في هذه الفترة — لا فرق يُرحَّل");
  }
  const varianceLiters = d(row.varianceLiters ?? 0);
  if (varianceLiters.isZero()) throw badRequest("لا فرق في هذه الفترة يُرحَّل");
  const openingAt = row.openingAt;
  const closingAt = row.closingAt;
  const label = FUEL_PRODUCT_LABEL_AR[tank.product];

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM station_tanks WHERE id = ${tank.id} AND "tenantId" = ${tenantId} FOR UPDATE`;

      const last = await tx.tankVariancePosting.findFirst({
        where: { tenantId, companyId: company.id, tankId: tank.id, status: "posted" },
        orderBy: { closingAt: "desc" },
      });
      if (last && openingAt.getTime() < last.closingAt.getTime()) throw badRequest(TANK_VARIANCE_OVERLAP);

      // القراءتان قد تُلغيان بين حساب المطابقة وهذه المعاملة — يُعاد التحقق تحت القفل
      const liveReadings = await tx.tankReading.count({
        where: { tenantId, tankId: tank.id, id: { in: [row.openingReadingId!, row.closingReadingId!] }, voidedAt: null },
      });
      if (liveReadings !== 2) throw badRequest("تغيّرت قراءات الخزان أثناء الترحيل — أعد عرض المطابقة ثم رحّل");

      const itemId = company[FUEL_ITEM_FIELD[tank.product]];
      if (!itemId) {
        throw badRequest(`لم يُربَط صنف مخزون بمنتج «${label}» في بيانات الشركة — اربطه من إعدادات الشركة قبل ترحيل الفرق`);
      }
      const warehouse = await tx.warehouse.findFirst({ where: { tenantId, companyId: company.id, costCenterId: tank.costCenterId, isArchived: false } });
      if (!warehouse) throw badRequest(STATION_WAREHOUSE_MISSING);

      await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} AND "tenantId" = ${tenantId} AND "companyId" = ${company.id} FOR UPDATE`;
      const item = await tx.item.findFirst({ where: { id: itemId, tenantId, companyId: company.id } });
      const stockAccountId = item ? stockAccountFor(item, warehouse) : null;
      if (!item || item.type !== "inventory" || item.isArchived || !stockAccountId) {
        throw badRequest(`صنف الوقود المربوط بمنتج «${label}» غير صالح: يجب أن يكون صنف مخزون دائم غير مؤرشف من نفس الشركة وله حساب مخزون`);
      }
      const unitCost = d(item.averageCost);
      if (!unitCost.greaterThan(0)) {
        throw badRequest(`متوسط تكلفة صنف «${label}» صفر — أدخل فاتورة شراء له قبل ترحيل الفرق حتى تُحسَب قيمته`);
      }
      if (varianceLiters.isNegative() && !company.allowNegativeFuelStock) {
        const balance = await warehouseBalanceTx(tx, tenantId, company.id, item.id, warehouse.id);
        if (varianceLiters.abs().greaterThan(balance)) {
          throw badRequest("عجز الخزان أكبر من رصيد مستودع المحطة، والرصيد السالب للوقود غير مسموح في إعدادات الشركة");
        }
      }
      const amount = varianceLiters.abs().times(unitCost).toDecimalPlaces(2);
      if (!amount.greaterThan(0)) throw badRequest("لا فرق في هذه الفترة يُرحَّل");

      const entryDate = new Date(`${riyadhCalendarDay(closingAt)}T00:00:00.000Z`);
      const posting = await tx.tankVariancePosting.create({
        data: {
          tenantId, companyId: company.id, tankId: tank.id, costCenterId: tank.costCenterId, periodFrom: input.from, periodTo: input.to,
          openingReadingId: row.openingReadingId!, closingReadingId: row.closingReadingId!, openingAt, closingAt,
          openingLiters: row.openingLiters!, closingLiters: row.closingLiters!, receivedLiters: row.receivedLiters, soldLiters: row.soldLiters,
          expectedLiters: row.expectedLiters!, varianceLiters, itemId: item.id, warehouseId: warehouse.id, unitCost, amount, entryDate,
          note: input.note?.trim() || null, postedByUserId: userId,
        },
      });

      const isLoss = varianceLiters.isNegative();
      const description = `${isLoss ? "عجز" : "زيادة"} قياس خزان ${tank.code} (${label}) — ${varianceLiters.abs().toString()} لتر`;
      const value = amount.toNumber();
      const entry = await createJournalEntryTx(tx, {
        tenantId,
        companyId: company.id,
        date: entryDate,
        memo: `فرق خزان ${tank.code} (${label}) للفترة ${input.from} إلى ${input.to}`,
        sourceModule: "station_tank_variance",
        sourceId: posting.id,
        createdBy: userId,
        lines: isLoss
          ? [
              { accountId: varianceAccountId, costCenterId: tank.costCenterId, lineDescription: description, debit: value, credit: 0 },
              { accountId: stockAccountId, costCenterId: tank.costCenterId, lineDescription: description, debit: 0, credit: value },
            ]
          : [
              { accountId: stockAccountId, costCenterId: tank.costCenterId, lineDescription: description, debit: value, credit: 0 },
              { accountId: varianceAccountId, costCenterId: tank.costCenterId, lineDescription: description, debit: 0, credit: value },
            ],
      });
      // تسوية بإشارة الفرق (adjustment مخزَّنة موقَّعة — نفس اصطلاح تسوية الجرد الدوري) بالمتوسط الحالي، فلا تغيّر المتوسط
      const movement = await tx.stockMovement.create({
        data: {
          tenantId, companyId: company.id, itemId: item.id, warehouseId: warehouse.id, type: "adjustment",
          quantity: varianceLiters.toDecimalPlaces(4), unitCost, date: entryDate, journalEntryId: entry.id,
          note: `تسوية فرق قياس خزان ${tank.code} (${label})`,
        },
      });
      return tx.tankVariancePosting.update({ where: { id: posting.id }, data: { journalEntryId: entry.id, stockMovementId: movement.id } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw badRequest("فرق هذه الفترة مرحَّل بالفعل لهذا الخزان");
    throw err;
  }
}

export interface ReverseVarianceInput {
  reason: string;
  /** تاريخ قيد العكس (يوم بتوقيت الرياض YYYY-MM-DD) — افتراضياً اليوم. فحص إقفال الفترة يجري عند حجز رقم القيد. */
  date?: string;
}

/** عكس ترحيل فرق: قيد عكسي مربوط بـreversalOfEntryId (بنفس المصدر فيبقى محمياً)، حذف حركة التسوية، والحالة reversed. */
export async function reverseTankVariance(tenantId: string, userId: string, postingId: string, input: ReverseVarianceInput) {
  const reason = input.reason.trim();
  if (!reason) throw badRequest("سبب عكس الترحيل مطلوب");
  const posting = await prisma.tankVariancePosting.findFirst({ where: { id: postingId, tenantId } });
  if (!posting) throw notFound("ترحيل الفرق غير موجود");
  if (posting.status !== "posted") throw badRequest("ترحيل الفرق معكوس بالفعل");
  const later = await prisma.tankVariancePosting.findFirst({
    where: { tenantId, tankId: posting.tankId, status: "posted", closingAt: { gt: posting.closingAt } },
  });
  if (later) throw badRequest(TANK_VARIANCE_LATER_EXISTS);
  if (!posting.journalEntryId) throw badRequest("لا قيد محاسبي مرتبط بهذا الترحيل — لا يوجد ما يُعكَس");

  const entry = await prisma.journalEntry.findFirst({ where: { id: posting.journalEntryId, tenantId, companyId: posting.companyId }, include: { lines: true } });
  if (!entry) throw notFound("قيد ترحيل الفرق غير موجود");
  if (entry.status !== "posted") throw badRequest("قيد ترحيل الفرق ليس مرحّلاً — لا يمكن عكسه");
  if (entry.mirrorEntryId) throw badRequest("لقيد هذا الترحيل قيد مرآة في شركة أخرى — لا يمكن عكسه قبل معالجة قيد المرآة");
  const alreadyReversed = await prisma.journalEntry.findFirst({ where: { tenantId, companyId: posting.companyId, reversalOfEntryId: entry.id } });
  if (alreadyReversed) throw badRequest("قيد هذا الترحيل معكوس بالفعل بقيد آخر");

  const date = new Date(`${input.date ?? riyadhCalendarDay(new Date())}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw badRequest("تاريخ قيد العكس غير صالح");

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.tankVariancePosting.updateMany({ where: { id: posting.id, tenantId, status: "posted" }, data: { status: "reversed" } });
    if (claimed.count !== 1) throw badRequest("ترحيل الفرق معكوس بالفعل");

    const { entryNumber, entrySeq } = await reserveEntryNumber(tx, tenantId, posting.companyId, date);
    const reversal = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: posting.companyId,
        date,
        memo: `عكس ${entry.memo ?? "قيد فرق خزان"} — ${reason}`,
        status: "posted",
        entryNumber,
        entrySeq,
        sourceModule: "station_tank_variance",
        sourceId: posting.id,
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
    if (posting.stockMovementId) await tx.stockMovement.deleteMany({ where: { id: posting.stockMovementId, tenantId, companyId: posting.companyId } });
    return tx.tankVariancePosting.update({
      where: { id: posting.id },
      data: { reversedAt: new Date(), reversedByUserId: userId, reverseReason: reason, reversalEntryId: reversal.id },
    });
  });
}

export async function listTankVariancePostings(tenantId: string, companyId: string, filter: { from?: string; to?: string }) {
  const postings = await prisma.tankVariancePosting.findMany({
    where: {
      tenantId, companyId,
      ...(filter.from || filter.to
        ? { closingAt: { ...(filter.from ? { gte: riyadhDayStartUtc(filter.from) } : {}), ...(filter.to ? { lt: riyadhDayEndExclusiveUtc(filter.to) } : {}) } }
        : {}),
    },
    include: { tank: { select: { id: true, code: true, product: true } } },
    orderBy: [{ closingAt: "desc" }, { postedAt: "desc" }],
    take: 500,
  });
  const entryIds = postings.flatMap((p) => [p.journalEntryId, p.reversalEntryId]).filter((id): id is string => !!id);
  const entries = await prisma.journalEntry.findMany({ where: { tenantId, companyId, id: { in: entryIds } }, select: { id: true, entryNumber: true } });
  const numberOf = new Map(entries.map((e) => [e.id, e.entryNumber]));
  return postings.map((p) => ({
    ...p,
    entryNumber: p.journalEntryId ? numberOf.get(p.journalEntryId) ?? null : null,
    reversalEntryNumber: p.reversalEntryId ? numberOf.get(p.reversalEntryId) ?? null : null,
  }));
}

