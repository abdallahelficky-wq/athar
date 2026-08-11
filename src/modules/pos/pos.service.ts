import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { CASH_CUSTOMER_NAME } from "../../lib/starterData";
import { createSalesInvoice } from "../salesInvoices/salesInvoices.service";
import { createReceipt } from "../receipts/receipts.service";

interface PosLineInput {
  accountId: string;
  itemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
  vatApplicable?: boolean;
}

interface PosPaymentInput {
  method: "cash" | "bank";
  amount: number;
  bankAccountId?: string;
}

interface PosSaleInput {
  companyId: string;
  customerId?: string;
  date: Date;
  lines: PosLineInput[];
  payments: PosPaymentInput[];
  warehouseId?: string;
}

/** يحل مستودع الخصم الفعلي لهذا الجهاز: لو أرسل الجهاز warehouseId يتحقق أنه ينتمي لهذه الشركة
 * ويستخدمه، وإلا (أول استخدام قبل ضبط الإعداد، أو جهاز قديم قبل هذه الميزة) — لو للشركة مستودع
 * واحد فقط يُستخدَم تلقائياً بلا أي اختيار يدوي، وإلا يُرفَض البيع صراحةً بدل الخصم بصمت من مكان
 * غير مقصود؛ الواجهة تمنع الوصول لشاشة الدفع أصلاً في هذه الحالة، وهذا تحقق دفاعي مطابق على الخادم. */
async function resolvePosWarehouseId(tenantId: string, companyId: string, requestedWarehouseId?: string) {
  if (requestedWarehouseId) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: requestedWarehouseId, tenantId, companyId } });
    if (!warehouse) throw badRequest("المستودع المحدد لنقطة البيع هذه لم يعد موجوداً ضمن هذه الشركة؛ أعد اختياره من إعدادات نقطة البيع");
    return warehouse.id;
  }
  const warehouses = await prisma.warehouse.findMany({ where: { tenantId, companyId } });
  if (warehouses.length === 1) return warehouses[0].id;
  throw badRequest("لم يُحدَّد المستودع المرتبط بنقطة البيع هذه بعد؛ حدّده من إعدادات نقطة البيع أولاً");
}

/**
 * يبني فاتورة مبيعات وسندات القبض الخاصة بتحصيلها الفوري (طريقة/طرق دفع متعددة لنفس الفاتورة) في
 * خطوة واحدة لنقطة البيع — يعيد استخدام createSalesInvoice/createReceipt الموجودتين بالفعل حرفياً
 * (لا منطق ترحيل/محاسبة/زاتكا/مخزون مكرَّر هنا)، فقط ينسّق بينهما: ينشئ الفاتورة مُرحَّلة أولاً
 * (فتُحسَب الضرائب/الخصومات فعلياً بمنطق الخادم لا تقديراً من الواجهة)، ثم يتحقق أن مجموع الدفعات
 * يطابقها بالضبط، ثم يُنشئ سند قبض مستقل لكل طريقة دفع (كل سند يُخصَّص بالكامل لنفس الفاتورة) —
 * نموذج Receipt الحالي لا يدعم طريقة دفع مركّبة في سطر واحد، فهذا التقسيم يطابقه بلا أي تعديل بنية.
 *
 * ملاحظة مهمة: إن فشل تطابق مجموع الدفعات، الفاتورة تكون بالفعل أُنشئت ومُرحَّلة (لا تراجع/rollback
 * عبر خدمتين منفصلتين لكل منهما معاملتها الخاصة) — نفس سلوك أي فاتورة تُرحَّل بلا سداد فوري في
 * النظام أصلاً؛ يمكن إتمام تحصيلها لاحقاً من شاشة سندات القبض العادية.
 */
export async function createPosSale(tenantId: string, userId: string, input: PosSaleInput) {
  let customerId = input.customerId;
  if (!customerId) {
    const cashCustomer = await prisma.customer.findFirst({
      where: { tenantId, companyId: input.companyId, name: CASH_CUSTOMER_NAME },
    });
    if (!cashCustomer) throw badRequest("تعذّر العثور على عميل نقدي افتراضي لهذه الشركة — أنشئ عميلاً أولاً");
    customerId = cashCustomer.id;
  }

  const warehouseId = await resolvePosWarehouseId(tenantId, input.companyId, input.warehouseId);

  const invoice = await createSalesInvoice(tenantId, userId, {
    companyId: input.companyId,
    customerId,
    date: input.date,
    lines: input.lines,
    post: true,
    warehouseId,
  });

  const grandTotal = Number(invoice.grandTotal);
  const totalPayments = input.payments.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(totalPayments - grandTotal) > 0.01) {
    throw badRequest(
      `مجموع طرق الدفع (${totalPayments.toFixed(2)}) لا يطابق إجمالي الفاتورة (${grandTotal.toFixed(2)}) — ` +
        `الفاتورة ${invoice.invoiceNumber} أُنشئت ورُحِّلت بالفعل، أكمل تسجيل السداد يدوياً من شاشة سندات القبض.`,
    );
  }

  const receipts = [];
  for (const payment of input.payments) {
    if (payment.amount <= 0) continue;
    const receipt = await createReceipt(tenantId, userId, {
      companyId: input.companyId,
      customerId,
      date: input.date,
      method: payment.method,
      bankAccountId: payment.bankAccountId,
      allocations: [{ invoiceId: invoice.id, amount: payment.amount }],
    });
    receipts.push(receipt);
  }

  return { invoice, receipts };
}

/** الأصناف الأكثر بيعاً خلال آخر 30 يوماً لهذه الشركة — لشبكة الوصول السريع في شاشة نقطة البيع. */
export async function getQuickAccessItems(tenantId: string, companyId: string, limit = 12) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const grouped = await prisma.salesInvoiceLine.groupBy({
    by: ["itemId"],
    where: {
      itemId: { not: null },
      invoice: { tenantId, companyId, status: "posted", date: { gte: since } },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });

  const itemIds = grouped.map((g) => g.itemId).filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return [];

  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId, isArchived: false } });
  const byId = new Map(items.map((i) => [i.id, i]));
  // نحافظ على ترتيب الأكثر مبيعاً (groupBy) لا ترتيب findMany العشوائي
  return itemIds.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
}
