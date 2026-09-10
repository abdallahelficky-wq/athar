import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";

const INBOUND = new Set(["in", "transfer_in"]);
const OUTBOUND = new Set(["out", "issue", "transfer_out"]);

export const stockReportHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const [items, movements] = await Promise.all([
    prisma.item.findMany({ where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined } }),
    prisma.stockMovement.findMany({
      where: { tenantId: req.auth!.tenantId, companyId: typeof companyId === "string" ? companyId : undefined },
      include: { warehouse: true },
    }),
  ]);

  const key = (itemId: string, warehouseId: string) => `${itemId}::${warehouseId}`;
  const balances = new Map<string, { itemId: string; warehouseId: string; warehouseName: string; quantity: number }>();

  movements.forEach((m) => {
    const k = key(m.itemId, m.warehouseId);
    const row = balances.get(k) || { itemId: m.itemId, warehouseId: m.warehouseId, warehouseName: m.warehouse.name, quantity: 0 };
    const qty = Number(m.quantity);
    // adjustment (تسوية الجرد الدوري): كمية إشارية تُضاف بإشارتها مباشرة — راجع نفس المنطق في
    // costingEngine.ts::getItemTotalOnHand.
    row.quantity += INBOUND.has(m.type) ? qty : OUTBOUND.has(m.type) ? -qty : m.type === "adjustment" ? qty : 0;
    balances.set(k, row);
  });

  // الأصناف الخدمية والأصول الثابتة وغير المخزنة (non_stock) لا تُدار كمخزون إطلاقاً ولا تظهر في
  // تقرير الأرصدة — بخلاف periodic_inventory الذي له كمية تشغيلية حقيقية لكن بلا قيمة محاسبية
  // لحظية (averageCost = 0 دائماً بتصميم)، فيظهر بكميته لكن valueTracked=false بدل قيمة صفر مضلِّلة.
  const rows = [...balances.values()]
    .filter((r) => Math.abs(r.quantity) > 0.0001)
    .map((r) => {
      const item = items.find((i) => i.id === r.itemId);
      const valueTracked = !item || item.type !== "periodic_inventory";
      return {
        itemId: r.itemId,
        itemName: item?.name || "—",
        itemCode: item?.code || "",
        unit: item?.unit || "",
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        quantity: r.quantity,
        valueTracked,
        costPrice: valueTracked ? (item ? Number(item.averageCost) : 0) : null,
        value: valueTracked ? r.quantity * (item ? Number(item.averageCost) : 0) : null,
      };
    })
    .filter((r) => {
      const item = items.find((i) => i.id === r.itemId);
      return !item || (item.type !== "service" && item.type !== "fixed_asset" && item.type !== "non_stock");
    });

  res.json(rows);
};
