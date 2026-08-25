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
    include: { lines: { include: { account: true, item: true } }, customer: true, company: true, branch: true, receiptAllocations: true },
  });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن إرسال فاتورة لم تُرحَّل بعد");

  const to = opts.overrideEmail || invoice.customer.email;
  if (!to) return { sent: false, reason: "no_email" };

  try {
    // نستخدم لغة الشركة نفسها (Company.language) لا لغة الطلب الحالي — رسالة موجَّهة للعميل
    // الخارجي، فيجب أن تتبع تفضيل الشركة بصرف النظر عن لغة واجهة الموظف الذي أطلق الإرسال.
    const lang = (invoice.company.language as Lang) ?? "ar";
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

    const pdfBuffer = await buildPlainInvoicePdf({
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
