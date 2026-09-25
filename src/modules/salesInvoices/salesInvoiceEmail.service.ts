import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { buildPlainInvoicePdf } from "../../lib/invoicePdf";
import { sendInvoiceEmail } from "../../lib/mailer";
import type { Lang } from "../../lib/i18n/translate";
import { currencyLabel } from "../../lib/countries";

export interface SendInvoiceEmailResult {
  sent: boolean;
  reason?: "no_email" | "send_failed";
}

const invoicePdfInclude = { lines: { include: { account: true, item: true } }, customer: true, company: true, branch: true, receiptAllocations: true } as const;
type InvoiceForPdf = Prisma.SalesInvoiceGetPayload<{ include: typeof invoicePdfInclude }>;

/**
 * يبني PDF الفاتورة نفسه (بلا XML موقّع مُرفَق — راجع تعليق buildPlainInvoicePdf، هذا PDF بسيط
 * وليس PDF/A-3 المُخصَّص لزاتكا) — مُستخرَجة من sendInvoiceByEmail أدناه لإعادة استخدامها في تحميل
 * نسخة PDF مطابقة تماماً لما يصل بالإيميل فعلياً (لا شاشة HTML مُصوَّرة)، دون تكرار بناء الكائن.
 */
async function buildInvoicePdfBuffer(tenantId: string, invoice: InvoiceForPdf): Promise<Buffer> {
  const companyAddress = [invoice.company.addressBuilding, invoice.company.addressStreet, invoice.company.addressCity]
    .filter(Boolean)
    .join("، ");
  const customerAddress = [invoice.customer.buildingNo, invoice.customer.street, invoice.customer.city]
    .filter(Boolean)
    .join("، ");
  const paid = invoice.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
  const bankAccounts = await prisma.companyBankAccount.findMany({
    where: { companyId: invoice.companyId, tenantId },
    orderBy: { sortOrder: "asc" },
  });

  return buildPlainInvoicePdf({
    template: invoice.company.invoiceTemplate,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    dueDate: invoice.dueDate,
    customerReference: invoice.customerReference,
    poNumber: invoice.poNumber,
    salesperson: invoice.salesperson,
    otherId: invoice.otherId,
    paymentMethod: invoice.customer.paymentTerms,
    companyName: invoice.company.name,
    companyNameEn: invoice.company.nameEn,
    companyVatNumber: invoice.company.vatNumber,
    companyCrNumber: invoice.company.crNumber,
    companyUnifiedEntityNumber: invoice.company.unifiedEntityNumber,
    companyLicenseNumber: invoice.company.licenseNumber,
    companyAddress: companyAddress || null,
    companyPhone: invoice.company.phone,
    brandColor: invoice.company.brandColor,
    branchName: invoice.branch?.nameAr,
    customerName: invoice.customer.name,
    customerVatNumber: invoice.customer.vatNumber,
    customerUnifiedEntityNumber: invoice.customer.unifiedEntityNumber,
    customerAddress: customerAddress || null,
    lines: invoice.lines.map((l) => ({
      description: l.description || l.account.name,
      itemCode: l.item?.code ?? null,
      unit: l.item?.unit ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      subtotal: Number(l.subtotal),
      vat: Number(l.vat),
      total: Number(l.total),
    })),
    subtotal: Number(invoice.subtotal),
    vatTotal: Number(invoice.vatTotal),
    grandTotal: Number(invoice.grandTotal),
    paidAmount: paid,
    qrPayload: invoice.qrPayload,
    zatcaUuid: invoice.zatcaUuid,
    bankAccounts: bankAccounts.map((b) => ({ bankName: b.bankName, accountNumber: b.accountNumber, iban: b.iban })),
  });
}

/**
 * تحميل نفس نسخة PDF المُرسَلة بالإيميل — لزر "تحميل PDF" في شاشة عرض الفاتورة، بدل الاعتماد على
 * طباعة/تصوير شاشة الـHTML (سلوك PrintShell الافتراضي بلا onDownload). يتطلب فاتورة مرحّلة فقط،
 * بنفس شرط sendInvoiceByEmail بالضبط — تحميل "نسخة رسمية" لمسودة لم تُرقَّم/تُرحَّل بعد لا معنى له.
 */
export async function getSalesInvoicePdf(tenantId: string, invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await prisma.salesInvoice.findFirst({ where: { id: invoiceId, tenantId }, include: invoicePdfInclude });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن تحميل PDF لفاتورة لم تُرحَّل بعد");
  const buffer = await buildInvoicePdfBuffer(tenantId, invoice);
  // اسم إنجليزي بحت (بخلاف اسم مرفق الإيميل أعلاه) — يذهب داخل ترويسة HTTP خام (Content-Disposition)
  // لا حمولة JSON لواجهة Resend، وترويسات HTTP لا تضمن ترميز UTF-8 بأمان بلا ترميز RFC 5987 إضافي.
  return { buffer, fileName: `invoice-${invoice.invoiceNumber}.pdf` };
}

/**
 * يبني PDF الفاتورة ويرسله بالإيميل لعنوان العميل المسجَّل (أو عنوان بديل لمرة واحدة عبر
 * overrideEmail)، ويسجّل نتيجة كل محاولة في InvoiceEmailLog. لا يرمي أبداً بسبب فشل الإرسال
 * نفسه (خدمة Resend متوقفة، أو فشل توليد PDF) — يُعيد `{ sent: false }` بدلاً من ذلك حتى لا
 * توقف هذه الميزة عملية الترحيل التي استدعتها (انظر postSalesInvoice).
 */
export async function sendInvoiceByEmail(
  tenantId: string,
  invoiceId: string,
  opts: { method: "auto" | "manual"; overrideEmail?: string },
): Promise<SendInvoiceEmailResult> {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: invoicePdfInclude,
  });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن إرسال فاتورة لم تُرحَّل بعد");

  const to = opts.overrideEmail || invoice.customer.email;
  if (!to) return { sent: false, reason: "no_email" };

  try {
    // نستخدم لغة الشركة نفسها (Company.language) لا لغة الطلب الحالي — رسالة موجَّهة للعميل
    // الخارجي، فيجب أن تتبع تفضيل الشركة بصرف النظر عن لغة واجهة الموظف الذي أطلق الإرسال.
    const lang = (invoice.company.language as Lang) ?? "ar";
    const pdfBuffer = await buildInvoicePdfBuffer(tenantId, invoice);

    await sendInvoiceEmail({
      to,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      grandTotal: Number(invoice.grandTotal).toLocaleString(lang === "en" ? "en-US" : "ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      companyName: invoice.company.name,
      pdfBuffer,
      pdfFileName: `فاتورة-${invoice.invoiceNumber}.pdf`,
      lang,
      currency: currencyLabel(invoice.company.currency, lang),
    });

    await prisma.invoiceEmailLog.create({ data: { tenantId, invoiceId, sentTo: to, method: opts.method, success: true } });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل الفاتورة:", err);
    await prisma.invoiceEmailLog.create({
      data: { tenantId, invoiceId, sentTo: to, method: opts.method, success: false, error: err instanceof Error ? err.message : String(err) },
    });
    return { sent: false, reason: "send_failed" };
  }
}

export interface InvoiceWithoutSuccessfulEmail {
  id: string;
  invoiceNumber: string;
  date: Date;
  grandTotal: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  // آخر محاولة إرسال مُسجَّلة (نجحت أو فشلت) لهذه الفاتورة إن وُجدت — null يعني لم تُحاوَل الفاتورة
  // إطلاقاً بعد (عادة لأن العميل بلا بريد إلكتروني مسجَّل، فـsendInvoiceByEmail تعيد {sent:false,
  // reason:"no_email"} فوراً بلا تسجيل أي محاولة في InvoiceEmailLog — راجع تعليقها أعلاه).
  lastAttempt: { at: Date; method: string; reason: string | null } | null;
}

/**
 * قائمة للمتابعة اليدوية فقط (بلا أي أثر جانبي) — كل فاتورة مبيعات "posted" لهذا المستأجر لم
 * يُرسَل بريدها بنجاح ولو مرة واحدة قط، بصرف النظر عن السبب: لم تُحاوَل إطلاقاً (لا بريد إلكتروني
 * مسجَّل للعميل)، أو حاولت وفشلت مرة أو أكثر (خدمة Resend متوقفة، أو فشل توليد PDF — بالضبط عطل
 * Chromium الذي دفع لهذا الإصلاح). عطل إنتاج فعلي كان السبب: كل هذه الحالات كانت تفشل بصمت تام
 * (sendInvoiceByEmail تبتلع الخطأ عمداً حتى لا توقف الترحيل) بلا أي وسيلة لمعرفة أي الفواتير
 * تحتاج متابعة يدوية إلا بقراءة سجلات الخادم مباشرة. راجع resendInvoiceEmail أدناه لإعادة
 * المحاولة يدوياً — لا إعادة إرسال تلقائية إطلاقاً من هذه الدالة أو أي مكان آخر.
 */
export async function listInvoicesWithoutSuccessfulEmail(
  tenantId: string,
  filters: { companyId?: string },
): Promise<InvoiceWithoutSuccessfulEmail[]> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      status: "posted",
      emailLogs: { none: { success: true } },
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      emailLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { date: "asc" },
  });

  return invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    grandTotal: inv.grandTotal.toString(),
    customerId: inv.customer.id,
    customerName: inv.customer.name,
    customerEmail: inv.customer.email,
    lastAttempt: inv.emailLogs[0]
      ? { at: inv.emailLogs[0].createdAt, method: inv.emailLogs[0].method, reason: inv.emailLogs[0].error }
      : null,
  }));
}

/**
 * إعادة إرسال يدوية صريحة لفاتورة من قائمة listInvoicesWithoutSuccessfulEmail أعلاه — بالضبط نفس
 * منطق sendInvoiceByEmail(method: "manual") الذي تستخدمه بالفعل نقطة نهاية إعادة الإرسال العادية
 * (POST /:id/send-email)، تحت اسم واضح الغرض لهذا المسار تحديداً. لا إعادة إرسال تلقائية أو
 * مجدولة إطلاقاً من أي مكان — يتطلب طلباً صريحاً من مستخدم حقيقي في كل مرة.
 */
export async function resendInvoiceEmail(tenantId: string, invoiceId: string, overrideEmail?: string): Promise<SendInvoiceEmailResult> {
  return sendInvoiceByEmail(tenantId, invoiceId, { method: "manual", overrideEmail });
}
