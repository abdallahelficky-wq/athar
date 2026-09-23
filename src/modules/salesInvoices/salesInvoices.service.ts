import { withInvoiceCredits } from "../../lib/invoiceCredits";
import { randomUUID } from "crypto";
import { Item, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeInvoiceLine, invoiceTypeForCustomer } from "../../lib/invoiceLine";
import { buildZatcaQrPayload } from "../../lib/zatcaQr";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { getStockBalance } from "../stockMovements/stockMovements.service";
import { isValueTrackedInLedger, isQuantityTracked } from "../items/items.service";
import { reserveZatcaChainForPosting, submitZatcaChainDocument, ZatcaPostingDecision } from "../../lib/zatca/postingGate";
import { reserveZatcaChain, rebuildZatcaDocumentXml, ZatcaCompanyLike, ZatcaCustomerLike, ZatcaPersistedLineLike } from "../../lib/zatca/chain";
import { newQueryCounter, counted, logPostingPhaseTiming } from "../../lib/zatca/postingInstrumentation";
import { resubmitZatcaDocument } from "../../lib/zatca/resubmit";
import { sendInvoiceByEmail, SendInvoiceEmailResult } from "./salesInvoiceEmail.service";
import { accrueTrainerCommissionsTx, reverseTrainerCommissionsTx } from "../stables/stablesBilling.service";

type Tx = Prisma.TransactionClient;

export interface LineInput {
  accountId: string;
  itemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  priceIncludesVat?: boolean;
  vatApplicable?: boolean;
}

interface InvoiceInput {
  companyId: string;
  customerId: string;
  branchId?: string | null;
  date: Date;
  // حقول اختيارية بحتة (شريط معلومات الفاتورة لبعض القوالب) — لا تأثير محاسبي/ضريبي لها إطلاقاً
  dueDate?: Date | null;
  customerReference?: string;
  poNumber?: string;
  salesperson?: string;
  otherId?: string;
  lines: LineInput[];
  post?: boolean;
  // مستودع محدَّد صراحةً (مثلاً من إعدادات جهاز نقطة بيع) يتجاوز مستودع الشركة الافتراضي —
  // اختياري: الفواتير العادية (شاشة فواتير المبيعات) تستمر باستخدام المستودع الافتراضي كما هي.
  warehouseId?: string;
  // سجلات تدقيق لتعديلات سعر الوحدة اليدوية في نقطة البيع (posPriceOverride) — يملأها pos.service.ts
  // فقط بعد التحقق من الصلاحية؛ فواتير المبيعات العادية لا تمرّرها إطلاقاً فتبقى []. تُكتَب داخل نفس
  // معاملة إنشاء الفاتورة (المرحلة 1) حتى لا يُفقَد تعديل سعر أبداً حتى لو حدث خطأ لاحقاً غير محاسبي.
  priceOverridesToAudit?: Array<{ itemId: string; originalPrice: number; newPrice: number }>;
}

async function writePriceOverrideAuditLogsTx(
  tx: Tx,
  tenantId: string,
  userId: string,
  invoiceId: string,
  overrides: Array<{ itemId: string; originalPrice: number; newPrice: number }> | undefined,
) {
  if (!overrides?.length) return;
  await tx.auditLog.createMany({
    data: overrides.map((o) => ({
      tenantId,
      userId,
      action: "pos_sale.price_override",
      entityType: "SalesInvoice",
      entityId: invoiceId,
      metadata: { itemId: o.itemId, originalPrice: o.originalPrice, newPrice: o.newPrice } as Prisma.InputJsonValue,
    })),
  });
}

/** يحل المستودع الفعلي المطلوب خصم المخزون منه: المستودع المُمرَّر صراحةً (بعد التحقق أنه ينتمي
 * لنفس الشركة/المستأجر) وإلا المستودع الافتراضي للشركة — بنفس رسالة الخطأ القديمة حرفياً في حالة
 * عدم التمرير، حتى لا يتغيّر سلوك أي مسار حالي لا يمرّر warehouseId. */
export async function resolveWarehouse(tx: Tx | typeof prisma, tenantId: string, companyId: string, warehouseId?: string) {
  if (warehouseId) {
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, tenantId, companyId } });
    if (!warehouse) throw badRequest("المستودع المحدد غير موجود ضمن هذه الشركة");
    return warehouse;
  }
  const warehouse = await tx.warehouse.findFirst({ where: { tenantId, companyId, isDefault: true } });
  if (!warehouse) throw badRequest("لا يوجد مستودع افتراضي محدد لهذه الشركة؛ حدّده من شاشة المستودعات أولاً");
  return warehouse;
}

export const invoiceInclude = {
  lines: { include: { account: true, item: true } },
  customer: true,
  company: true,
  branch: true,
  receiptAllocations: true,
  // آخر محاولة إرسال بالإيميل فقط (نجحت أو فشلت) — تُستخدَم لعرض "آخر إرسال: ..." في شاشة الفاتورة.
  emailLogs: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

type InvoiceWithZatcaChain = Prisma.SalesInvoiceGetPayload<{ include: typeof invoiceInclude }>;

/**
 * شكل إعادة موحَّد لكل نتائج مسارات الترحيل (create/post/retry/complete) — كل حقول الفاتورة
 * دائماً موجودة (id/invoiceNumber/...) بصرف النظر عن أي مرحلة توقَّف عندها التنفيذ فعلياً؛ الحقول
 * الإضافية اختيارية بحسب ما حدث تحديداً (رفض من زاتكا، أو نجاح استلام الردّ لكن تعذّر إكمال
 * الترحيل المحلي). بلا هذا التوحيد الصريح، كل return مختلف الشكل قليلاً يُنتِج اتحاداً (union) لا
 * يضمن لمستدعٍ مثل pos.service.ts وجود .id على الإطلاق.
 */
type InvoicePostingOutcome = ReturnType<typeof withPaymentStatus<InvoiceWithZatcaChain>> & {
  emailResult?: SendInvoiceEmailResult;
  rejectionReason?: string;
  postingIncomplete?: boolean;
};

function computeLines(lines: LineInput[]) {
  const computed = lines.map((l) => ({
    ...l,
    ...computeInvoiceLine(l),
    // فئة الضريبة القياسية لزاتكا (S/O) تُشتق من vatApplicable الحالي — لا حقل إدخال جديد بعد.
    taxCategoryCode: l.vatApplicable === false ? ("O" as const) : ("S" as const),
    taxExemptionReason: null as string | null,
  }));
  const subtotal = computed.reduce((s, l) => s + l.subtotal, 0);
  const vatTotal = computed.reduce((s, l) => s + l.vat, 0);
  const grandTotal = subtotal + vatTotal;
  return { computed, subtotal, vatTotal, grandTotal };
}

/**
 * الحساب المحاسبي المرتبط بكل صنف يُحدَّد من شاشة الصنف نفسها (revenueAccountId) لا من
 * الفاتورة — أي accountId يرسله العميل لسطر مرتبط بصنف يُتجاهَل ويُستبدَل. الأسطر بلا itemId
 * (وصف حر) تحتفظ بالـ accountId اليدوي كما هو.
 */
async function resolveLineAccounts(tenantId: string, companyId: string, lines: LineInput[]): Promise<LineInput[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } }) : [];
  if (items.length !== itemIds.length) throw badRequest("أحد الأصناف المختارة غير موجود ضمن هذه الشركة");
  const itemById = new Map(items.map((i) => [i.id, i]));

  return lines.map((line) => {
    if (!line.itemId) return line;
    const item = itemById.get(line.itemId)!;
    if (item.type === "expense") throw badRequest(`الصنف "${item.name}" من نوع مصروف، لا يمكن بيعه`);
    if (item.type === "fixed_asset") throw badRequest(`الصنف "${item.name}" أصل ثابت، لا يُباع عبر فاتورة مبيعات`);
    if (item.type === "raw_material" && !item.allowDirectSale) throw badRequest(`الصنف "${item.name}" مادة أولية غير مسموح ببيعها منفردة`);
    if (!item.revenueAccountId) throw badRequest(`لم يُحدَّد حساب الإيراد المرتبط بالصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    return { ...line, accountId: item.revenueAccountId };
  });
}

export async function assertRefs(tenantId: string, companyId: string, customerId: string, lines: LineInput[], branchId?: string | null) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId, companyId } });
  if (!customer) throw badRequest("العميل غير موجود ضمن هذه الشركة");
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId, companyId } });
    if (!branch) throw badRequest("الفرع المحدد غير موجود ضمن هذه الشركة");
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId, type: "revenue", isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد حسابات الإيراد المختارة غير صالح");
  return { company, customer };
}

/**
 * يبني سطور قيد تكلفة البضاعة المباعة (لو فيه أصناف مخزونية بالفاتورة)، ويتحقق من كفاية الرصيد قبل
 * الترحيل — لا يكتب أي شيء لقاعدة البيانات، للاستدعاء قبل بناء القيد. يُعيد أيضاً خريطة الأصناف
 * التي جلبها (itemById) ليعيد استخدامها createStockOutSideEffectsTx لاحقاً بدل إعادة جلبها صنفاً
 * صنفاً داخل المعاملة النهائية — كانت تلك القراءات المتكرِّرة داخل المعاملة (بلا أي نداء شبكي حتى)
 * تُطيل مدة حجز القفل بلا داعٍ فعلي، والبيانات نفسها مجلوبة هنا أصلاً قبل أي كتابة.
 */
export async function computeCogsJournalLines(tenantId: string, companyId: string, lines: LineInput[], warehouseId?: string) {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  if (!itemIds.length) return { cogsLines: [], itemById: new Map<string, Item>() };
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, tenantId, companyId } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  // periodic_inventory مستثنى عمداً هنا (isValueTrackedInLedger لا isQuantityTracked): بلا قيد تكلفة
  // وبلا فحص كفاية رصيد إطلاقاً لهذا النوع — راجع دليله في items.schemas.ts.
  const stockLines = lines.filter((l) => l.itemId && isValueTrackedInLedger(itemById.get(l.itemId)!.type));
  if (!stockLines.length) return { cogsLines: [], itemById };

  const warehouse = await resolveWarehouse(prisma, tenantId, companyId, warehouseId);

  // يجب تجميع الكمية الإجمالية المطلوبة لكل صنف عبر كل أسطر الفاتورة قبل مقارنتها بالرصيد —
  // وإلا فسطران لنفس الصنف يمكن أن يتجاوزا الرصيد المتاح مجتمعين رغم أن كل سطر بمفرده يبدو
  // صالحاً عند مقارنته منفرداً بنفس الرصيد (الذي لم يتغيّر بعد لأن الفاتورة لم تُحفَظ بعد).
  const totalQtyByItem = new Map<string, number>();
  for (const line of stockLines) {
    totalQtyByItem.set(line.itemId!, (totalQtyByItem.get(line.itemId!) || 0) + line.quantity);
  }
  for (const [itemId, totalQty] of totalQtyByItem) {
    const item = itemById.get(itemId)!;
    const balance = await getStockBalance(tenantId, itemId, warehouse.id);
    if (totalQty > balance) throw badRequest(`الكمية الإجمالية المطلوبة من "${item.name}" (${totalQty}) أكبر من الرصيد المتاح (${balance})`);
  }

  const byAccount = new Map<string, { debit: number; credit: number }>();
  const add = (accountId: string, debit: number, credit: number) => {
    const cur = byAccount.get(accountId) || { debit: 0, credit: 0 };
    byAccount.set(accountId, { debit: cur.debit + debit, credit: cur.credit + credit });
  };

  for (const line of stockLines) {
    const item = itemById.get(line.itemId!)!;
    if (!item.cogsAccountId || !item.stockAccountId) {
      throw badRequest(`لم تُحدَّد حسابات المخزون/التكلفة للصنف "${item.name}" بعد؛ أكمل بياناته من شاشة الأصناف أولاً`);
    }
    const amount = line.quantity * Number(item.averageCost);
    add(item.cogsAccountId, amount, 0);
    add(item.stockAccountId, 0, amount);
  }

  const cogsLines = [...byAccount.entries()].map(([accountId, { debit, credit }]) => ({ accountId, department: "المبيعات والتسويق", debit, credit }));
  return { cogsLines, itemById };
}

/**
 * يُنشئ حركة "صرف" مخزنية لكل سطر فاتورة مرتبط بصنف مخزوني — يُستدعى بعد حفظ الفاتورة فعلياً
 * (يحتاج line.id). يأخذ itemById جاهزة (من computeCogsJournalLines، مجلوبة أصلاً قبل فتح هذه
 * المعاملة) بدل إعادة جلب كل صنف على حدة هنا — كانت هذه القراءات المتكرِّرة صنفاً صنفاً داخل
 * المعاملة (N قراءة لكل فاتورة N سطر) تُطيل مدة حجز القفل على صف الشركة بلا أي داعٍ فعلي، لبيانات
 * مجلوبة أصلاً بالكامل قبل فتح المعاملة. فائدة إضافية: averageCost المُستخدَمة هنا الآن نفسها
 * تماماً المُستخدَمة في حساب قيد التكلفة (computeCogsJournalLines) — قبل هذا التعديل كانت قراءة
 * منفصلة لاحقة هنا قد تلتقط قيمة averageCost أحدث (لو تغيّرت بين اللحظتين)، فتُخزَّن على حركة
 * المخزون قيمة تختلف عمّا رُحِّل فعلياً في القيد المحاسبي.
 */
export async function createStockOutSideEffectsTx(
  tx: Tx,
  tenantId: string,
  companyId: string,
  date: Date,
  persistedLines: Array<{ id: string; itemId: string | null; quantity: Prisma.Decimal }>,
  journalEntryId: string,
  itemById: Map<string, Item>,
  warehouseId?: string,
) {
  const itemIds = persistedLines.map((l) => l.itemId).filter((x): x is string => Boolean(x));
  if (!itemIds.length) return;
  const warehouse = await resolveWarehouse(tx, tenantId, companyId, warehouseId);

  for (const line of persistedLines) {
    if (!line.itemId) continue;
    const item = itemById.get(line.itemId);
    if (!item) throw badRequest(`أحد أصناف الفاتورة (${line.itemId}) غير موجود ضمن هذه الشركة`);
    // periodic_inventory يصل هنا فعلاً (isQuantityTracked لا isValueTrackedInLedger) — حركة "صادر"
    // تشغيلية بحتة لتتبّع الكمية فقط، unitCost يبقى 0 دائماً لأن averageCost لا يُحدَّث لهذا النوع.
    if (!isQuantityTracked(item.type)) continue;
    await tx.stockMovement.create({
      data: {
        tenantId, companyId, itemId: item.id, warehouseId: warehouse.id, type: "out",
        quantity: line.quantity, unitCost: item.averageCost, date, journalEntryId, sourceSalesInvoiceLineId: line.id,
      },
    });
  }
}

async function removeStockOutSideEffectsTx(tx: Tx, invoiceId: string) {
  const lineIds = (await tx.salesInvoiceLine.findMany({ where: { invoiceId }, select: { id: true } })).map((l) => l.id);
  if (!lineIds.length) return;
  await tx.stockMovement.deleteMany({ where: { sourceSalesInvoiceLineId: { in: lineIds } } });
}

// كلا الإجراءين أدناه أصبحا تاريخيَّين فقط منذ postingPipeline.ts (راجع تعليقها): الصف المحاسبي
// يُكتَب فعلياً في المرحلة 1 *قبل* أي اتصال بزاتكا وبرقم مستند حقيقي دائماً — فلا "فجوة سلسلة"
// (رقم حُجز والصف لم يُكتَب قط) ولا "فجوة ترقيم" (رقم حُجز فاتورة رُفضت فلم تُكتَب) يمكن أن تقعا
// بنيوياً بعد اليوم لهذا المسار. الثابتان يبقيان فقط ليقرأهما listZatcaChainGaps أدناه — لعرض
// حوادث تاريخية سُجِّلت فعلياً قبل هذا الإصلاح (وهذه بالتحديد الحادثة التي دفعت إليه) — لا يُكتب
// إليهما أي صفّ جديد بعد اليوم.
const ZATCA_CHAIN_GAP_ACTION = "zatca.chain_gap";
const ZATCA_INVOICE_NUMBER_GAP_ACTION = "zatca.invoice_number_gap";

/**
 * تسجيل عادي (لا صاخب — راجع الفرق مع recordZatcaChainGap أعلاه) لرقم فاتورة "محروق": رقم حُجز
 * فعلياً لفاتورة قياسية (B2B) رفضتها زاتكا قبل أي كتابة، فلن تُنشَأ الفاتورة إطلاقاً بهذا الرقم —
 * فجوة في تسلسل الترقيم مقبولة تماماً (راجع التعليق في createSalesInvoice) لكنها يجب أن تكون
 * قابلة للتفسير عند أي تدقيق: رقم مفقود في التسلسل بلا أي سجل يفسِّره غير مقبول، بخلاف رقم مفقود
 * موثَّق برفض زاتكا وسببه. رفض زاتكا نتيجة متوقَّعة من العمل العادي، لا عطلاً — لذا console.info لا
 * console.error، لكن بسطر مميَّز قابل للبحث فوراً مثل فجوة السلسلة تماماً.
 */
/**
 * قائمة "فجوات" مستندات زاتكا المُسجَّلة تاريخياً لهذا المستأجر (راجع تعليق الثابتين أعلاه — لا
 * يُكتَب صفّ جديد إليها بعد اليوم، تبقى فقط لعرض حوادث سابقة). نوعان بحسب type: "chain_gap" (فجوة
 * سلسلة ICV/PIH) و"invoice_number_gap" (رقم فاتورة محروق برفض زاتكا).
 */
export async function listZatcaChainGaps(tenantId: string) {
  const gaps = await prisma.auditLog.findMany({
    where: { tenantId, action: { in: [ZATCA_CHAIN_GAP_ACTION, ZATCA_INVOICE_NUMBER_GAP_ACTION] } },
    orderBy: { createdAt: "desc" },
  });
  return gaps.map((g) => ({
    id: g.id,
    type: g.action === ZATCA_CHAIN_GAP_ACTION ? ("chain_gap" as const) : ("invoice_number_gap" as const),
    createdAt: g.createdAt,
    ...(g.metadata as Record<string, unknown>),
  }));
}

function paidAmountOf(invoice: { receiptAllocations: { amount: unknown }[] }) {
  return invoice.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
}

function paymentStatusOf(grandTotal: number, paid: number) {
  if (paid >= grandTotal - 0.5) return "مسددة";
  if (paid > 0) return "مسددة جزئياً";
  return "غير مسددة";
}

export function withPaymentStatus<T extends { grandTotal: unknown; receiptAllocations: { amount: unknown }[] }>(invoice: T) {
  const paid = paidAmountOf(invoice);
  return { ...invoice, paidAmount: paid, paymentStatus: paymentStatusOf(Number(invoice.grandTotal), paid) };
}

export async function listSalesInvoices(tenantId: string, filters: { companyId?: string; customerId?: string }) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, customerId: filters.customerId || undefined },
    include: invoiceInclude,
    orderBy: { createdAt: "desc" },
  });
  return withInvoiceCredits(tenantId, invoices);
}

// حالات زاتكا التي تعني أن الفاتورة لم تُبلَّغ/تُخلَّص بنجاح بعد — إما لا تزال قيد المحاولة الأولى
// (pending_*) أو فشلت (رُفضت صراحةً، تعذّر الوصول لزاتكا أصلاً، أو تعذّر توقيعها محلياً بشهادة
// غير صالحة). تُستخدَم فقط لعرض قائمة متابعة للمستخدم — لا تُغيّر أي سلوك ترحيل. certificate_error
// مُدرَجة عمداً هنا (نفس القائمة) لا في قائمة منفصلة — كل صف يحمل zatcaStatus الفعلي، فيبقى
// الفرق بين "انتظر" (submission_failed/pending_*، قد يُحَل نفسه) و"اذهب أصلِح الربط"
// (certificate_error، لن يُحَل نفسه أبداً) مرئياً بوضوح لمن يراجع هذه القائمة. compliance_checked
// مُدرَجة أيضاً — لم تُخلَّص/تُبلَّغ فعلياً (الشركة لا تزال على شهادة اختبار)، تحتاج الشركة استكمال
// الحصول على شهادة إنتاج فعلية، لا مجرد إعادة إرسال.
const ZATCA_BACKLOG_STATUSES = [
  "not_submitted",
  "rejected",
  "submission_failed",
  "certificate_error",
  "compliance_checked",
] as const;

/**
 * قائمة الفواتير التي لم تُبلَّغ/تُخلَّص بنجاح لدى زاتكا بعد — لمتابعة أي فاتورة قد لا تصل إليها
 * إطلاقاً (خصوصاً بعد معالجة تعذّر الاتصال بالشبكة بترحيلها بدل إسقاطها، راجع submission_failed)،
 * أو تعطّلت بسبب شهادة زاتكا غير صالحة (certificate_error) وتحتاج إصلاح الربط نفسه لا مجرد انتظار.
 */
export async function listZatcaBacklog(tenantId: string, filters: { companyId?: string }) {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      status: "posted",
      zatcaStatus: { in: [...ZATCA_BACKLOG_STATUSES] },
    },
    select: { id: true, invoiceNumber: true, date: true, grandTotal: true, zatcaStatus: true, zatcaSubmittedAt: true },
    orderBy: { date: "asc" },
  });
  const now = Date.now();
  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    grandTotal: inv.grandTotal,
    zatcaStatus: inv.zatcaStatus,
    ageDays: Math.floor((now - (inv.zatcaSubmittedAt ?? inv.date).getTime()) / (1000 * 60 * 60 * 24)),
  }));
}

export async function getSalesInvoice(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  return (await withInvoiceCredits(tenantId, [invoice]))[0];
}

export async function buildJournalLines(
  tenantId: string,
  companyId: string,
  customer: { id: string; accountId: string | null },
  computed: Array<LineInput & { subtotal: number; vat: number; total: number }>,
  vatTotal: number,
  grandTotal: number,
  cogsLines: Array<{ accountId: string; department: string; debit: number; credit: number }> = [],
) {
  const customerId = customer.id;
  const vatOutputId = await getAccountIdByName(tenantId, companyId, "ضريبة القيمة المضافة - مخرجات");
  const receivableId = await resolvePartyAccountId(tenantId, companyId, customer, "ذمم مدينة");
  const byAccount = new Map<string, number>();
  computed.forEach((l) => byAccount.set(l.accountId, (byAccount.get(l.accountId) || 0) + l.subtotal));

  return [
    ...[...byAccount.entries()].map(([accountId, amount]) => ({
      accountId, department: "المبيعات والتسويق", debit: 0, credit: amount, customerId,
    })),
    { accountId: vatOutputId, department: "المالية والحسابات", debit: 0, credit: vatTotal, customerId },
    { accountId: receivableId, department: "المالية والحسابات", debit: grandTotal, credit: 0, customerId },
    ...cogsLines,
  ];
}

export async function createSalesInvoice(tenantId: string, userId: string, input: InvoiceInput): Promise<InvoicePostingOutcome> {
  input = { ...input, lines: await resolveLineAccounts(tenantId, input.companyId, input.lines) };
  const { customer, company } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines, input.branchId);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");

  const invType = invoiceTypeForCustomer(customer);
  const qrPayload = buildZatcaQrPayload(
    company.name,
    company.vatNumber || "",
    `${input.date.toISOString().slice(0, 10)}T12:00:00`,
    grandTotal,
    vatTotal,
  );

  const shouldPost = input.post !== false;

  if (!shouldPost) {
    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await reserveDocumentNumber(tx, tenantId, input.companyId, "sales_invoice");
      return tx.salesInvoice.create({
        data: {
          tenantId,
          invoiceNumber,
          companyId: input.companyId,
          customerId: input.customerId,
          branchId: input.branchId || undefined,
          date: input.date,
          dueDate: input.dueDate || undefined,
          customerReference: input.customerReference,
          poNumber: input.poNumber,
          salesperson: input.salesperson,
          otherId: input.otherId,
          invoiceType: invType,
          status: "draft",
          qrPayload,
          subtotal,
          vatTotal,
          grandTotal,
          lines: { create: computed },
        },
        include: invoiceInclude,
      });
    });
    return withPaymentStatus(invoice);
  }

  const { cogsLines, itemById } = await computeCogsJournalLines(tenantId, input.companyId, input.lines, input.warehouseId);
  const journalLines = await buildJournalLines(tenantId, input.companyId, customer, computed, vatTotal, grandTotal, cogsLines);
  const zatcaUuid = randomUUID();
  const zatcaLines = computed.map((l) => ({ ...l, description: l.description ?? null }));

  // المرحلة 1 — معاملة قصيرة واحدة فقط: تحجز رقم الفاتورة وسلسلة ICV/PIH (بلا أي اتصال شبكي
  // بزاتكا هنا إطلاقاً) وتكتب صفّ الفاتورة وسطورها فوراً — بحالة pending_submission إن كانت
  // زاتكا ستُستدعى بعدها، أو posted مباشرة إن لم تنطبق زاتكا على هذه الشركة أصلاً. رقم الفاتورة
  // وUUID وICV والتجزئة تُكتَب على الصف *قبل* أي محاولة اتصال فعلي بزاتكا — فلا يمكن بعد اليوم أن
  // يُحجَز رقم/سلسلة بلا أن يقابلها صفّ حقيقي (راجع تعليق ZATCA_CHAIN_GAP_ACTION أعلاه).
  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; invoice: ReturnType<typeof withPaymentStatus<InvoiceWithZatcaChain>> } | { kind: "pending"; invoice: InvoiceWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await counted(counter1, reserveDocumentNumber(tx, tenantId, input.companyId, "sales_invoice"));
      const chain = await counted(
        counter1,
        reserveZatcaChain(tx, { company, customer, kind: "invoice", documentNumber: invoiceNumber, documentUuid: zatcaUuid, lines: zatcaLines }),
      );
      const baseData = {
        tenantId,
        invoiceNumber,
        companyId: input.companyId,
        customerId: input.customerId,
        branchId: input.branchId || undefined,
        date: input.date,
        dueDate: input.dueDate || undefined,
        customerReference: input.customerReference,
        poNumber: input.poNumber,
        salesperson: input.salesperson,
        otherId: input.otherId,
        invoiceType: invType,
        qrPayload,
        zatcaUuid,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      };
      if (!chain) {
        // زاتكا لا تنطبق على هذه الشركة بعد (not_onboarded) — لا داعي لأي مرحلة لاحقة، الترحيل
        // الكامل (قيد + مخزون + عمولات) يحدث الآن مباشرة، تماماً كما كان يحدث سابقاً في هذه الحالة.
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: input.companyId, branchId: input.branchId || undefined, date: input.date,
          memo: `فاتورة مبيعات ${invoiceNumber} — ${customer.name}`, sourceModule: "sales_invoice", createdBy: userId, lines: journalLines,
        }));
        const invoice = await counted(counter1, tx.salesInvoice.create({
          data: { ...baseData, status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" },
          include: invoiceInclude,
        }));
        await counted(counter1, tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: invoice.id } }));
        await counted(counter1, createStockOutSideEffectsTx(tx, tenantId, input.companyId, input.date, invoice.lines, entry.id, itemById, input.warehouseId));
        await counted(counter1, accrueTrainerCommissionsTx(tx, tenantId, input.companyId, invoice.id, userId));
        await writePriceOverrideAuditLogsTx(tx, tenantId, userId, invoice.id, input.priceOverridesToAudit);
        return { kind: "done" as const, invoice: withPaymentStatus(invoice) };
      }
      const invoice = await counted(counter1, tx.salesInvoice.create({
        data: {
          ...baseData,
          status: "pending_submission",
          icv: chain.icv,
          previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash,
          zatcaStatus: "not_submitted",
          zatcaSubmittedAt: chain.issuedAt,
        },
        include: invoiceInclude,
      }));
      await writePriceOverrideAuditLogsTx(tx, tenantId, userId, invoice.id, input.priceOverridesToAudit);
      return { kind: "pending" as const, invoice, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "invoice", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") {
    const emailResult = await sendInvoiceByEmail(tenantId, phase1.invoice.id, { method: "auto" });
    return { ...phase1.invoice, emailResult };
  }

  return finishInvoiceZatcaSubmission(tenantId, userId, {
    invoice: phase1.invoice, xml: phase1.xml, subtype: phase1.subtype, company,
    grandTotal, vatTotal, journalLines, itemById, warehouseId: input.warehouseId, sendEmail: true,
  });
}

/**
 * المرحلتان 2 (لا معاملة — الاتصال الفعلي بزاتكا) و3أ (تحديث سطر واحد فقط، فوراً بعد الرد، لا
 * عمل آخر معه إطلاقاً حتى يستحيل انتهاء مهلته) و3ب (معاملة منفصلة قصيرة: القيد + المخزون +
 * العمولات + الحالة النهائية، فقط لو كان يجب الترحيل فعلياً). مُشتركة بين createSalesInvoice
 * وpostSalesInvoice وretryPendingZatcaSubmission — الفرق الوحيد بينها هو من أين يأتي xml/subtype
 * (بناء طازج من reserveZatcaChain، أو إعادة بناء من rebuildZatcaDocumentXml لمستند مُعاد محاولته).
 */
async function finishInvoiceZatcaSubmission(
  tenantId: string,
  userId: string,
  params: {
    invoice: InvoiceWithZatcaChain;
    xml: string;
    subtype: "standard" | "simplified";
    company: ZatcaCompanyLike;
    grandTotal: number;
    vatTotal: number;
    journalLines: Awaited<ReturnType<typeof buildJournalLines>>;
    itemById: Map<string, Item>;
    warehouseId: string | undefined;
    sendEmail: boolean;
  },
): Promise<InvoicePostingOutcome> {
  const { invoice, xml, subtype, company, grandTotal, vatTotal, journalLines, itemById, warehouseId, sendEmail } = params;

  // المرحلة 2 — بلا أي معاملة قاعدة بيانات مفتوحة إطلاقاً.
  const decision = await submitZatcaChainDocument({
    company,
    documentNumber: invoice.invoiceNumber,
    documentUuid: invoice.zatcaUuid,
    kind: "invoice",
    chain: {
      xml,
      subtype,
      icv: invoice.icv!,
      previousInvoiceHash: invoice.previousInvoiceHash!,
      invoiceHash: invoice.invoiceHash!,
      issuedAt: invoice.zatcaSubmittedAt!,
    },
    grandTotal,
    vatTotal,
  });

  // المرحلة 3أ — تحديث سطر واحد فقط، فوراً، لا عمل آخر معه — يحفظ ردّ زاتكا الكامل بصرف النظر عن
  // نتيجته، قبل أي محاولة كتابة محاسبية محلية قد تفشل لسبب لا علاقة له بزاتكا إطلاقاً (هذا بالضبط
  // ما فقد ردّ زاتكا فعلياً في الحادثة التي دفعت لهذا التصميم).
  const afterResponse = await prisma.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      zatcaStatus: decision.zatcaFields.zatcaStatus,
      zatcaResponseRaw: (decision.zatcaFields.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      zatcaClearedOrReportedAt: decision.zatcaFields.zatcaClearedOrReportedAt,
      status: decision.proceedWithPosting ? "zatca_accepted_posting_incomplete" : "pending_submission",
    },
    include: invoiceInclude,
  });

  if (!decision.proceedWithPosting) {
    // فاتورة قياسية رفضتها زاتكا (أو تعذّر الوصول إليها/توقيعها) — الردّ محفوظ بالفعل أعلاه، لا
    // قيد محاسبي إطلاقاً، والصف يبقى pending_submission قابلاً لإعادة المحاولة (نفس UUID/ICV/التجزئة
    // بالضبط) عبر retryPendingZatcaSubmission بعد تصحيح السبب.
    return { ...withPaymentStatus(afterResponse), rejectionReason: decision.rejectionReason };
  }

  try {
    const posted = await completeInvoiceLocalPosting(tenantId, userId, afterResponse, journalLines, itemById, warehouseId);
    if (!sendEmail) return posted;
    const emailResult = await sendInvoiceByEmail(tenantId, posted.id, { method: "auto" });
    return { ...posted, emailResult };
  } catch (err) {
    // المرحلة 3ب فشلت — الصف يبقى zatca_accepted_posting_incomplete بردّ زاتكا محفوظاً فعلاً (كُتب
    // أعلاه قبل هذه المحاولة بالذات) — لا نرمي 500 عاماً، نُعيد الصف كما هو: حالة مفهومة يمكن
    // إكمالها لاحقاً عبر completeZatcaAcceptedPosting بلا أي اتصال جديد بزاتكا إطلاقاً.
    // eslint-disable-next-line no-console
    console.error(
      `[zatca-posting-instrumentation] phase=3b kind=invoice outcome=failed documentUuid=${invoice.zatcaUuid} invoiceNumber=${invoice.invoiceNumber} — سيُكتمَل لاحقاً عبر completeZatcaAcceptedPosting:`,
      err,
    );
    return { ...withPaymentStatus(afterResponse), postingIncomplete: true };
  }
}

/** المرحلة 3ب وحدها — معاملة قصيرة منفصلة، بلا أي اتصال بزاتكا إطلاقاً. مُشتركة بين المسار العادي
 * (finishInvoiceZatcaSubmission) وcompleteZatcaAcceptedPosting (استئناف لاحق لصف zatca_accepted_posting_incomplete). */
async function completeInvoiceLocalPosting(
  tenantId: string,
  userId: string,
  invoice: InvoiceWithZatcaChain,
  journalLines: Awaited<ReturnType<typeof buildJournalLines>>,
  itemById: Map<string, Item>,
  warehouseId: string | undefined,
) {
  const counter = newQueryCounter();
  const startedAt = Date.now();
  let outcome: "committed" | "failed" = "failed";
  try {
    const posted = await prisma.$transaction(async (tx) => {
      const entry = await counted(counter, createJournalEntryTx(tx, {
        tenantId, companyId: invoice.companyId, branchId: invoice.branchId, date: invoice.date,
        memo: `فاتورة مبيعات ${invoice.invoiceNumber} — ${invoice.customer.name}`, sourceModule: "sales_invoice",
        sourceId: invoice.id, createdBy: userId, lines: journalLines,
      }));
      const updated = await counted(counter, tx.salesInvoice.update({
        where: { id: invoice.id },
        data: { status: "posted", journalEntryId: entry.id },
        include: invoiceInclude,
      }));
      await counted(counter, createStockOutSideEffectsTx(tx, tenantId, invoice.companyId, invoice.date, updated.lines, entry.id, itemById, warehouseId));
      await counted(counter, accrueTrainerCommissionsTx(tx, tenantId, invoice.companyId, invoice.id, userId));
      return withPaymentStatus(updated);
    }, { timeout: 8000 });
    outcome = "committed";
    return posted;
  } finally {
    logPostingPhaseTiming({ phase: "3b", kind: "invoice", startedAt, counter, outcome });
  }
}

interface StoredInvoiceLineLike {
  accountId: string;
  itemId: string | null;
  description: string | null;
  subtotal: Prisma.Decimal | number;
  vat: Prisma.Decimal | number;
  total: Prisma.Decimal | number;
  quantity: Prisma.Decimal | number;
  unitPrice: Prisma.Decimal | number;
  taxCategoryCode: string;
  taxExemptionReason: string | null;
}

/** الشكل المطلوب لـcomputeCogsJournalLines/buildJournalLines فقط (LineInput) — بلا description
 * (غير مقروء في أيّ منهما، راجع buildJournalLines) وبلا حقول زاتكا (تلك في toZatcaLines أدناه،
 * لأن description هناك يجب أن يكون string|null، لا string|undefined كما يتطلبه LineInput هنا). */
function toComputedLines(lines: StoredInvoiceLineLike[]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    itemId: l.itemId ?? undefined,
    subtotal: Number(l.subtotal),
    vat: Number(l.vat),
    total: Number(l.total),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
  }));
}

/** الشكل المطلوب لـreserveZatcaChain/rebuildZatcaDocumentXml (ZatcaPersistedLineLike) — من نفس
 * صفوف SalesInvoiceLine المخزَّنة مباشرة، لا من toComputedLines أعلاه (شكل مختلف الغرض). */
function toZatcaLines(lines: StoredInvoiceLineLike[]): ZatcaPersistedLineLike[] {
  return lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    subtotal: Number(l.subtotal),
    vat: Number(l.vat),
    taxCategoryCode: l.taxCategoryCode,
    taxExemptionReason: l.taxExemptionReason,
  }));
}

/**
 * تعيد محاولة إرسال فاتورة عالقة بحالة pending_submission (لم يصلها ردّ نهائي من زاتكا بعد — إما
 * لم تُحاوَل إطلاقاً بعد انهيار محتمل بين المرحلة 1 والمرحلة 2، أو حاولت ورُفضت/تعذّر الوصول
 * لزاتكا) — بنفس UUID/ICV/التجزئة المخزَّنة على الصف بالضبط، بلا حجز أي شيء جديد إطلاقاً؛ الأمانة
 * تُتحقَّق منها فعلياً (rebuildZatcaDocumentXml يُعيد نفس invoiceHash المخزَّن أصلاً وإلا تُرفَض
 * إعادة المحاولة). راجع claimInvoiceForZatcaAttempt أدناه لمنع إرسال مزدوج متزامن.
 */
export async function retryPendingZatcaSubmission(tenantId: string, userId: string, id: string): Promise<InvoicePostingOutcome> {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "pending_submission") {
    throw badRequest("إعادة المحاولة متاحة فقط لفاتورة في انتظار الإرسال لزاتكا");
  }
  if (invoice.icv == null || !invoice.previousInvoiceHash || !invoice.invoiceHash || !invoice.zatcaSubmittedAt) {
    throw badRequest("بيانات سلسلة زاتكا لهذه الفاتورة غير مكتملة — تعذّرت إعادة المحاولة، راجع الدعم الفني");
  }

  const claimed = await claimInvoiceForZatcaAttempt(invoice, new Date());
  if (!claimed) {
    throw badRequest("جارٍ إعادة محاولة إرسال هذه الفاتورة بالفعل الآن — انتظر قليلاً ثم تحقّق من حالتها قبل إعادة المحاولة");
  }

  const company = await prisma.company.findFirstOrThrow({ where: { id: invoice.companyId, tenantId } });
  const computed = toComputedLines(invoice.lines);
  const rebuilt = rebuildZatcaDocumentXml({
    company,
    customer: invoice.customer,
    kind: "invoice",
    documentNumber: invoice.invoiceNumber,
    documentUuid: invoice.zatcaUuid,
    lines: toZatcaLines(invoice.lines),
    icv: invoice.icv,
    previousInvoiceHash: invoice.previousInvoiceHash,
    issuedAt: invoice.zatcaSubmittedAt,
  });
  if (rebuilt.invoiceHash !== invoice.invoiceHash) {
    throw badRequest("تعذّرت إعادة المحاولة: بيانات الفاتورة المخزَّنة لا تطابق ما حُجزت له السلسلة أصلاً — راجع الدعم الفني قبل أي محاولة أخرى");
  }

  const { cogsLines, itemById } = await computeCogsJournalLines(tenantId, invoice.companyId, computed);
  const journalLines = await buildJournalLines(tenantId, invoice.companyId, invoice.customer, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), cogsLines);

  return finishInvoiceZatcaSubmission(tenantId, userId, {
    invoice, xml: rebuilt.xml, subtype: rebuilt.subtype, company,
    grandTotal: Number(invoice.grandTotal), vatTotal: Number(invoice.vatTotal), journalLines, itemById, warehouseId: undefined, sendEmail: true,
  });
}

/**
 * تُكمل الترحيل المحلي (قيد + مخزون + عمولات) لفاتورة استلمت ردّاً من زاتكا بالفعل (zatcaStatus
 * ومحتواه الخام محفوظان أصلاً على الصف من المرحلة 3أ) لكن المرحلة 3ب السابقة فشلت — بلا أي اتصال
 * جديد بزاتكا إطلاقاً؛ الردّ المحفوظ هو مصدر الحقيقة الوحيد المُعتمَد هنا.
 */
export async function completeZatcaAcceptedPosting(tenantId: string, userId: string, id: string): Promise<InvoicePostingOutcome> {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "zatca_accepted_posting_incomplete") {
    throw badRequest("إكمال الترحيل متاح فقط لفاتورة استلمت ردّاً من زاتكا لكن لم يكتمل ترحيلها المحلي بعد");
  }

  const computed = toComputedLines(invoice.lines);
  const { cogsLines, itemById } = await computeCogsJournalLines(tenantId, invoice.companyId, computed);
  const journalLines = await buildJournalLines(tenantId, invoice.companyId, invoice.customer, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), cogsLines);

  const posted = await completeInvoiceLocalPosting(tenantId, userId, invoice, journalLines, itemById, undefined);
  const emailResult = await sendInvoiceByEmail(tenantId, posted.id, { method: "auto" });
  return { ...posted, emailResult };
}

export async function updateSalesInvoice(tenantId: string, id: string, input: InvoiceInput) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن تعديل فاتورة مرحّلة، يجب فك ترحيلها أولاً");

  input = { ...input, lines: await resolveLineAccounts(tenantId, input.companyId, input.lines) };
  const { customer } = await assertRefs(tenantId, input.companyId, input.customerId, input.lines, input.branchId);
  const { computed, subtotal, vatTotal, grandTotal } = computeLines(input.lines);
  if (grandTotal <= 0) throw badRequest("إجمالي الفاتورة يجب أن يكون أكبر من صفر");
  const invType = invoiceTypeForCustomer(customer);

  return prisma.$transaction(async (tx) => {
    await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
    const invoice = await tx.salesInvoice.update({
      where: { id },
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        branchId: input.branchId ?? null,
        date: input.date,
        dueDate: input.dueDate ?? null,
        customerReference: input.customerReference,
        poNumber: input.poNumber,
        salesperson: input.salesperson,
        otherId: input.otherId,
        invoiceType: invType,
        subtotal,
        vatTotal,
        grandTotal,
        lines: { create: computed },
      },
      include: invoiceInclude,
    });
    return withPaymentStatus(invoice);
  });
}

export async function deleteSalesInvoice(tenantId: string, id: string) {
  const existing = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("الفاتورة غير موجودة");
  if (existing.status !== "draft") throw badRequest("لا يمكن حذف فاتورة مرحّلة، يجب فك ترحيلها أولاً");
  await prisma.salesInvoice.delete({ where: { id } });
}

export async function postSalesInvoice(tenantId: string, userId: string, id: string): Promise<InvoicePostingOutcome> {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: { lines: true, customer: true } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  // فقط مسودة يمكن ترحيلها من هنا — الحالات الأخرى (pending_submission، zatca_accepted_posting_incomplete)
  // لها مساراها الخاص للاستئناف (retryPendingZatcaSubmission/completeZatcaAcceptedPosting)، بلا
  // حجز أي رقم/سلسلة جديدة؛ رسالة واضحة لكل حالة بدل "مرحّلة بالفعل" العامة السابقة.
  if (invoice.status === "posted") throw badRequest("الفاتورة مرحّلة بالفعل");
  if (invoice.status !== "draft") {
    throw badRequest("هذه الفاتورة قيد معالجة زاتكا بالفعل (انتظار إرسال أو ترحيل محلي غير مكتمل) — استخدم إعادة المحاولة أو إكمال الترحيل بدلاً من الترحيل من جديد");
  }
  const company = await prisma.company.findFirstOrThrow({ where: { id: invoice.companyId, tenantId } });
  const customer = invoice.customer;

  const computed = toComputedLines(invoice.lines);
  const { cogsLines, itemById } = await computeCogsJournalLines(tenantId, invoice.companyId, computed);
  const journalLines = await buildJournalLines(tenantId, invoice.companyId, customer, computed, Number(invoice.vatTotal), Number(invoice.grandTotal), cogsLines);
  const zatcaUuid = invoice.zatcaUuid;

  // المرحلة 1 — معاملة قصيرة واحدة: تحجز سلسلة ICV/PIH (رقم الفاتورة موجود بالفعل منذ إنشاء
  // المسودة) وتنقل الصف الموجود فعلاً من draft إلى pending_submission (أو posted مباشرة لو لم
  // تنطبق زاتكا) — بلا أي اتصال شبكي بزاتكا داخلها.
  const counter1 = newQueryCounter();
  const startedAt1 = Date.now();
  let phase1Outcome: "committed" | "failed" = "failed";
  let phase1: { kind: "done"; invoice: ReturnType<typeof withPaymentStatus<InvoiceWithZatcaChain>> } | { kind: "pending"; invoice: InvoiceWithZatcaChain; xml: string; subtype: "standard" | "simplified" };
  try {
    phase1 = await prisma.$transaction(async (tx) => {
      const chain = await counted(
        counter1,
        reserveZatcaChain(tx, { company, customer, kind: "invoice", documentNumber: invoice.invoiceNumber, documentUuid: zatcaUuid, lines: toZatcaLines(invoice.lines) }),
      );
      if (!chain) {
        const entry = await counted(counter1, createJournalEntryTx(tx, {
          tenantId, companyId: invoice.companyId, branchId: invoice.branchId, date: invoice.date,
          memo: `فاتورة مبيعات ${invoice.invoiceNumber} — ${customer.name}`, sourceModule: "sales_invoice",
          sourceId: invoice.id, createdBy: userId, lines: journalLines,
        }));
        const updated = await counted(counter1, tx.salesInvoice.update({
          where: { id }, data: { status: "posted", journalEntryId: entry.id, zatcaStatus: "not_applicable" }, include: invoiceInclude,
        }));
        await counted(counter1, createStockOutSideEffectsTx(tx, tenantId, invoice.companyId, invoice.date, updated.lines, entry.id, itemById));
        await counted(counter1, accrueTrainerCommissionsTx(tx, tenantId, invoice.companyId, invoice.id, userId));
        return { kind: "done" as const, invoice: withPaymentStatus(updated) };
      }
      const updated = await counted(counter1, tx.salesInvoice.update({
        where: { id },
        data: {
          status: "pending_submission",
          icv: chain.icv,
          previousInvoiceHash: chain.previousInvoiceHash,
          invoiceHash: chain.invoiceHash,
          zatcaStatus: "not_submitted",
          zatcaSubmittedAt: chain.issuedAt,
        },
        include: invoiceInclude,
      }));
      return { kind: "pending" as const, invoice: updated, xml: chain.xml, subtype: chain.subtype };
    }, { timeout: 8000 });
    phase1Outcome = "committed";
  } finally {
    logPostingPhaseTiming({ phase: "1", kind: "invoice", startedAt: startedAt1, counter: counter1, outcome: phase1Outcome });
  }

  if (phase1.kind === "done") {
    const emailResult = await sendInvoiceByEmail(tenantId, id, { method: "auto" });
    return { ...phase1.invoice, emailResult };
  }

  return finishInvoiceZatcaSubmission(tenantId, userId, {
    invoice: phase1.invoice, xml: phase1.xml, subtype: phase1.subtype, company,
    grandTotal: Number(invoice.grandTotal), vatTotal: Number(invoice.vatTotal), journalLines, itemById, warehouseId: undefined, sendEmail: true,
  });
}

/**
 * ينفّذ إعادة الإرسال الفعلية (يدوية من resendInvoiceToZatca أو تلقائية من runZatcaAutoRetry) على
 * فاتورة تحمل بيانات سلسلة زاتكا الأصلية بالفعل — بلا حجز رقم ICV جديد وبلا أي تعديل على بيانات
 * الفاتورة نفسها، فقط إعادة توقيع وإرسال نفس المحتوى. يُحدِّث حقول زاتكا فقط (لا القيد المحاسبي
 * ولا حالة الترحيل) بصرف النظر عن النتيجة، ويُصفِّر عدّاد المحاولات عند النجاح أو يزيده عند الفشل
 * (يُستخدَم فقط لحساب فترة الانتظار قبل المحاولة التلقائية التالية، راجع isDueForZatcaAutoRetry).
 */
async function performZatcaResubmission(invoice: InvoiceWithZatcaChain) {
  if (invoice.icv == null || !invoice.previousInvoiceHash || !invoice.invoiceHash || !invoice.zatcaSubmittedAt) {
    throw badRequest("بيانات سلسلة زاتكا الأصلية لهذه الفاتورة غير مكتملة — تعذّرت إعادة الإرسال، راجع الدعم الفني");
  }

  if (invoice.zatcaRetryCount > 0) {
    // تنبيه مميَّز مقصود (لا رسالة عادية) يُسجَّل *قبل* إرسال أي محاولة ثانية أو لاحقة لنفس
    // المستند — إن اشتكت زاتكا يوماً من ازدواج مستند بنفس UUID، هذا أول مكان يجب البحث فيه بدل
    // تخمين وقت الإرسال المزدوج من سجلات متفرقة.
    // eslint-disable-next-line no-console
    console.warn(
      `[zatcaResubmission] REPEATED SUBMISSION — محاولة رقم ${invoice.zatcaRetryCount + 1} لنفس المستند | ` +
        `الفاتورة=${invoice.invoiceNumber} الشركة=${invoice.company.name} (companyId=${invoice.companyId}) ` +
        `documentUuid=${invoice.zatcaUuid}`,
    );
  }

  const result = await resubmitZatcaDocument({
    company: invoice.company,
    customer: invoice.customer,
    documentNumber: invoice.invoiceNumber,
    documentUuid: invoice.zatcaUuid,
    lines: invoice.lines,
    grandTotal: Number(invoice.grandTotal),
    vatTotal: Number(invoice.vatTotal),
    icv: invoice.icv,
    previousInvoiceHash: invoice.previousInvoiceHash,
    invoiceHash: invoice.invoiceHash,
    issuedAt: invoice.zatcaSubmittedAt,
  });

  const succeeded = result.zatcaStatus === "cleared" || result.zatcaStatus === "reported";
  const updated = await prisma.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      zatcaStatus: result.zatcaStatus,
      zatcaResponseRaw: (result.zatcaResponseRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      zatcaClearedOrReportedAt: result.zatcaClearedOrReportedAt,
      zatcaLastAttemptAt: new Date(),
      zatcaRetryCount: succeeded ? 0 : { increment: 1 },
    },
    include: invoiceInclude,
  });
  return { updated, rejectionReason: result.rejectionReason };
}

/**
 * يحجز فاتورة ذرّياً قبل أي محاولة إرسال فعلية (يدوية أو تلقائية) — يُطابِق تحديثه في WHERE قيمتي
 * zatcaRetryCount/zatcaLastAttemptAt المقروءتين بالضبط عند تحميل الفاتورة، فلو نسخة أخرى من
 * الخادم (تدقة تلقائية متزامنة) أو نقرة "إعادة إرسال" أخرى سبقتنا لنفس الفاتورة، هذا التحديث
 * يُطابِق صفراً من الصفوف. يمنع إرسال نفس المستند لزاتكا مرتين بسبب تزامن، سواء بين نسختي خادم أو
 * بين محاولة تلقائية ونقرة يدوية على نفس الفاتورة في نفس اللحظة تقريباً.
 */
async function claimInvoiceForZatcaAttempt(
  invoice: { id: string; zatcaStatus: InvoiceWithZatcaChain["zatcaStatus"]; zatcaRetryCount: number; zatcaLastAttemptAt: Date | null },
  now: Date,
): Promise<boolean> {
  const claim = await prisma.salesInvoice.updateMany({
    where: { id: invoice.id, zatcaStatus: invoice.zatcaStatus, zatcaRetryCount: invoice.zatcaRetryCount, zatcaLastAttemptAt: invoice.zatcaLastAttemptAt },
    data: { zatcaLastAttemptAt: now },
  });
  return claim.count > 0;
}

/**
 * يعيد محاولة إرسال فاتورة مُرحَّلة فعلاً بحالة zatcaStatus = "rejected" (رفضتها زاتكا صراحةً)،
 * "submission_failed" (تعذّر الوصول إليها أصلاً)، "certificate_error" (تعذّر توقيعها محلياً
 * بشهادة غير صالحة — يُفتَرض أن المستخدم أصلح إعدادات ربط زاتكا قبل الضغط هنا، وإلا ستفشل بنفس
 * السبب مجدداً وتبقى certificate_error)، أو "compliance_checked" (لا تزال الشركة على شهادة اختبار —
 * إعادة الإرسال بعد استكمال الحصول على شهادة إنتاج فعلية هي كيف تُخلَّص/تُبلَّغ هذه الفاتورة فعلياً
 * لأول مرة، راجع resolveZatcaSubmissionKind في submission.ts)، أو not_submitted بعد إصلاح الربط —
 * أي حالة زاتكا أخرى تُرفَض صراحةً.
 */
export async function resendInvoiceToZatca(tenantId: string, id: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId }, include: invoiceInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن إعادة الإرسال إلا لفاتورة مُرحَّلة");
  if (
    invoice.zatcaStatus !== "not_submitted" &&
    invoice.zatcaStatus !== "rejected" &&
    invoice.zatcaStatus !== "submission_failed" &&
    invoice.zatcaStatus !== "certificate_error" &&
    invoice.zatcaStatus !== "compliance_checked"
  ) {
    throw badRequest("إعادة الإرسال متاحة فقط للفواتير التي رفضتها زاتكا، تعذّر إرسالها إليها، تعذّر توقيعها بشهادة غير صالحة، أو نجح فحص الامتثال لها فقط دون تخليص/إبلاغ فعلي");
  }

  const claimed = await claimInvoiceForZatcaAttempt(invoice, new Date());
  if (!claimed) {
    throw badRequest("جارٍ إعادة إرسال هذه الفاتورة بالفعل الآن (نقرة أخرى أو محاولة تلقائية متزامنة) — انتظر قليلاً ثم تحقّق من حالتها قبل إعادة المحاولة");
  }

  const { updated, rejectionReason } = await performZatcaResubmission(invoice);
  return { ...withPaymentStatus(updated), rejectionReason };
}

// حالات زاتكا المؤهَّلة لإعادة المحاولة التلقائية — لا "rejected" ولا "certificate_error" عمداً:
// كلاهما يحتاج تدخلاً بشرياً أولاً (تصحيح بيانات، أو إصلاح إعدادات ربط زاتكا نفسها)، وإعادة
// المحاولة تلقائياً بلا تغيير ستفشل بنفس السبب كل مرة. الفرق بينهما تحديداً هو سبب استبعاد
// certificate_error هنا: عطل شبكة عابر (submission_failed) قد يُحَل نفسه بمرور الوقت فيستحق
// إعادة محاولة دورية، بينما شهادة تالفة (certificate_error) لن تُصلَح نفسها أبداً — استمرار
// إعادة المحاولة عليها يستهلك فتحات الدفعة الدورية بلا أي فائدة، ويُخفي مشكلة إعداد حقيقية خلف
// مظهر عطل عابر مؤقت (راجع طلب المستخدم: حالة منفصلة تماماً عن submission_failed لهذا السبب بالذات).
const ZATCA_AUTO_RETRY_STATUSES = ["submission_failed", "not_submitted"] as const;

// فترات الانتظار (بالدقائق) بين محاولة تلقائية وأخرى لنفس الفاتورة، مفهرسة بعدد المحاولات
// السابقة (zatcaRetryCount) — تصاعدية لتفادي إغراق زاتكا بمحاولات متكررة على فاتورة يبدو أنها
// تفشل باستمرار (أو شركة لم تُهيّئ شهادتها بعد)، لكنها تبقى ضمن حد أقصى ساعة واحدة — كافٍ لعشرات
// المحاولات خلال مهلة الـ24 ساعة القانونية للإبلاغ عن الفاتورة المبسّطة (Phase 2).
const ZATCA_AUTO_RETRY_BACKOFF_MINUTES = [0, 5, 15, 30, 60] as const;

/** مُصدَّرة للاختبار المباشر بلا حاجة لقاعدة بيانات — منطق حساب الاستحقاق نفسه لا يلمس Prisma. */
export function isDueForZatcaAutoRetry(invoice: { zatcaRetryCount: number; zatcaLastAttemptAt: Date | null }, now: Date): boolean {
  if (!invoice.zatcaLastAttemptAt) return true; // لم تُحاوَل تلقائياً بعد — مؤهَّلة فوراً
  const idx = Math.min(invoice.zatcaRetryCount, ZATCA_AUTO_RETRY_BACKOFF_MINUTES.length - 1);
  const dueAt = invoice.zatcaLastAttemptAt.getTime() + ZATCA_AUTO_RETRY_BACKOFF_MINUTES[idx] * 60_000;
  return now.getTime() >= dueAt;
}

export interface ZatcaAutoRetryRunSummary {
  attempted: number;
  succeeded: number;
  rejected: number;
  stillFailing: number;
}

// سقف أمان لحجم الاستعلام نفسه فقط (لا علاقة له بعدد ما يُرسَل فعلياً لزاتكا في نبضة واحدة، راجع
// ZATCA_AUTO_RETRY_BATCH_SIZE أدناه) — يمنع تحميل جدول ضخم بالكامل في الحالة النادرة لتراكم كبير جداً.
const ZATCA_AUTO_RETRY_QUERY_LIMIT = 500;

// أقصى عدد فواتير تُرسَل فعلياً لزاتكا في نبضة واحدة (كل 5 دقائق، راجع retryScheduler.ts) — يُصرِّف
// تراكم انقطاع ليلي كامل (تقريباً 240 فاتورة لمحطة بمعدل 30 فاتورة/ساعة على مدى 8 ساعات) خلال نحو
// ساعة تقريباً من عودة الاتصال (20 × نبضة كل 5 دقائق = 240 فاتورة/ساعة)، بدل إغراق زاتكا بمئات
// الطلبات دفعة واحدة عند أول نبضة بعد عودة الشبكة.
const ZATCA_AUTO_RETRY_BATCH_SIZE = 20;

/**
 * تُوزَّع فتحات الدفعة الواحدة بالتناوب (round-robin) على كل الشركات التي لديها فواتير مستحقة —
 * فتحة واحدة لكل شركة في كل جولة، لا بحسب أقدم فاتورة على الإطلاق عبر المنصّة كلها — حتى لا
 * تستحوذ شركة واحدة ذات تراكم كبير على الدفعة بأكملها بينما فاتورة شركة أخرى (قد تكون أقرب فعلياً
 * لمهلة الـ24 ساعة القانونية الخاصة بها) تنتظر بلا داعٍ. الترتيب "الأقدم أولاً" يبقى محفوظاً *داخل*
 * كل شركة (قائمة كل شركة مُرتَّبة سلفاً لأن invoicesDueOldestFirst مُرتَّبة، والتجميع أدناه يحافظ
 * على هذا الترتيب).
 *
 * عندما يتجاوز عدد الشركات صاحبة العمل المعلَّق حجم الدفعة: كل شركة تحصل على فتحة واحدة على الأكثر
 * في هذه النبضة (الجولة الأولى وحدها تملأ الدفعة)، فتُخدَم أول ZATCA_AUTO_RETRY_BATCH_SIZE شركة من
 * قائمة `rotationOffset` الدوّارة هذه النبضة، والباقي ينتظر النبضة التالية. rotationOffset يتقدّم
 * نبضة بعد أخرى (حالة داخل العملية فقط، بلا تأثير على الصحة) حتى لا تُخدَم نفس المجموعة من
 * الشركات دائماً أولاً لو تجاوز عدد الشركات المتنافسة حجم الدفعة باستمرار — كل شركة تتقدّم في
 * الصفّ على مدى عدة نبضات بدل أن تُحرَم إحداها بشكل دائم.
 */
export function allocateZatcaAutoRetryBatch<T extends { companyId: string }>(invoicesDueOldestFirst: T[], batchSize: number, rotationOffset = 0): T[] {
  const byCompany = new Map<string, T[]>();
  for (const invoice of invoicesDueOldestFirst) {
    const queue = byCompany.get(invoice.companyId);
    if (queue) queue.push(invoice);
    else byCompany.set(invoice.companyId, [invoice]);
  }
  const companyQueues = [...byCompany.values()];
  if (companyQueues.length === 0) return [];
  const offset = rotationOffset % companyQueues.length;
  const rotatedQueues = [...companyQueues.slice(offset), ...companyQueues.slice(0, offset)];

  const selected: T[] = [];
  let madeProgress = true;
  while (selected.length < batchSize && madeProgress) {
    madeProgress = false;
    for (const queue of rotatedQueues) {
      if (selected.length >= batchSize) break;
      const next = queue.shift();
      if (next !== undefined) {
        selected.push(next);
        madeProgress = true;
      }
    }
  }
  return selected;
}

// يدوّر أولوية الشركات بين نبضة وأخرى عند التنافس على الدفعة (راجع allocateZatcaAutoRetryBatch) —
// حالة داخل العملية فقط لا تؤثر على الصحة إطلاقاً (مجرد عدالة أفضل عبر الزمن)، تُصفَّر بإعادة تشغيل
// الخادم بلا أي مشكلة.
let zatcaAutoRetryRotationOffset = 0;

/**
 * يُستدعى دورياً من lib/zatca/retryScheduler.ts — يفحص كل الفواتير المُرحَّلة (لأي شركة على
 * المنصّة، بلا اقتصار على مستأجر واحد؛ هذا job خلفي بلا سياق طلب) التي لم تصل لزاتكا بنجاح بعد
 * (تعذّر اتصال، أو لم تُرسَل أصلاً بسبب غياب شهادة الشركة وقت الترحيل) ويعيد محاولة إرسالها بشهادة
 * *شركتها هي* تحديداً (invoice.company عبر invoiceInclude) — لا مشاركة حالة بين الشركات. لا يمسّ
 * القيد المحاسبي ولا حالة ترحيل الفاتورة إطلاقاً (نهائية بصرف النظر عن نتيجة زاتكا) — فقط حقول
 * زاتكا. فشل فاتورة واحدة (استثناء غير متوقَّع، شهادة شركة أُلغيت أو انتهت، ...) لا يوقف بقية
 * الدفعة (شركات أخرى ضمنها) ولا الوظيفة الدورية نفسها.
 *
 * أمان تعدّد النُّسخ (Railway قد يُشغِّل أكثر من Instance): قبل أي محاولة فعلية لفاتورة، تُحجَز
 * ذرّياً عبر claimInvoiceForZatcaAttempt (نفس أسلوب المطالبة الذرّية في reportScheduler.ts أعلاه
 * بـlastSentPeriodKey) — لو نسخة أخرى من الخادم حجزت نفس الفاتورة أولاً (أو غيّرت حالتها) بين
 * قراءتنا وتحديثنا، الحجز يُطابِق صفراً من الصفوف فنتخطّى الفاتورة هذه النبضة بدل إرسالها مرتين.
 * الحجز يحدث *قبل* أي اتصال فعلي بزاتكا، فانهيار العملية بعده مباشرة (قبل استدعاء fetch) لا يترك
 * أثراً غير محاولة مؤجَّلة فقط. النافذة الوحيدة غير المُغلَقة فعلياً: انهيار العملية بعد أن يستلم
 * زاتكا الطلب فعلياً وقبل أن يُكتَب نجاح ذلك محلياً — عندها ستُعاد المحاولة لاحقاً بنفس UUID/تجزئة
 * المستند بالضبط؛ هذا الكود لا يفترض أن زاتكا يتعامل مع ذلك كطلب مكرر آمن (idempotent)، فهذه نافذة
 * خطر متبقية فعلياً، ولا توجد في هذا التكامل أي نقطة API للتحقق من حالة مستند سبق إرساله قبل إعادة
 * إرساله. performZatcaResubmission يُسجِّل تحذيراً مميَّزاً REPEATED SUBMISSION قبل أي محاولة
 * ثانية أو لاحقة لنفس المستند (retryCount > 0) بمعرّفه (UUID) بالضبط، تحديداً لتتبّع هذه الحالة.
 *
 * عدالة بين المستأجرين: الفواتير المستحقة تُوزَّع بالتناوب على الشركات صاحبة العمل المعلَّق (راجع
 * allocateZatcaAutoRetryBatch) بدل ملء الدفعة كلها من أقدم الفواتير على الإطلاق بصرف النظر عن
 * الشركة — فتراكم كبير لشركة واحدة لا يدفع فاتورة شركة أخرى (ربما أقرب فعلياً لمهلتها الخاصة)
 * خارج الدفعة باستمرار.
 */
export async function runZatcaAutoRetry(now: Date = new Date()): Promise<ZatcaAutoRetryRunSummary> {
  const candidates = await prisma.salesInvoice.findMany({
    where: { status: "posted", zatcaStatus: { in: [...ZATCA_AUTO_RETRY_STATUSES] } },
    orderBy: { zatcaSubmittedAt: "asc" }, // الأقدم أولاً داخل كل شركة — الأقرب لمهلة الـ24 ساعة القانونية لتلك الشركة
    take: ZATCA_AUTO_RETRY_QUERY_LIMIT,
    include: invoiceInclude,
  });
  const due = candidates.filter((invoice) => isDueForZatcaAutoRetry(invoice, now));
  const batch = allocateZatcaAutoRetryBatch(due, ZATCA_AUTO_RETRY_BATCH_SIZE, zatcaAutoRetryRotationOffset++);

  const summary: ZatcaAutoRetryRunSummary = { attempted: 0, succeeded: 0, rejected: 0, stillFailing: 0 };
  for (const invoice of batch) {
    const claimed = await claimInvoiceForZatcaAttempt(invoice, now);
    if (!claimed) continue; // نسخة أخرى من الخادم سبقتنا لهذه الفاتورة، أو تغيّرت حالتها منذ القراءة أعلاه

    summary.attempted++;
    try {
      const { updated } = await performZatcaResubmission(invoice);
      if (updated.zatcaStatus === "cleared" || updated.zatcaStatus === "reported") summary.succeeded++;
      else if (updated.zatcaStatus === "rejected") summary.rejected++;
      else summary.stillFailing++;
    } catch (err) {
      summary.stillFailing++;
      // eslint-disable-next-line no-console
      console.error(`[zatcaAutoRetry] فشلت محاولة إعادة إرسال الفاتورة ${invoice.invoiceNumber} (${invoice.id}):`, err);
      // وقت الحجز أعلاه (zatcaLastAttemptAt = now) يكفي وحده لتفعيل الانتظار (backoff) حتى لو
      // فشلت المحاولة هنا محلياً قبل الوصول لزاتكا فعلياً (مثال: الشركة لم تُهيّئ شهادتها بعد) —
      // فقط نزيد العدّاد هنا لتصعيد مدة الانتظار في المرة التالية.
      await prisma.salesInvoice
        .update({ where: { id: invoice.id }, data: { zatcaRetryCount: { increment: 1 } } })
        .catch((updateErr) => console.error(`[zatcaAutoRetry] تعذّر تحديث عدّاد المحاولات للفاتورة ${invoice.invoiceNumber}:`, updateErr));
    }
  }
  return summary;
}

export async function unpostSalesInvoice(tenantId: string, userId: string, id: string, pin: string) {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("الفاتورة ليست مرحّلة أصلاً");
  // فك الترحيل بعد دخول الفاتورة في سلسلة تجزئة زاتكا (ICV/PIH) يكسر السلسلة بلا رجعة — انتهاك
  // امتثال حقيقي لا مجرد إزعاج بالواجهة، فيُمنَع كلياً بمجرد تجاوز الحالة "not_applicable".
  if (invoice.zatcaStatus !== "not_applicable") {
    throw badRequest("لا يمكن فك ترحيل فاتورة مرتبطة بسلسلة تجزئة زاتكا (ICV/PIH) — هذا يكسر السلسلة بشكل غير قابل للإصلاح");
  }

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (await tx.salesReturn.count({ where: { tenantId, relatedInvoiceId: id, status: { not: "draft" } } })) {
      throw badRequest("لا يمكن فك ترحيل فاتورة لها إشعار دائن معتمد أو قيد المعالجة");
    }
    await reverseTrainerCommissionsTx(tx, id);
    await removeStockOutSideEffectsTx(tx, id);
    await deleteJournalEntryTx(tx, invoice.journalEntryId);
    const updated = await tx.salesInvoice.update({
      where: { id },
      data: { status: "draft", journalEntryId: null },
      include: invoiceInclude,
    });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "SalesInvoice", entityId: id });
    return withPaymentStatus(updated);
  });
}
