import { prisma } from "../../lib/prisma";

/**
 * تقارير المخزون المبنية على حركات المخزون نفسها (لا على رصيد الصنف الحالي)، فتعمل لأي تاريخ:
 * - الكمية: وارد (in، transfer_in) موجب، صادر (out، issue، transfer_out) سالب، تسوية الجرد الدوري بإشارتها.
 * - القيمة: كمية × unitCost المسجَّلة على الحركة نفسها — للوارد تكلفته، وللصادر متوسط التكلفة لحظة الصرف (لقطة
 *   costingEngine.ts)، فهي نفس القيمة التي رُحِّلت على حساب المخزون. تسوية الجرد الدوري بلا قيمة (قيدها منفصل)،
 *   وأصناف الجرد الدوري لا قيمة لحظية لها (valueTracked=false) كتقرير الأرصدة الحالي.
 * - الخدمات والأصول الثابتة وغير المخزنة لا تظهر.
 */
const INBOUND = new Set(["in", "transfer_in"]);
const OUTBOUND = new Set(["out", "issue", "transfer_out"]);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function movementEffect(m: { type: string; quantity: unknown; unitCost: unknown }) {
  const qty = Number(m.quantity);
  const cost = Number(m.unitCost);
  if (INBOUND.has(m.type)) return { qty, value: qty * cost };
  if (OUTBOUND.has(m.type)) return { qty: -qty, value: -qty * cost };
  if (m.type === "adjustment") return { qty, value: 0 };
  return { qty: 0, value: 0 };
}

const STOCK_TYPES = { notIn: ["service", "fixed_asset", "non_stock"] as ("service" | "fixed_asset" | "non_stock")[] };

export interface InventoryRange {
  companyId: string;
  warehouseId?: string;
  start?: Date;
  endExclusive: Date;
}

/**
 * ملخص حركة المخزون لكل صنف في فترة: رصيد أول المدة، الوارد، الصادر، رصيد آخر المدة (كمية وقيمة)، معدل الدوران
 * وأيام التغطية، وتاريخ آخر صرف وعدد أيام الركود حتى نهاية الفترة. بلا بداية = منذ أول حركة (رصيد أول = صفر).
 */
export async function getInventoryMovementSummary(tenantId: string, range: InventoryRange) {
  const [items, movements] = await Promise.all([
    prisma.item.findMany({ where: { tenantId, companyId: range.companyId, type: { notIn: STOCK_TYPES.notIn } } }),
    prisma.stockMovement.findMany({
      where: { tenantId, companyId: range.companyId, warehouseId: range.warehouseId || undefined, date: { lt: range.endExclusive } },
      select: { itemId: true, type: true, quantity: true, unitCost: true, date: true },
    }),
  ]);
  const byItem = new Map(items.map((i) => [i.id, i]));
  type Acc = { openingQty: number; openingValue: number; inQty: number; inValue: number; outQty: number; outValue: number; adjustQty: number; lastOut: Date | null; lastIn: Date | null };
  const acc = new Map<string, Acc>();
  for (const m of movements) {
    if (!byItem.has(m.itemId)) continue;
    const a = acc.get(m.itemId) || { openingQty: 0, openingValue: 0, inQty: 0, inValue: 0, outQty: 0, outValue: 0, adjustQty: 0, lastOut: null, lastIn: null };
    const e = movementEffect(m);
    if (range.start && m.date < range.start) {
      a.openingQty += e.qty;
      a.openingValue += e.value;
    } else if (INBOUND.has(m.type)) {
      a.inQty += e.qty;
      a.inValue += e.value;
    } else if (OUTBOUND.has(m.type)) {
      a.outQty -= e.qty;
      a.outValue -= e.value;
    } else if (m.type === "adjustment") {
      a.adjustQty += e.qty;
    }
    if (OUTBOUND.has(m.type) && m.type !== "transfer_out" && (!a.lastOut || m.date > a.lastOut)) a.lastOut = m.date;
    if (INBOUND.has(m.type) && (!a.lastIn || m.date > a.lastIn)) a.lastIn = m.date;
    acc.set(m.itemId, a);
  }
  const periodDays = range.start ? Math.max(1, Math.round((range.endExclusive.getTime() - range.start.getTime()) / 86_400_000)) : null;
  const asOf = new Date(range.endExclusive.getTime() - 1);
  return [...acc.entries()]
    .map(([itemId, a]) => {
      const item = byItem.get(itemId)!;
      const valueTracked = item.type !== "periodic_inventory";
      const closingQty = a.openingQty + a.inQty - a.outQty + a.adjustQty;
      const closingValue = a.openingValue + a.inValue - a.outValue;
      const avgQty = (a.openingQty + closingQty) / 2;
      // الدوران على الكميات (يصلح لأصناف الجرد الدوري أيضاً): الصادر ÷ متوسط الرصيد
      const turnover = avgQty > 0.0001 ? a.outQty / avgQty : null;
      return {
        itemId,
        itemCode: item.code,
        itemName: item.name,
        itemNameEn: item.nameEn,
        unit: item.unit,
        valueTracked,
        openingQty: r4(a.openingQty),
        openingValue: valueTracked ? r2(a.openingValue) : null,
        inQty: r4(a.inQty),
        inValue: valueTracked ? r2(a.inValue) : null,
        outQty: r4(a.outQty),
        outValue: valueTracked ? r2(a.outValue) : null,
        adjustQty: r4(a.adjustQty),
        closingQty: r4(closingQty),
        closingValue: valueTracked ? r2(closingValue) : null,
        turnover: turnover === null ? null : r4(turnover),
        coverageDays: turnover && periodDays ? Math.round(periodDays / turnover) : null,
        lastOutDate: a.lastOut,
        lastInDate: a.lastIn,
        daysSinceLastOut: a.lastOut ? Math.floor((asOf.getTime() - a.lastOut.getTime()) / 86_400_000) : null,
      };
    })
    .filter((r) => Math.abs(r.openingQty) > 0.0001 || Math.abs(r.closingQty) > 0.0001 || r.inQty > 0.0001 || r.outQty > 0.0001)
    .sort((a, b) => String(a.itemCode).localeCompare(String(b.itemCode), undefined, { numeric: true }));
}
