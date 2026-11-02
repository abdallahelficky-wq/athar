import { Prisma, StationFuelProduct } from "@prisma/client";
import { badRequest } from "../../lib/httpError";
import type { PostingLine } from "../../lib/journalPosting";

type Tx = Prisma.TransactionClient;

export const FUEL_PRODUCT_LABEL_AR: Record<StationFuelProduct, string> = {
  gasoline_91: "بنزين 91",
  gasoline_95: "بنزين 95",
  diesel: "ديزل",
};

/** حقل الشركة الذي يحمل صنف المخزون لكل منتج وقود — ربط صريح من بيانات الشركة، لا بحث بالاسم أو الرمز. */
export const FUEL_ITEM_FIELD = {
  diesel: "stationDieselItemId",
  gasoline_91: "stationGasoline91ItemId",
  gasoline_95: "stationGasoline95ItemId",
} as const satisfies Record<StationFuelProduct, string>;

export const STATION_WAREHOUSE_MISSING = "لم يُحدَّد مستودع لهذه المحطة — اربط مستودعاً بالمحطة من إعداد المحطات قبل ترحيل الوردية";

export interface FuelIssue {
  product: StationFuelProduct;
  itemId: string;
  warehouseId: string;
  liters: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  amount: Prisma.Decimal;
}

const OUTBOUND = new Set(["out", "issue", "transfer_out"]);
const INBOUND = new Set(["in", "transfer_in"]);

/** رصيد صنف في مستودع واحد داخل المعاملة — نفس منطق الإشارة في costingEngine.getItemTotalOnHand، مقصوراً على المستودع. */
async function warehouseBalanceTx(tx: Tx, tenantId: string, companyId: string, itemId: string, warehouseId: string) {
  const sums = await tx.stockMovement.groupBy({
    by: ["type"],
    where: { tenantId, companyId, itemId, warehouseId },
    _sum: { quantity: true },
  });
  let balance = new Prisma.Decimal(0);
  for (const row of sums) {
    const qty = new Prisma.Decimal(row._sum.quantity ?? 0);
    if (INBOUND.has(row.type)) balance = balance.plus(qty);
    else if (OUTBOUND.has(row.type)) balance = balance.minus(qty);
    else if (row.type === "adjustment") balance = balance.plus(qty); // مخزَّنة بإشارتها
  }
  return balance;
}

/**
 * تكلفة البضاعة المباعة لوردية محطة — تُستدعى داخل معاملة ترحيل الوردية (postShift) فقط، بعد حجز الوردية. لكل
 * منتج بيع منه شيء: الصنف المربوط به في بيانات الشركة، ومستودع المحطة، ومتوسط التكلفة المرجّح الحالي بعد قفل صف
 * الصنف (FOR UPDATE — فاتورة شراء متزامنة تُحدِّث averageCost تنتظر انتهاء هذه المعاملة، أو تسبقها فنقرأ قيمتها
 * الجديدة)، والمبلغ = اللترات × المتوسط مقرّباً لهللتين. تُرجِع أسطر القيد (مدين تكلفة / دائن مخزون، موسومة بمركز
 * تكلفة المحطة) وحركات الصرف المطلوب إنشاؤها بعد إنشاء القيد. كل الاستعلامات مقيَّدة بالمستأجر والشركة معاً.
 *
 * ترفض (قبل أي كتابة غير حجز الوردية، فتُلغى المعاملة كلها): منتج بلا صنف مربوط، صنف غير صالح (ليس مخزوناً دائماً من
 * نفس الشركة، أو مؤرشف، أو بلا حسابي مخزون/تكلفة)، محطة بلا مستودع، متوسط تكلفة صفر، أو رصيد غير كافٍ حين تمنع
 * الشركة الرصيد السالب (allowNegativeFuelStock = false).
 */
export async function computeShiftCogsTx(
  tx: Tx,
  input: { tenantId: string; companyId: string; costCenterId: string; sales: { product: StationFuelProduct; liters: Prisma.Decimal }[] },
): Promise<{ lines: PostingLine[]; issues: FuelIssue[] }> {
  const { tenantId, companyId, costCenterId } = input;
  const sold = input.sales.filter((s) => new Prisma.Decimal(s.liters).greaterThan(0));
  if (!sold.length) return { lines: [], issues: [] };

  const company = await tx.company.findFirst({
    where: { id: companyId, tenantId },
    select: { stationDieselItemId: true, stationGasoline91ItemId: true, stationGasoline95ItemId: true, allowNegativeFuelStock: true },
  });
  if (!company) throw badRequest("الشركة غير موجودة");

  const itemIdByProduct = new Map<StationFuelProduct, string>();
  for (const s of sold) {
    const itemId = company[FUEL_ITEM_FIELD[s.product]];
    if (!itemId) {
      throw badRequest(`لم يُربَط صنف مخزون بمنتج «${FUEL_PRODUCT_LABEL_AR[s.product]}» في بيانات الشركة — اربطه من إعدادات الشركة قبل ترحيل الوردية`);
    }
    itemIdByProduct.set(s.product, itemId);
  }

  const warehouse = await tx.warehouse.findFirst({ where: { tenantId, companyId, costCenterId, isArchived: false } });
  if (!warehouse) throw badRequest(STATION_WAREHOUSE_MISSING);

  const itemIds = [...new Set(itemIdByProduct.values())];
  await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) AND "tenantId" = ${tenantId} AND "companyId" = ${companyId} FOR UPDATE`;
  const items = await tx.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lines: PostingLine[] = [];
  const issues: FuelIssue[] = [];
  for (const s of sold) {
    const label = FUEL_PRODUCT_LABEL_AR[s.product];
    const item = itemById.get(itemIdByProduct.get(s.product)!);
    if (!item || item.type !== "inventory" || item.isArchived || !item.stockAccountId || !item.cogsAccountId) {
      throw badRequest(`صنف الوقود المربوط بمنتج «${label}» في بيانات الشركة غير صالح: يجب أن يكون صنف مخزون دائم غير مؤرشف من نفس الشركة وله حسابا مخزون وتكلفة`);
    }
    const unitCost = new Prisma.Decimal(item.averageCost);
    if (!unitCost.greaterThan(0)) {
      throw badRequest(`متوسط تكلفة صنف «${label}» صفر — أدخل فاتورة شراء له قبل ترحيل الوردية حتى تُحسَب تكلفة المبيعات`);
    }
    const liters = new Prisma.Decimal(s.liters);
    if (!company.allowNegativeFuelStock) {
      const balance = await warehouseBalanceTx(tx, tenantId, companyId, item.id, warehouse.id);
      if (liters.greaterThan(balance)) {
        throw badRequest(`الكمية المباعة من «${label}» في هذه الوردية أكبر من رصيد مستودع المحطة، والرصيد السالب للوقود غير مسموح في إعدادات الشركة`);
      }
    }
    const amount = liters.times(unitCost).toDecimalPlaces(2);
    if (amount.greaterThan(0)) {
      const description = `تكلفة مبيعات ${label}`;
      lines.push({ accountId: item.cogsAccountId, costCenterId, lineDescription: description, debit: amount.toNumber(), credit: 0 });
      lines.push({ accountId: item.stockAccountId, costCenterId, lineDescription: description, debit: 0, credit: amount.toNumber() });
    }
    issues.push({ product: s.product, itemId: item.id, warehouseId: warehouse.id, liters, unitCost, amount });
  }
  return { lines, issues };
}

/** حركات صرف الوقود لوردية مرحَّلة — بعد إنشاء القيد (تحتاج معرّفه). تُحذَف كلها معاً عند عكس الوردية. */
export async function createShiftFuelIssuesTx(
  tx: Tx,
  input: { tenantId: string; companyId: string; shiftId: string; date: Date; journalEntryId: string; issues: FuelIssue[] },
) {
  for (const issue of input.issues) {
    await tx.stockMovement.create({
      data: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        itemId: issue.itemId,
        warehouseId: issue.warehouseId,
        type: "out",
        quantity: issue.liters,
        unitCost: issue.unitCost,
        date: input.date,
        note: `صرف وقود — وردية محطة (${FUEL_PRODUCT_LABEL_AR[issue.product]})`,
        journalEntryId: input.journalEntryId,
        sourceStationShiftId: input.shiftId,
      },
    });
  }
}
