import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { ensurePartyAccount } from "../../lib/partyAccounts";
import { createSalesInvoice, deleteSalesInvoice, type LineInput } from "../salesInvoices/salesInvoices.service";

/**
 * إصدار فاتورة مبيعات من طلب متجر. الفاتورة تُنشأ **مسودة** عبر createSalesInvoice نفسها (لا قيد ولا خصم مخزون ولا
 * إرسال لزاتكا) ليراجعها المحاسب ثم يرحّلها من شاشة الفواتير بصلاحية الترحيل المعتادة.
 *  - العميل: عميل الشركة الذي يحمل رقم جوال الطلب إن وُجد، وإلا عميل فرد جديد بحسابه التفصيلي.
 *  - السطور: أصناف الطلب بأسعارها شاملة الضريبة كما سُجِّلت وقت الطلب (لا سعر الصنف الحالي)، وحساب الإيراد من الصنف.
 *  - خصم الكوبون: نسبة واحدة على سطور الأصناف (خانة الخصم في الفاتورة نسبة بخانتين عشريتين، فخصمٌ بمبلغ ثابت قد
 *    يفرق هللات عن الطلب — الفرق يُعاد للمستخدم ليعدّل المسودة).
 *  - الشحن: سطر خدمة بلا صنف على حساب إيراد يختاره المستخدم.
 */
export const ORDER_NOT_FOUND = "طلب المتجر غير موجود";
export const ORDER_CANCELLED = "الطلب ملغى — لا تُصدَر له فاتورة";
export const ORDER_ALREADY_INVOICED = "صدرت لهذا الطلب فاتورة من قبل";
export const SHIPPING_ACCOUNT_REQUIRED = "اختر حساب إيراد الشحن لإصدار فاتورة طلب فيه رسوم شحن";
export const SHIPPING_ACCOUNT_INVALID = "حساب إيراد الشحن يجب أن يكون حساب إيرادات تفصيلياً ضمن هذه الشركة";
export const SHIPPING_LINE_DESCRIPTION = "رسوم الشحن والتوصيل";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** صيغ رقم الجوال التي قد يكون العميل مسجَّلاً بها: الدولية كما في الطلب، بعلامة +، والمحلية بصفر. */
export function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set([phone, digits, `+${digits}`, `00${digits}`]);
  if (digits.startsWith("966") && digits.length === 12) variants.add(`0${digits.slice(3)}`);
  return [...variants].filter(Boolean);
}

export async function createInvoiceFromStoreOrder(tenantId: string, userId: string, orderId: string, input: { shippingAccountId?: string | null }) {
  const order = await prisma.storeOrder.findFirst({ where: { id: orderId, tenantId }, include: { lines: { orderBy: { id: "asc" } } } });
  if (!order) throw notFound(ORDER_NOT_FOUND);
  if (order.status === "cancelled") throw badRequest(ORDER_CANCELLED);
  if (order.salesInvoiceId) throw conflict(ORDER_ALREADY_INVOICED);
  const { companyId } = order;

  const shippingFee = Number(order.shippingFee);
  let shippingAccountId: string | null = null;
  if (shippingFee > 0) {
    if (!input.shippingAccountId) throw badRequest(SHIPPING_ACCOUNT_REQUIRED);
    const account = await prisma.account.findFirst({ where: { id: input.shippingAccountId, tenantId, companyId, isPosting: true, type: "revenue" }, select: { id: true } });
    if (!account) throw badRequest(SHIPPING_ACCOUNT_INVALID);
    shippingAccountId = account.id;
  }

  const itemsTotal = order.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const discount = Number(order.discountAmount);
  const discountPct = discount > 0 && itemsTotal > 0 ? Math.min(100, round2((discount / itemsTotal) * 100)) : 0;
  const lines: LineInput[] = order.lines.map((l) => ({
    // الحساب يُحَلّ من حساب إيراد الصنف داخل createSalesInvoice (resolveLineAccounts)
    accountId: "", itemId: l.itemId, description: l.name, quantity: l.quantity, unitPrice: Number(l.unitPrice), priceIncludesVat: true, discountPct,
  }));
  if (shippingAccountId) lines.push({ accountId: shippingAccountId, description: SHIPPING_LINE_DESCRIPTION, quantity: 1, unitPrice: shippingFee, priceIncludesVat: true, discountPct: 0 });

  // العميل: المطابق لرقم الجوال في الشركة نفسها، وإلا عميل فرد جديد بحسابه التفصيلي (كإنشاء عميل من شاشة العملاء)
  const existing = await prisma.customer.findFirst({ where: { tenantId, companyId, phone: { in: phoneVariants(order.phone) } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const customerId = existing?.id ?? (await prisma.$transaction(async (tx) => {
    const { accountId } = await ensurePartyAccount(tx, { tenantId, companyId, kind: "customer", partyName: order.customerName });
    const created = await tx.customer.create({
      data: { tenantId, companyId, name: order.customerName, customerType: "individual", phone: order.phone, city: order.city && order.city !== "—" ? order.city : null, accountId },
      select: { id: true },
    });
    return created.id;
  }));

  const invoice = await createSalesInvoice(tenantId, userId, {
    companyId, customerId, date: new Date(), customerReference: `طلب متجر رقم ${order.number}`, notes: order.notes, lines, post: false,
  });

  // الربط مشروط بأن الطلب ما زال بلا فاتورة: طلبان متزامنان لا يُصدران فاتورتين — الخاسر تُحذَف مسودته
  const linked = await prisma.storeOrder.updateMany({
    where: { id: order.id, tenantId, salesInvoiceId: null },
    data: { salesInvoiceId: invoice.id, ...(order.status === "new" ? { status: "confirmed" } : {}) },
  });
  if (linked.count !== 1) {
    await deleteSalesInvoice(tenantId, invoice.id);
    throw conflict(ORDER_ALREADY_INVOICED);
  }
  return {
    invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceTotal: Number(invoice.grandTotal), orderTotal: Number(order.total),
    // فرق تقريب نسبة الخصم (إن وُجد) — المستخدم يعدّل المسودة قبل الترحيل
    difference: round2(Number(invoice.grandTotal) - Number(order.total)), customerCreated: !existing,
  };
}
