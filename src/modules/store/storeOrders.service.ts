import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict } from "../../lib/httpError";
import { getItemTotalOnHand } from "../../lib/costingEngine";
import { isQuantityTracked } from "../items/items.service";
import { PUBLIC_ITEM_SELECT, publishedWhere, type StoreContext } from "./store.service";
import { storePrice } from "./storePricing";
import { storePhone } from "./storeAuth.service";
import { computeCheckout, type CheckoutCoupon } from "./storeCheckout";

/**
 * طلب من المتجر الإلكتروني العام. العميل يرسل أكواد الأصناف والكميات واختياراته (المدينة أو الاستلام، طريقة الدفع، رمز
 * الكوبون) فقط؛ الخادم هو من يقرأ الصنف (منشوراً، من شركة المتجر نفسها) ومنطقة الشحن والكوبون ويحسب كل مبلغ — لا يُقبَل
 * من العميل سعر ولا رسوم ولا خصم. الطلب تسجيل فقط: لا فاتورة ولا قيد ولا حجز مخزون ولا تحصيل؛ التأكيد والدفع والتوصيل تتمّ
 * مع العميل بعده، والفاتورة تُصدَر من أثر كأي بيع.
 */
export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 999;

export const ORDER_EMPTY = "أضف صنفاً واحداً على الأقل إلى الطلب";
export const ORDER_CUSTOMER_REQUIRED = "اكتب الاسم ورقم الجوال والمدينة";
export const ORDER_ITEMS_UNAVAILABLE = "بعض أصناف الطلب لم تعد متوفرة — حدّث السلة وأعد المحاولة";
export const ORDER_CITY_NOT_SERVED = "لا يتوفر التوصيل لهذه المدينة — اختر مدينة من القائمة";
export const ORDER_PICKUP_UNAVAILABLE = "الاستلام من المعرض غير متاح في هذا المتجر";
export const ORDER_PAYMENT_UNAVAILABLE = "طريقة الدفع المختارة غير متاحة في هذا المتجر";
export const ORDER_BELOW_MINIMUM = "قيمة الطلب أقل من الحد الأدنى للطلب في هذا المتجر";
export const COUPON_INVALID = "رمز الخصم غير صحيح أو انتهت صلاحيته";
export const COUPON_BELOW_MINIMUM = "قيمة الطلب أقل من الحد الأدنى لاستخدام رمز الخصم";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export interface OrderInput {
  customer?: { name?: unknown; phone?: unknown; city?: unknown; notes?: unknown };
  lines?: { code?: unknown; quantity?: unknown }[];
  shippingMethod?: unknown;
  paymentMethod?: unknown;
  couponCode?: unknown;
}

const ORDER_SELECT = {
  number: true, status: true, customerName: true, phone: true, city: true, notes: true,
  subtotal: true, vat: true, total: true, currency: true, createdAt: true,
  shippingMethod: true, shippingFee: true, paymentMethod: true, discountAmount: true, couponCode: true,
  lines: { select: { code: true, name: true, nameEn: true, quantity: true, unitPrice: true, priceExVat: true, lineTotal: true }, orderBy: { id: "asc" as const } },
} satisfies Prisma.StoreOrderSelect;

type OrderRow = Prisma.StoreOrderGetPayload<{ select: typeof ORDER_SELECT }>;

/** شكل الطلب كما يراه العميل — بلا معرّفات داخلية. */
export const publicOrder = (o: OrderRow) => ({
  number: o.number, status: o.status, customerName: o.customerName, phone: o.phone, city: o.city, notes: o.notes,
  subtotal: Number(o.subtotal), vat: Number(o.vat), total: Number(o.total), currency: o.currency, createdAt: o.createdAt,
  shippingMethod: o.shippingMethod, shippingFee: Number(o.shippingFee), paymentMethod: o.paymentMethod, discountAmount: Number(o.discountAmount), couponCode: o.couponCode,
  lines: o.lines.map((l) => ({ code: l.code, name: l.name, nameEn: l.nameEn, quantity: l.quantity, unitPrice: Number(l.unitPrice), priceExVat: Number(l.priceExVat), lineTotal: Number(l.lineTotal) })),
});

/** الأصناف المطلوبة بعد التحقق والتسعير من الخادم. */
async function pricedLines(store: StoreContext, raw: OrderInput["lines"]) {
  // تجميع الكميات لكل كود (الكود نفسه مرتين في الطلب = سطر واحد)
  const wanted = new Map<string, number>();
  for (const line of Array.isArray(raw) ? raw.slice(0, MAX_ORDER_LINES * 2) : []) {
    const code = text(line?.code, 100);
    const quantity = Math.floor(Number(line?.quantity));
    if (!code || !Number.isFinite(quantity) || quantity < 1) continue;
    wanted.set(code, Math.min(MAX_LINE_QUANTITY, (wanted.get(code) ?? 0) + quantity));
  }
  if (wanted.size === 0 || wanted.size > MAX_ORDER_LINES) throw badRequest(ORDER_EMPTY);

  const items = await prisma.item.findMany({ where: { AND: [publishedWhere(store), { code: { in: [...wanted.keys()] } }] }, select: PUBLIC_ITEM_SELECT });
  const byCode = new Map(items.map((i) => [i.code, i]));
  for (const code of wanted.keys()) {
    const item = byCode.get(code);
    if (!item) throw conflict(ORDER_ITEMS_UNAVAILABLE);
    if (isQuantityTracked(item.type) && (await getItemTotalOnHand(prisma, store.tenantId, item.id)) <= 0) throw conflict(ORDER_ITEMS_UNAVAILABLE);
  }
  return [...wanted.entries()].map(([code, quantity]) => {
    const item = byCode.get(code)!;
    const price = storePrice({ salePrice: Number(item.salePrice), priceIncludesVat: item.priceIncludesVat, taxCategoryCode: item.taxCategoryCode, vatApplicable: item.vatApplicable }, store.vatRatePercent);
    return { itemId: item.id, code: item.code, name: item.name, nameEn: item.nameEn, quantity, unitPrice: price.price, priceExVat: price.priceExVat, lineTotal: round2(price.price * quantity), lineExVat: round2(price.priceExVat * quantity) };
  });
}

/** الكوبون الصالح الآن في هذا المتجر — أو رفض برسالة واحدة لكل أسباب عدم الصلاحية (غير موجود، موقوف، منتهٍ، استُنفد). */
async function activeCoupon(store: StoreContext, rawCode: unknown): Promise<(CheckoutCoupon & { id: string; maxUses: number | null }) | null> {
  const code = text(rawCode, 40).toUpperCase();
  if (!code) return null;
  const coupon = await prisma.storeCoupon.findFirst({ where: { tenantId: store.tenantId, companyId: store.companyId, code, isActive: true } });
  if (!coupon) throw badRequest(COUPON_INVALID);
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw badRequest(COUPON_INVALID);
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) throw badRequest(COUPON_INVALID);
  return { id: coupon.id, code: coupon.code, type: coupon.type, value: Number(coupon.value), minOrderAmount: coupon.minOrderAmount == null ? null : Number(coupon.minOrderAmount), maxUses: coupon.maxUses };
}

/** طريقة الاستلام ورسوم الشحن: مدينة من مناطق الشحن المفعَّلة إن وُجدت مناطق، وإلا مدينة حرّة بلا رسوم. */
async function resolveShipping(store: StoreContext, method: unknown, rawCity: unknown) {
  if (method === "pickup") {
    if (!store.settings.pickupEnabled) throw badRequest(ORDER_PICKUP_UNAVAILABLE);
    return { shippingMethod: "pickup" as const, city: text(rawCity, 60), fee: 0 };
  }
  const city = text(rawCity, 60);
  const zones = await prisma.storeShippingZone.findMany({ where: { tenantId: store.tenantId, companyId: store.companyId, isActive: true }, select: { city: true, fee: true } });
  if (zones.length === 0) return { shippingMethod: "delivery" as const, city, fee: 0 };
  const zone = zones.find((z) => z.city === city);
  // مدينة لم تُختَر بعد (عرض سعر مبدئي): بلا رسوم إلى أن يختار — الطلب نفسه يشترط مدينة من القائمة
  if (!zone) return { shippingMethod: "delivery" as const, city, fee: 0, cityNotServed: true };
  return { shippingMethod: "delivery" as const, city, fee: Number(zone.fee) };
}

/** الحساب المشترك بين عرض السعر وإنشاء الطلب. */
async function evaluate(store: StoreContext, input: OrderInput) {
  const lines = await pricedLines(store, input.lines);
  const coupon = await activeCoupon(store, input.couponCode);
  const shipping = await resolveShipping(store, input.shippingMethod, input.customer?.city);
  const totals = computeCheckout({ lines, coupon, shippingFee: shipping.fee, freeShippingOver: store.settings.freeShippingOver, vatRatePercent: store.vatRatePercent });
  // كوبون صالح لكن الطلب دون حدّه الأدنى: يُرفَض بسببه، لا يُتجاهَل بصمت
  if (coupon && !totals.couponApplied) throw badRequest(COUPON_BELOW_MINIMUM);
  return { lines, coupon, shipping, totals };
}

/** عرض سعر للسلة — ما سيُسجَّل لو أُرسل الطلب الآن بهذه الاختيارات. لا يكتب شيئاً. */
export async function quoteOrder(store: StoreContext, input: OrderInput) {
  const { coupon, shipping, totals } = await evaluate(store, input);
  return {
    ...totals,
    couponCode: coupon?.code ?? null,
    shippingMethod: shipping.shippingMethod,
    cityNotServed: Boolean((shipping as { cityNotServed?: boolean }).cityNotServed),
    belowMinimum: store.settings.minOrderAmount != null && totals.itemsTotal < store.settings.minOrderAmount,
    currency: store.info.currency,
  };
}

export async function createOrder(store: StoreContext, input: OrderInput, customerId: string | null) {
  const name = text(input.customer?.name, 80);
  const notes = text(input.customer?.notes, 300) || null;
  const pickup = input.shippingMethod === "pickup";
  if (!name || !input.customer?.phone || (!pickup && !text(input.customer?.city, 60))) throw badRequest(ORDER_CUSTOMER_REQUIRED);
  const phone = storePhone(store, input.customer.phone);

  // متجر لم يفعّل أي طريقة دفع: الدفع يُتَّفق عليه مع العميل بعد الطلب (unspecified) — لا يُرفَض الطلب
  const anyPayment = store.settings.codEnabled || store.settings.bankTransferEnabled;
  const paymentMethod = !anyPayment ? "unspecified" : input.paymentMethod === "bank_transfer" ? "bank_transfer" : "cod";
  if (paymentMethod === "cod" && !store.settings.codEnabled) throw badRequest(ORDER_PAYMENT_UNAVAILABLE);
  if (paymentMethod === "bank_transfer" && !store.settings.bankTransferEnabled) throw badRequest(ORDER_PAYMENT_UNAVAILABLE);

  const { lines, coupon, shipping, totals } = await evaluate(store, input);
  if ((shipping as { cityNotServed?: boolean }).cityNotServed) throw badRequest(ORDER_CITY_NOT_SERVED);
  if (store.settings.minOrderAmount != null && totals.itemsTotal < store.settings.minOrderAmount) throw badRequest(ORDER_BELOW_MINIMUM);

  const order = await prisma.$transaction(async (tx) => {
    // استخدام الكوبون يُحسَب ذرّياً وبشرط الحدّ: طلبان متزامنان لا يتجاوزان maxUses
    if (coupon) {
      const used = await tx.storeCoupon.updateMany({
        where: { id: coupon.id, isActive: true, ...(coupon.maxUses != null ? { usedCount: { lt: coupon.maxUses } } : {}) },
        data: { usedCount: { increment: 1 } },
      });
      if (used.count !== 1) throw badRequest(COUPON_INVALID);
    }
    // رقم الطلب من عدّاد الشركة ذرّياً داخل المعاملة — لا رقمان متساويان ولا فجوة لطلب فشل إنشاؤه
    const company = await tx.company.update({ where: { id: store.companyId }, data: { storeNextOrderSeq: { increment: 1 } }, select: { storeNextOrderSeq: true } });
    return tx.storeOrder.create({
      data: {
        tenantId: store.tenantId, companyId: store.companyId, number: company.storeNextOrderSeq - 1, customerId,
        customerName: name, phone, city: shipping.city || (pickup ? "—" : ""), notes,
        subtotal: totals.subtotal, vat: totals.vat, total: totals.total, currency: store.info.currency,
        shippingMethod: shipping.shippingMethod, shippingFee: totals.shippingFee, paymentMethod,
        discountAmount: totals.discount, couponCode: coupon?.code ?? null,
        lines: { create: lines.map(({ lineExVat: _drop, ...l }) => ({ ...l, tenantId: store.tenantId, companyId: store.companyId })) },
      },
      select: ORDER_SELECT,
    });
  });
  // بيانات آخر طلب تصير بيانات الحساب، فتُعبَّأ تلقائياً في الطلب التالي
  if (customerId) await prisma.storeCustomer.update({ where: { id: customerId }, data: { name, ...(shipping.city ? { city: shipping.city } : {}) } });
  return publicOrder(order);
}

export async function listCustomerOrders(store: StoreContext, customerId: string) {
  const orders = await prisma.storeOrder.findMany({
    where: { tenantId: store.tenantId, companyId: store.companyId, customerId },
    orderBy: { number: "desc" }, take: 50, select: ORDER_SELECT,
  });
  return orders.map(publicOrder);
}
