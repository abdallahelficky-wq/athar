import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { CASH_CUSTOMER_NAME } from "../../lib/starterData";
import { assertPeriodNotClosed, fmtDateOnly } from "../../lib/fiscalClosing";
import { createSalesInvoice } from "../salesInvoices/salesInvoices.service";
import { createReceipt } from "../receipts/receipts.service";
import { getStockBalance } from "../stockMovements/stockMovements.service";
import type { Item } from "@prisma/client";

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
  // تاريخ توريد/تسليم اختياري لبيع ميداني يُسجَّل لاحقاً — راجع normalizeSupplyDate أدناه. لا حقل
  // "date" هنا إطلاقاً: تاريخ إصدار فاتورة نقطة البيع هو دائماً وقت الخادم الفعلي (راجع
  // createPosSale)، لا حقل مُدخَل من العميل بأي شكل — pos.schemas.ts لا يعرّف هذا الحقل أصلاً.
  supplyDate?: Date;
  lines: PosLineInput[];
  payments: PosPaymentInput[];
  warehouseId?: string;
  // إلزامي فعلياً فقط حين payments فارغة (بيع آجل) — pos.schemas.ts يتحقق من هذا الشرط عبر refine.
  dueDate?: Date;
}

// نفس إزاحة UTC+3 الثابتة المستخدَمة في reportScheduler.ts (لا توقيت صيفي في السعودية طوال العام) —
// ضرورية هنا تحديداً: منتقي التاريخ في متصفح الجهاز يبني منتصف الليل بتوقيت الجهاز المحلي (KSA
// عملياً لمناديب ميدانيين داخل السعودية)، فتحويله لطابع UTC خام يقع فعلياً الساعة 21:00 من اليوم
// السابق UTC. بلا هذه الإزاحة، اختيار المندوب "اليوم" نفسه كان سيُحسَب خطأً كتراجع يوم كامل عن
// تاريخ الإصدار (وقت الخادم UTC الفعلي) في كل مرة، رغم أنه لم يُغيِّر شيئاً فعلياً.
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;

function ksaCalendarDay(date: Date): Date {
  const shifted = new Date(date.getTime() + KSA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/**
 * يتحقق من تاريخ التوريد المُدخَل (إن وُجد) ويُطبّعه: لا تواريخ مستقبلية، لا تراجع عن تاريخ
 * الإصدار بأكثر من الحد المسموح به لهذه الشركة (Company.posSupplyDateMaxBackdatingDays)، ولا يقع
 * ضمن فترة مالية مُقفلة (نفس الفحص المركزي المستخدَم لكل قيد محاسبي آخر في النظام) — هذا الفحص
 * الأخير على قيمة الحقل نفسها فقط، ولا علاقة له بالفترة التي يُرحَّل إليها القيد المحاسبي الفعلي
 * (ذلك دائماً تاريخ اليوم، راجع createPosSale، ولا يتأثر بـsupplyDate إطلاقاً).
 *
 * ملاحظة صريحة: هذا الفحص يتحقق فقط من الإقفال المحاسبي (fiscalYearClosingDate). لا مفهوم لإقرار
 * ضريبة قيمة مضافة "مُقدَّم فعلياً" مُسجَّل في أي مكان بالكود حتى الآن (بحث شامل: لا يوجد أي نموذج
 * VatReturn ولا حقل يُسجِّل انتهاء فترة ضريبية بالتقديم الفعلي — company.vatFilingFrequency في
 * dashboard.service.ts مجرد تذكير حسابي بموعد الاستحقاق القادم، لا سجل لما قُدِّم بالفعل). فتاريخ
 * توريد قد يقع في فترة ضريبية أُقفلت محاسبياً هنا يُرفَض، لكن فترة أُقفلت بالإقرار وحده بلا إقفال
 * محاسبي مطابق لن تُكتشَف بهذا الفحص — قرار مقصود بانتظار توجيه صريح، لا افتراض ضمني.
 */
/** مُصدَّرة للاختبار المباشر بلا حاجة لقاعدة بيانات — لا تلمس Prisma إطلاقاً. */
export function normalizeSupplyDate(rawSupplyDate: Date | undefined, issueDate: Date, company: { fiscalYearClosingDate: Date | null; posSupplyDateMaxBackdatingDays: number } | null): Date {
  if (!rawSupplyDate) return issueDate;

  const supplyDateOnly = ksaCalendarDay(rawSupplyDate);
  const issueDateOnly = ksaCalendarDay(issueDate);
  if (supplyDateOnly.getTime() === issueDateOnly.getTime()) return issueDate;

  if (supplyDateOnly.getTime() > issueDateOnly.getTime()) {
    throw badRequest("لا يمكن أن يكون تاريخ التوريد في المستقبل");
  }

  const maxBackdatingDays = company?.posSupplyDateMaxBackdatingDays ?? 3;
  const daysBack = Math.round((issueDateOnly.getTime() - supplyDateOnly.getTime()) / (24 * 60 * 60 * 1000));
  if (daysBack > maxBackdatingDays) {
    throw badRequest(
      `لا يمكن أن يسبق تاريخ التوريد (${fmtDateOnly(supplyDateOnly)}) تاريخ الإصدار بأكثر من ${maxBackdatingDays} يوم — راجع إعدادات الشركة لتعديل هذا الحد إن لزم`,
    );
  }

  assertPeriodNotClosed(company?.fiscalYearClosingDate, supplyDateOnly, "تسجيل تاريخ توريد بهذا التاريخ");
  return supplyDateOnly;
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
 *
 * بيع آجل (payments = []): لا يُنشأ أي سند قبض (الحلقة أدناه لا تكرَّر أصلاً)، والفاتورة تبقى
 * مُرحَّلة وبكامل قيمتها كذمة على العميل — هذا هو سلوك أي فاتورة مبيعات بلا تحصيل فوري في النظام
 * أصلاً (createSalesInvoice نفسها لا تعرف ولا تفرّق POS عن أي فاتورة أخرى). لذلك:
 * (أ) لا يُطبَّق تحقّق "تطابق مجموع الدفعات" هنا إطلاقاً (0 ضد الإجمالي كان سيفشل دائماً وهذا مقصود).
 * (ب) يُمنَع صراحة استخدام "العميل النقدي" الافتراضي — بيع آجل بلا عميل حقيقي محدَّد يُنشئ ذمة غير
 *     قابلة للتحصيل من أحد بعينه لاحقاً، فيُرفَض هنا بدل قبوله بصمت.
 */
export async function createPosSale(tenantId: string, userId: string, input: PosSaleInput) {
  const isDeferred = input.payments.length === 0;

  let customerId = input.customerId;
  if (!customerId) {
    if (isDeferred) {
      throw badRequest("البيع الآجل (على حساب العميل) يتطلب اختيار عميل حقيقي — لا يمكن استخدام العميل النقدي الافتراضي");
    }
    const cashCustomer = await prisma.customer.findFirst({
      where: { tenantId, companyId: input.companyId, name: CASH_CUSTOMER_NAME },
    });
    if (!cashCustomer) throw badRequest("تعذّر العثور على عميل نقدي افتراضي لهذه الشركة — أنشئ عميلاً أولاً");
    customerId = cashCustomer.id;
  }

  const warehouseId = await resolvePosWarehouseId(tenantId, input.companyId, input.warehouseId);

  // تاريخ إصدار فاتورة نقطة البيع هو دائماً وقت الخادم الفعلي بلا أي استثناء — لا قيمة من العميل
  // تُقبَل هنا أصلاً (pos.schemas.ts لا يعرّف حقل "date" إطلاقاً)، فمتغيّر input لا يحمله حتى.
  // إعادة توريد/فوترة زيارة ميدانية متأخرة تُسجَّل عبر supplyDate وحده، لا بتغيير هذا التاريخ.
  const date = new Date();
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, tenantId },
    select: { fiscalYearClosingDate: true, posSupplyDateMaxBackdatingDays: true },
  });
  const supplyDate = normalizeSupplyDate(input.supplyDate, date, company);

  const invoice = await createSalesInvoice(tenantId, userId, {
    companyId: input.companyId,
    customerId,
    date,
    supplyDate,
    lines: input.lines,
    post: true,
    warehouseId,
    dueDate: input.dueDate,
  });

  if (!isDeferred) {
    const grandTotal = Number(invoice.grandTotal);
    const totalPayments = input.payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(totalPayments - grandTotal) > 0.01) {
      throw badRequest(
        `مجموع طرق الدفع (${totalPayments.toFixed(2)}) لا يطابق إجمالي الفاتورة (${grandTotal.toFixed(2)}) — ` +
          `الفاتورة ${invoice.invoiceNumber} أُنشئت ورُحِّلت بالفعل، أكمل تسجيل السداد يدوياً من شاشة سندات القبض.`,
      );
    }
  }

  const receipts = [];
  for (const payment of input.payments) {
    if (payment.amount <= 0) continue;
    // تاريخ السند دائماً وقت التحصيل الفعلي (اليوم) — لا يتأثر بـsupplyDate إطلاقاً، فتحصيل الدفعة
    // يحدث الآن بصرف النظر عن تاريخ توريد البضاعة المُسجَّل على الفاتورة.
    const receipt = await createReceipt(tenantId, userId, {
      companyId: input.companyId,
      customerId,
      date,
      method: payment.method,
      bankAccountId: payment.bankAccountId,
      allocations: [{ invoiceId: invoice.id, amount: payment.amount }],
    });
    receipts.push(receipt);
  }

  return { invoice, receipts };
}

// نجلب أكثر من الحجم المطلوب من المرشَّحين قبل فلترة المخزون، لأن بعضهم سيُستبعَد لعدم توفّر رصيد
// فعلي في مستودع هذا الجهاز تحديداً — لا علاقة له بعدد التبويبات المعروضة فعلياً (limit).
const QUICK_ITEMS_CANDIDATE_MULTIPLIER = 3;

/** يُبقي فقط الأصناف ذات رصيد فعلي > 0 في المستودع المحدَّد، بترتيب المدخلات نفسه، حتى limit عنصراً
 * — مندوب المبيعات لا يجوز أن يرى في الشبكة صنفاً لا يحمله فعلياً على عربته. */
async function filterByAvailableStock(tenantId: string, warehouseId: string, items: Item[], limit: number): Promise<Item[]> {
  const result: Item[] = [];
  for (const item of items) {
    if (result.length >= limit) break;
    const balance = await getStockBalance(tenantId, item.id, warehouseId);
    if (balance > 0) result.push(item);
  }
  return result;
}

/** الأصناف الأكثر بيعاً خلال آخر 30 يوماً لهذه الشركة، مُصفّاة بتوفّر رصيد فعلي في مستودع هذا
 * الجهاز — احتياطي فقط حين لا توجد أصناف "مفضّلة" مُهيَّأة بعد لهذا المستودع تحديداً (راجع
 * getQuickAccessItems أدناه)، حتى لا تظهر شبكة فارغة أمام عميل ينتظر. */
async function bestSellingItemsWithStock(tenantId: string, companyId: string, warehouseId: string, limit: number): Promise<Item[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const grouped = await prisma.salesInvoiceLine.groupBy({
    by: ["itemId"],
    where: {
      itemId: { not: null },
      invoice: { tenantId, companyId, status: "posted", date: { gte: since } },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit * QUICK_ITEMS_CANDIDATE_MULTIPLIER,
  });

  const itemIds = grouped.map((g) => g.itemId).filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return [];

  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId, isArchived: false } });
  const byId = new Map(items.map((i) => [i.id, i]));
  // نحافظ على ترتيب الأكثر مبيعاً (groupBy) لا ترتيب findMany العشوائي
  const ordered = itemIds.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
  return filterByAvailableStock(tenantId, warehouseId, ordered, limit);
}

/**
 * شبكة الوصول السريع الرئيسية لشاشة نقطة البيع — مُخصَّصة لمستودع الجهاز المُحلَّل تحديداً
 * (resolvePosWarehouseId)، لا للشركة كلها: مناديب مختلفون على عربات مختلفة يحملون بضائع مختلفة.
 * الأولوية للأصناف "المفضّلة" التي هيّأها أحد لهذا المستودع تحديداً (posFavoriteItem)؛ إن لم يكن
 * لهذا المستودع أي مفضّلة بعد، تُستخدَم قائمة الأكثر مبيعاً كاحتياطي — كلا المصدرين يُصفّى بتوفّر
 * رصيد فعلي > 0 في نفس المستودع قبل العرض.
 */
export async function getQuickAccessItems(tenantId: string, companyId: string, warehouseId: string, limit = 12) {
  const favorites = await prisma.posFavoriteItem.findMany({
    where: { tenantId, companyId, warehouseId },
    include: { item: true },
    orderBy: { createdAt: "asc" },
  });

  if (favorites.length > 0) {
    const items = favorites.map((f) => f.item).filter((item) => !item.isArchived);
    return filterByAvailableStock(tenantId, warehouseId, items, limit);
  }

  return bestSellingItemsWithStock(tenantId, companyId, warehouseId, limit);
}

/** كل الأصناف "المفضّلة" لهذا المستودع تحديداً — لشاشة إعدادات نقطة البيع (لعرض حالة التحديد عند
 * البحث عن صنف لإضافته/إزالته من الشبكة). */
export async function listPosFavoriteItems(tenantId: string, companyId: string, warehouseId: string) {
  const favorites = await prisma.posFavoriteItem.findMany({
    where: { tenantId, companyId, warehouseId },
    include: { item: true },
    orderBy: { createdAt: "asc" },
  });
  return favorites.map((f) => f.item);
}

/** يضيف صنفاً لمفضّلات مستودع مُحدَّد — يتحقق أولاً أن المستودع والصنف كلاهما ينتميان لنفس
 * الشركة/المستأجر (دفاعي، مطابق لبقية المسارات). عملية آمنة عند التكرار (لا خطأ لو كان مُضافاً
 * أصلاً) بدل الاعتماد على معالجة استثناء قيد التفرّد. */
export async function addPosFavoriteItem(tenantId: string, companyId: string, warehouseId: string, itemId: string) {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId, companyId } });
  if (!warehouse) throw badRequest("المستودع المحدد غير موجود ضمن هذه الشركة");
  const item = await prisma.item.findFirst({ where: { id: itemId, tenantId, companyId } });
  if (!item) throw badRequest("الصنف المحدد غير موجود ضمن هذه الشركة");

  const existing = await prisma.posFavoriteItem.findFirst({ where: { warehouseId, itemId } });
  if (existing) return existing;
  return prisma.posFavoriteItem.create({ data: { tenantId, companyId, warehouseId, itemId } });
}

export async function removePosFavoriteItem(tenantId: string, warehouseId: string, itemId: string) {
  await prisma.posFavoriteItem.deleteMany({ where: { tenantId, warehouseId, itemId } });
}
