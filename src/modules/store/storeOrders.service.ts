import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict } from "../../lib/httpError";
import { getItemTotalOnHand } from "../../lib/costingEngine";
import { isQuantityTracked } from "../items/items.service";
import { PUBLIC_ITEM_SELECT, publishedWhere, type StoreContext } from "./store.service";
import { storePrice } from "./storePricing";
import { storePhone } from "./storeAuth.service";

/**
 * طلب من المتجر الإلكتروني العام. العميل يرسل أكواد الأصناف والكميات فقط؛ الخادم هو من يقرأ الصنف (منشوراً، من شركة المتجر
 * نفسها) ويحسب السعر والضريبة والإجمالي — لا يُقبَل من العميل سعر ولا اسم. الطلب تسجيل فقط: لا فاتورة ولا قيد ولا حجز
 * مخزون؛ التأكيد والدفع والتوصيل تتمّ مع العميل بعده، والفاتورة تُصدَر من أثر كأي بيع.
 */
export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 999;

export const ORDER_EMPTY = "أضف صنفاً واحداً على الأقل إلى الطلب";
export const ORDER_CUSTOMER_REQUIRED = "اكتب الاسم ورقم الجوال والمدينة";
export const ORDER_ITEMS_UNAVAILABLE = "بعض أصناف الطلب لم تعد متوفرة — حدّث السلة وأعد المحاولة";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface OrderInput {
  customer?: { name?: unknown; phone?: unknown; city?: unknown; notes?: unknown };
  lines?: { code?: unknown; quantity?: unknown }[];
}

const ORDER_SELECT = {
  number: true, status: true, customerName: true, phone: true, city: true, notes: true,
  subtotal: true, vat: true, total: true, currency: true, createdAt: true,
  lines: { select: { code: true, name: true, nameEn: true, quantity: true, unitPrice: true, priceExVat: true, lineTotal: true }, orderBy: { id: "asc" as const } },
} satisfies Prisma.StoreOrderSelect;

type OrderRow = Prisma.StoreOrderGetPayload<{ select: typeof ORDER_SELECT }>;

/** شكل الطلب كما يراه العميل — بلا معرّفات داخلية. */
export const publicOrder = (o: OrderRow) => ({
  number: o.number, status: o.status, customerName: o.customerName, phone: o.phone, city: o.city, notes: o.notes,
  subtotal: Number(o.subtotal), vat: Number(o.vat), total: Number(o.total), currency: o.currency, createdAt: o.createdAt,
  lines: o.lines.map((l) => ({ code: l.code, name: l.name, nameEn: l.nameEn, quantity: l.quantity, unitPrice: Number(l.unitPrice), priceExVat: Number(l.priceExVat), lineTotal: Number(l.lineTotal) })),
});

export async function createOrder(store: StoreContext, input: OrderInput, customerId: string | null) {
  const name = text(input.customer?.name, 80);
  const city = text(input.customer?.city, 60);
  const notes = text(input.customer?.notes, 300) || null;
  if (!name || !city || !input.customer?.phone) throw badRequest(ORDER_CUSTOMER_REQUIRED);
  const phone = storePhone(store, input.customer.phone);

  // تجميع الكميات لكل كود (الكود نفسه مرتين في الطلب = سطر واحد)
  const wanted = new Map<string, number>();
  for (const line of Array.isArray(input.lines) ? input.lines.slice(0, MAX_ORDER_LINES * 2) : []) {
    const code = text(line?.code, 100);
    const quantity = Math.floor(Number(line?.quantity));
    if (!code || !Number.isFinite(quantity) || quantity < 1) continue;
    wanted.set(code, Math.min(MAX_LINE_QUANTITY, (wanted.get(code) ?? 0) + quantity));
  }
  if (wanted.size === 0) throw badRequest(ORDER_EMPTY);
  if (wanted.size > MAX_ORDER_LINES) throw badRequest(ORDER_EMPTY);

  const items = await prisma.item.findMany({ where: { AND: [publishedWhere(store), { code: { in: [...wanted.keys()] } }] }, select: PUBLIC_ITEM_SELECT });
  const byCode = new Map(items.map((i) => [i.code, i]));
  const unavailable: string[] = [];
  for (const code of wanted.keys()) {
    const item = byCode.get(code);
    if (!item) { unavailable.push(code); continue; }
    if (isQuantityTracked(item.type) && (await getItemTotalOnHand(prisma, store.tenantId, item.id)) <= 0) unavailable.push(code);
  }
  if (unavailable.length) throw conflict(ORDER_ITEMS_UNAVAILABLE);

  const lines = [...wanted.entries()].map(([code, quantity]) => {
    const item = byCode.get(code)!;
    const price = storePrice({ salePrice: Number(item.salePrice), priceIncludesVat: item.priceIncludesVat, taxCategoryCode: item.taxCategoryCode, vatApplicable: item.vatApplicable }, store.vatRatePercent);
    return { itemId: item.id, code: item.code, name: item.name, nameEn: item.nameEn, quantity, unitPrice: price.price, priceExVat: price.priceExVat, lineTotal: round2(price.price * quantity), lineExVat: round2(price.priceExVat * quantity) };
  });
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const subtotal = round2(lines.reduce((s, l) => s + l.lineExVat, 0));

  const order = await prisma.$transaction(async (tx) => {
    // رقم الطلب من عدّاد الشركة ذرّياً داخل المعاملة — لا رقمان متساويان ولا فجوة لطلب فشل إنشاؤه
    const company = await tx.company.update({ where: { id: store.companyId }, data: { storeNextOrderSeq: { increment: 1 } }, select: { storeNextOrderSeq: true } });
    return tx.storeOrder.create({
      data: {
        tenantId: store.tenantId, companyId: store.companyId, number: company.storeNextOrderSeq - 1, customerId,
        customerName: name, phone, city, notes, subtotal, vat: round2(total - subtotal), total, currency: store.info.currency,
        lines: { create: lines.map(({ lineExVat: _drop, ...l }) => ({ ...l, tenantId: store.tenantId, companyId: store.companyId })) },
      },
      select: ORDER_SELECT,
    });
  });
  // بيانات آخر طلب تصير بيانات الحساب، فتُعبَّأ تلقائياً في الطلب التالي
  if (customerId) await prisma.storeCustomer.update({ where: { id: customerId }, data: { name, city } });
  return publicOrder(order);
}

export async function listCustomerOrders(store: StoreContext, customerId: string) {
  const orders = await prisma.storeOrder.findMany({
    where: { tenantId: store.tenantId, companyId: store.companyId, customerId },
    orderBy: { number: "desc" }, take: 50, select: ORDER_SELECT,
  });
  return orders.map(publicOrder);
}
