import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { getItemTotalOnHand } from "../../lib/costingEngine";

const EPSILON = 0.01;
const QUANTITY_EPSILON = 0.0001;

export interface SettlementAdjustment {
  closingValue: number;
  netAdjustment: number;
  quantityVariance: number;
  needsJournalEntry: boolean;
  needsStockMovement: boolean;
  debitLeg: "stock" | "purchases" | null;
}

/**
 * المنطق الحسابي الخالص الكامل لتسوية صنف واحد — بلا أي قراءة/كتابة DB، ليُختبَر مباشرة ويُعاد
 * استخدامه حرفياً داخل createSettlement أدناه. راجع تعليق createSettlement للشرح المحاسبي الكامل.
 */
export function computeSettlementAdjustment(
  currentStockValue: number,
  countedQuantity: number,
  unitCost: number,
  trackedQuantity: number,
): SettlementAdjustment {
  const closingValue = countedQuantity * unitCost;
  const netAdjustment = closingValue - currentStockValue;
  const quantityVariance = countedQuantity - trackedQuantity;
  return {
    closingValue,
    netAdjustment,
    quantityVariance,
    needsJournalEntry: Math.abs(netAdjustment) > EPSILON,
    needsStockMovement: Math.abs(quantityVariance) > QUANTITY_EPSILON,
    debitLeg: Math.abs(netAdjustment) > EPSILON ? (netAdjustment > 0 ? "stock" : "purchases") : null,
  };
}

/**
 * قائمة أصناف "بضاعة بجرد دوري" المرشَّحة للتسوية — الكمية المتتبَّعة تشغيلياً (StockMovement)
 * وآخر تكلفة شراء فعلية (من آخر حركة "وارد"، لا item.lastPurchasePrice الذي لا يُحدَّث لهذا النوع
 * إطلاقاً — راجع تعليق purchaseInvoices.service.ts) كاقتراح افتراضي قابل للتعديل في الشاشة، لا أكثر.
 */
export async function listSettlementCandidates(tenantId: string, companyId: string) {
  const items = await prisma.item.findMany({
    where: { tenantId, companyId, type: "periodic_inventory", isArchived: false },
    orderBy: { name: "asc" },
  });
  return Promise.all(
    items.map(async (item) => {
      const [trackedQuantity, lastInMovement] = await Promise.all([
        getItemTotalOnHand(prisma, tenantId, item.id),
        prisma.stockMovement.findFirst({ where: { tenantId, itemId: item.id, type: "in" }, orderBy: { date: "desc" } }),
      ]);
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        trackedQuantity,
        currentStockValue: Number(item.periodicStockValue),
        suggestedUnitCost: lastInMovement ? Number(lastInMovement.unitCost) : null,
      };
    }),
  );
}

interface SettlementLineInput {
  itemId: string;
  countedQuantity: number;
  unitCost: number;
}

export interface SettlementResultLine {
  itemId: string;
  itemName: string;
  netAdjustment: number;
  quantityVariance: number;
  closingValue: number;
}

/**
 * ينشئ تسوية دفعة واحدة لعدة أصناف "بضاعة بجرد دوري" معاً بنفس التاريخ — كل صنف يُعالَج
 * باستقلالية داخل نفس المعاملة الذرّية (فشل تاريخ مُقفَل يُرجع كل الدفعة معاً، لا نصفها).
 *
 * لكل صنف: صافي الفرق = (الكمية المعدودة × تكلفة الوحدة) − periodicStockValue الحالي —
 * لو موجب: مدين stockAccountId / دائن purchasesAccountId (الصنف اكتسب قيمة مخزون أكبر).
 * لو سالب: العكس (جزء أكبر من "المشتريات" أصبح تكلفة بضاعة مباعة فعلية لهذه الفترة).
 * صفر تماماً (بحدود EPSILON) لا يُنشئ أي قيد إطلاقاً — إعادة تشغيل نفس التسوية مرة أخرى بنفس
 * الأرقام يجب ألا تُنشئ أي قيد جديد (idempotent بطبيعة الحساب لا بفحص تكرار صريح).
 *
 * بالتوازي: يُسجَّل StockMovement من نوع "adjustment" (بلا أي أثر محاسبي) بالفرق بين الكمية
 * المعدودة فعلياً والكمية المتتبَّعة تشغيلياً — يلتقط فاقداً/تلفاً غير مسجَّل بأي فاتورة، وهو
 * الغرض الحقيقي من الجرد الفعلي أصلاً.
 */
export async function createSettlement(
  tenantId: string,
  userId: string,
  companyId: string,
  date: Date,
  lines: SettlementLineInput[],
): Promise<SettlementResultLine[]> {
  const itemIds = lines.map((l) => l.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw badRequest("لا يمكن تكرار نفس الصنف أكثر من مرة في نفس التسوية");
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } });
  if (items.length !== itemIds.length) throw badRequest("أحد الأصناف المختارة غير موجود ضمن هذه الشركة");
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    if (item.type !== "periodic_inventory") {
      throw badRequest(`الصنف "${item.name}" ليس من نوع "بضاعة بجرد دوري" — لا يمكن تسويته من هذه الشاشة`);
    }
    if (!item.stockAccountId || !item.purchasesAccountId) {
      throw badRequest(`لم تُحدَّد حسابات المخزون/المشتريات للصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    }
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { tenantId, companyId, isDefault: true } });
  if (!warehouse) throw badRequest("لا يوجد مستودع افتراضي محدد لهذه الشركة؛ حدّده من شاشة المستودعات أولاً");

  return prisma.$transaction(async (tx) => {
    const results: SettlementResultLine[] = [];

    for (const line of lines) {
      const item = itemById.get(line.itemId)!;
      const trackedQuantity = await getItemTotalOnHand(tx, tenantId, item.id);
      const adj = computeSettlementAdjustment(Number(item.periodicStockValue), line.countedQuantity, line.unitCost, trackedQuantity);

      if (adj.needsJournalEntry) {
        const amount = Math.abs(adj.netAdjustment);
        const debitAccountId = adj.debitLeg === "stock" ? item.stockAccountId! : item.purchasesAccountId!;
        const creditAccountId = adj.debitLeg === "stock" ? item.purchasesAccountId! : item.stockAccountId!;
        await createJournalEntryTx(tx, {
          tenantId,
          companyId,
          date,
          memo: `تسوية جرد دوري — ${item.name}`,
          sourceModule: "periodic_inventory_settlement",
          createdBy: userId,
          lines: [
            { accountId: debitAccountId, debit: amount, credit: 0, department: "المخزون" },
            { accountId: creditAccountId, debit: 0, credit: amount, department: "المخزون" },
          ],
        });
      }

      if (adj.needsStockMovement) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            companyId,
            itemId: item.id,
            warehouseId: warehouse.id,
            type: "adjustment",
            quantity: adj.quantityVariance,
            unitCost: line.unitCost,
            date,
            note: "تسوية جرد دوري",
          },
        });
      }

      await tx.item.update({ where: { id: item.id }, data: { periodicStockValue: adj.closingValue } });

      results.push({ itemId: item.id, itemName: item.name, netAdjustment: adj.netAdjustment, quantityVariance: adj.quantityVariance, closingValue: adj.closingValue });
    }

    return results;
  });
}
