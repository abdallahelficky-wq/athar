import { afterEach, describe, expect, it, vi } from "vitest";

// إعداد Mocks لكل التبعيات الخارجية لـ createSalesInvoice (قاعدة البيانات، بوابة زاتكا، الإيميل)
// حتى يمكن اختبار المنطق الحسابي المحض بمعزل عنها — لا Postgres حقيقي متاح في بيئة الاختبار.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    item: { findMany: vi.fn() },
    salesInvoice: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
// المسار المُعاد هيكلته (ثلاث مراحل) لا يستدعي evaluateZatcaPostingGate القديمة إطلاقاً من
// createSalesInvoice — المرحلة 1 تحجز السلسلة عبر reserveZatcaChain مباشرة (بلا اتصال شبكي)،
// والمرحلة 2 (submitZatcaChainDocument) هي من يتصل فعلياً بزاتكا بعد إغلاق المعاملة.
vi.mock("../../lib/zatca/chain", () => ({ reserveZatcaChain: vi.fn(), rebuildZatcaDocumentXml: vi.fn() }));
vi.mock("../../lib/zatca/postingGate", () => ({ reserveZatcaChainForPosting: vi.fn(), submitZatcaChainDocument: vi.fn() }));
vi.mock("../../lib/docNumbering", () => ({ reserveDocumentNumber: vi.fn() }));
vi.mock("../../lib/journalPosting", () => ({
  createJournalEntryTx: vi.fn(),
  deleteJournalEntryTx: vi.fn(),
  assertValidUnlockPin: vi.fn(),
  writeUnpostAuditLogTx: vi.fn(),
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn() }));
vi.mock("../../lib/partyAccounts", () => ({ resolvePartyAccountId: vi.fn() }));
vi.mock("./salesInvoiceEmail.service", () => ({ sendInvoiceByEmail: vi.fn() }));
vi.mock("../stables/stablesBilling.service", () => ({ accrueTrainerCommissionsTx: vi.fn(), reverseTrainerCommissionsTx: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { reserveZatcaChain } from "../../lib/zatca/chain";
import { submitZatcaChainDocument } from "../../lib/zatca/postingGate";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { sendInvoiceByEmail } from "./salesInvoiceEmail.service";
import { accrueTrainerCommissionsTx } from "../stables/stablesBilling.service";
import { createSalesInvoice } from "./salesInvoices.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";
const ACCOUNT_ID = "revenue-account-1";

function setupHappyPathMocks() {
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID, tenantId: TENANT_ID, name: "شركة تجريبية", vatNumber: "300000000000003" } as never);
  vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: CUSTOMER_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, customerType: "individual", vatNumber: null, name: "عميل تجريبي", accountId: null } as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
  vi.mocked(getAccountIdByName).mockResolvedValue("vat-output-account");
  vi.mocked(resolvePartyAccountId).mockResolvedValue("receivable-account");
  vi.mocked(reserveDocumentNumber).mockResolvedValue("INV-00001");
  vi.mocked(createJournalEntryTx).mockResolvedValue({ id: "journal-1" } as never);
  vi.mocked(sendInvoiceByEmail).mockResolvedValue({ sent: false } as never);
  vi.mocked(accrueTrainerCommissionsTx).mockResolvedValue(undefined as never);

  // المرحلة 1 (حجز السلسلة، بلا اتصال شبكي) — هذا الاستدعاء بالذات يستقبل الأسطر المُقرَّبة التي
  // يقارنها الاختبار أدناه بما كُتب فعلياً على صف الفاتورة.
  vi.mocked(reserveZatcaChain).mockResolvedValue({
    icv: 1,
    previousInvoiceHash: "PIH",
    invoiceHash: "HASH",
    issuedAt: new Date("2026-01-01T12:00:00Z"),
    zatcaStatus: "not_submitted",
    xml: "<xml/>",
    subtype: "simplified",
  } as never);
  // المرحلة 2 (اتصال زاتكا الفعلي، خارج أي معاملة) — مُموَّهة لتُقبَل مباشرة؛ لا علاقة لها بهدف
  // هذا الاختبار (تطابق التقريب)، لكنها جزء من المسار الكامل الذي يُشغَّل حتى النهاية.
  vi.mocked(submitZatcaChainDocument).mockResolvedValue({
    proceedWithPosting: true,
    zatcaFields: { zatcaStatus: "cleared", icv: 1, previousInvoiceHash: "PIH", invoiceHash: "HASH", zatcaSubmittedAt: new Date("2026-01-01T12:00:00Z") },
  } as never);
  // المرحلة 3أ (تحديث سطر واحد) — تُعيد صفاً كافياً لإكمال المرحلة 3ب بلا انهيار (grandTotal/
  // receiptAllocations مطلوبان لـwithPaymentStatus)؛ فشل المرحلة 3ب نفسها (tx وهمية بالحد الأدنى) لا
  // يفسد هذا الاختبار — تُعامَل بنفس التصميم المقصود: صف zatca_accepted_posting_incomplete قابل
  // للإكمال لاحقاً، لا خطأ 500 عام.
  vi.mocked(prisma.salesInvoice.update).mockResolvedValue({
    id: "invoice-1", companyId: COMPANY_ID, branchId: null, date: new Date("2026-01-01"),
    invoiceNumber: "INV-00001", customer: { name: "عميل تجريبي" }, grandTotal: 0, receiptAllocations: [],
  } as never);

  // $transaction تُستدعى مرتين هنا: مرة قصيرة لحجز الرقم/السلسلة وكتابة الصف (المرحلة 1، تُنفّذ رد
  // النداء مباشرة)، ومرة أخرى محتملة للمرحلة 3ب — كلتاهما تكتفيان بتمرير tx وهمي بأدنى ما يلزمه
  // الكود المُختبَر فعلياً.
  const tx = {
    journalEntry: { update: vi.fn().mockResolvedValue({}) },
    salesInvoice: { create: vi.fn(), update: vi.fn().mockResolvedValue({ id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 0 }) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(((fn: any) => fn(tx)) as never);
  return { tx };
}

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.account.findMany).mockReset();
  vi.mocked(prisma.item.findMany).mockReset();
  vi.mocked(prisma.salesInvoice.update).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(reserveZatcaChain).mockReset();
  vi.mocked(submitZatcaChainDocument).mockReset();
  vi.mocked(reserveDocumentNumber).mockReset();
  vi.mocked(createJournalEntryTx).mockReset();
  vi.mocked(getAccountIdByName).mockReset();
  vi.mocked(resolvePartyAccountId).mockReset();
  vi.mocked(sendInvoiceByEmail).mockReset();
  vi.mocked(accrueTrainerCommissionsTx).mockReset();
});

describe("createSalesInvoice — ZATCA gate vs persisted row", () => {
  // هذا هو الاختبار الذي طلبه المستخدم صراحةً: القيم التي تستقبلها بوابة زاتكا (وتُوقَّع وتُبلَّغ
  // بها للهيئة) يجب أن تكون مطابقة تماماً — لا بالصدفة بعد تقريب Postgres لاحقاً — للقيم التي
  // تُكتَب فعلياً في نفس المعاملة على سطر الفاتورة وإجمالياتها. الأسطر هنا مُختارة عمداً بحيث ينتج
  // عنها ضريبة غير قابلة لتمثيل دقيق بخانتين عشريتين (105 شامل الضريبة → 13.695652...) لتُثبت أن
  // التطابق قائم على تقريب فعلي مُطبَّق قبل أي إرسال، لا على تساوٍ صدفة بين رقمين غير مقرَّبين.
  it("sends the exact same rounded line/header amounts to the gate and to the DB write", async () => {
    const { tx } = setupHappyPathMocks();
    vi.mocked(tx.salesInvoice.create).mockImplementation(((args: any) => Promise.resolve({ id: "invoice-1", ...args.data, lines: [], receiptAllocations: [] })) as never);

    await createSalesInvoice(TENANT_ID, "user-1", {
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      date: new Date("2026-01-01"),
      lines: [
        { accountId: ACCOUNT_ID, quantity: 1, unitPrice: 105, priceIncludesVat: true },
        { accountId: ACCOUNT_ID, quantity: 3, unitPrice: 10.1, priceIncludesVat: true },
      ],
    });

    // المرحلة 1: نفس استدعاء reserveZatcaChain (الأسطر المُرسَلة لاحقاً لزاتكا عبر XML) يجب أن يحمل
    // نفس subtotal/vat المُقرَّبة حرفياً المكتوبة على صف الفاتورة في نفس المعاملة بالضبط.
    expect(reserveZatcaChain).toHaveBeenCalledTimes(1);
    const chainArgs = vi.mocked(reserveZatcaChain).mock.calls[0][1] as any;
    expect(tx.salesInvoice.create).toHaveBeenCalledTimes(1);
    const createArgs = vi.mocked(tx.salesInvoice.create).mock.calls[0][0] as any;
    const persistedLines = createArgs.data.lines.create;

    expect(chainArgs.lines).toHaveLength(persistedLines.length);
    chainArgs.lines.forEach((chainLine: any, i: number) => {
      expect(chainLine.subtotal).toBe(persistedLines[i].subtotal);
      expect(chainLine.vat).toBe(persistedLines[i].vat);
    });

    // المرحلة 2 (submitZatcaChainDocument، بعد إغلاق المعاملة): نفس إجماليات الرأس المكتوبة على
    // صف الفاتورة حرفياً — لا القيم الخام غير المقرَّبة قبل الكتابة.
    expect(submitZatcaChainDocument).toHaveBeenCalledTimes(1);
    const submitArgs = vi.mocked(submitZatcaChainDocument).mock.calls[0][0] as any;
    expect(submitArgs.vatTotal).toBe(createArgs.data.vatTotal);
    expect(submitArgs.grandTotal).toBe(createArgs.data.grandTotal);

    // وتأكيد مباشر أن الأرقام فعلاً مُقرَّبة (لا الدقة الكاملة غير المقرَّبة القديمة) — إثبات أن
    // التطابق ناتج عن تقريب صريح مُطبَّق مسبقاً، لا تساوٍ صدفة بين قيمتين غير مقرَّبتين.
    expect(persistedLines[0].vat).toBe(13.7);
    expect(persistedLines[0].subtotal).toBe(91.3);
    expect(createArgs.data.vatTotal).toBe(17.65); // 13.70 + 3.95
    expect(createArgs.data.grandTotal).toBeCloseTo(135.3, 10); // 105 + 30.3 (floating-point sum, not itself re-rounded)
  });
});
