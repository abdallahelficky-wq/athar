import { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

const INBOUND_TYPES = ["in", "transfer_in"] as const;
const OUTBOUND_TYPES = ["out", "issue", "transfer_out"] as const;

/** إجمالي رصيد صنف عبر كل مستودعاته (لا رصيد لكل مستودع على حدة) — متوسط التكلفة مرجّح على مستوى الصنف كله لا لكل مستودع. */
export async function getItemTotalOnHand(tx: Tx, tenantId: string, itemId: string): Promise<number> {
  const movements = await tx.stockMovement.findMany({ where: { tenantId, itemId }, select: { type: true, quantity: true } });
  return movements.reduce((sum, m) => {
    const qty = Number(m.quantity);
    if ((INBOUND_TYPES as readonly string[]).includes(m.type)) return sum + qty;
    if ((OUTBOUND_TYPES as readonly string[]).includes(m.type)) return sum - qty;
    return sum;
  }, 0);
}

/**
 * محرك المتوسط المرجّح اللحظي (Perpetual Moving Average) — يُستدعى فقط عند "استلام" كمية
 * جديدة من صنف (شراء، إدخال مخزون يدوي، تحويل وارد بين شركتين) قبل تسجيل حركة المخزون
 * المقابلة في نفس المعاملة (tx)، أبداً عند الصرف/البيع (اللي بيقرأ averageCost الحالي بس
 * كـ unitCost لقطة تاريخية، من غير ما يغيّره).
 */
export async function applyPurchaseToAverageCostTx(
  tx: Tx,
  tenantId: string,
  itemId: string,
  quantity: number,
  unitCost: number,
): Promise<{ newAverageCost: number }> {
  const item = await tx.item.findFirstOrThrow({ where: { id: itemId, tenantId } });
  const oldQty = await getItemTotalOnHand(tx, tenantId, itemId);
  const oldAvg = Number(item.averageCost);

  const newAverageCost = oldQty <= 0 ? unitCost : (oldQty * oldAvg + quantity * unitCost) / (oldQty + quantity);

  await tx.item.update({ where: { id: itemId }, data: { averageCost: newAverageCost, lastPurchasePrice: unitCost } });
  return { newAverageCost };
}

/**
 * يُعيد بناء averageCost/lastPurchasePrice من الصفر بإعادة تشغيل كل حركات "الوارد" الباقية
 * على الصنف بنفس ترتيب إنشائها الفعلي (لا ترتيب تاريخ العملية) — لازم يُستدعى بعد أي حذف
 * لحركة واردة (فك ترحيل فاتورة شراء، حذف حركة إدخال يدوي، حذف تحويل بين شركتين)، وإلا يفضل
 * averageCost محسوباً على أساس كمية لم تعد موجودة فعلياً في المخزون.
 */
export async function recomputeAverageCostFromScratchTx(tx: Tx, tenantId: string, itemId: string): Promise<void> {
  const movements = await tx.stockMovement.findMany({
    where: { tenantId, itemId },
    orderBy: { createdAt: "asc" },
    select: { type: true, quantity: true, unitCost: true },
  });

  let qty = 0;
  let avg = 0;
  let lastPurchasePrice: number | null = null;
  for (const m of movements) {
    const movementQty = Number(m.quantity);
    if ((INBOUND_TYPES as readonly string[]).includes(m.type)) {
      const unitCost = Number(m.unitCost);
      avg = qty <= 0 ? unitCost : (qty * avg + movementQty * unitCost) / (qty + movementQty);
      qty += movementQty;
      lastPurchasePrice = unitCost;
    } else if ((OUTBOUND_TYPES as readonly string[]).includes(m.type)) {
      qty -= movementQty;
    }
  }

  await tx.item.update({ where: { id: itemId }, data: { averageCost: avg, lastPurchasePrice } });
}
