import { afterEach, describe, expect, it, vi } from "vitest";

// إعداد Mocks لكل التبعيات الخارجية لـ createSalesInvoice (قاعدة البيانات، بوابة زاتكا، الإيميل)
// حتى يمكن اختبار المنطق الحسابي المحض بمعزل عنها — لا Postgres حقيقي متاح في بيئة الاختبار.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    item: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/zatca/postingGate", () => ({ evaluateZatcaPostingGate: vi.fn() }));
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

import { prisma } from "../../lib/prisma";
import { evaluateZatcaPostingGate } from "../../lib/zatca/postingGate";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { sendInvoiceByEmail } from "./salesInvoiceEmail.service";
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
  vi.mocked(evaluateZatcaPostingGate).mockResolvedValue({
    proceedWithPosting: true,
    zatcaFields: { zatcaStatus: "cleared" },
  } as never);

  // $transaction تُستدعى مرتين هنا: مرة قصيرة لحجز الرقم (تُنفّذ رد النداء مباشرة)، ومرة للكتابة
  // النهائية — كلتاهما تكتفيان بتمرير tx وهمي بأدنى ما يلزمه الكود المُختبَر فعلياً.
  const tx = {
    journalEntry: { update: vi.fn().mockResolvedValue({}) },
    salesInvoice: { create: vi.fn() },
  };
  vi.mocked(prisma.$transaction).mockImplementation(((fn: any) => fn(tx)) as never);
  return { tx };
}

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.account.findMany).mockReset();
  vi.mocked(prisma.item.findMany).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(evaluateZatcaPostingGate).mockReset();
  vi.mocked(reserveDocumentNumber).mockReset();
  vi.mocked(createJournalEntryTx).mockReset();
  vi.mocked(getAccountIdByName).mockReset();
  vi.mocked(resolvePartyAccountId).mockReset();
  vi.mocked(sendInvoiceByEmail).mockReset();
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

    expect(evaluateZatcaPostingGate).toHaveBeenCalledTimes(1);
    const gateArgs = vi.mocked(evaluateZatcaPostingGate).mock.calls[0][0] as any;
    expect(tx.salesInvoice.create).toHaveBeenCalledTimes(1);
    const createArgs = vi.mocked(tx.salesInvoice.create).mock.calls[0][0] as any;
    const persistedLines = createArgs.data.lines.create;

    // إجماليات الرأس: نفس القيمة حرفياً بين ما استقبلته البوابة وما كُتب في صف الفاتورة.
    expect(gateArgs.vatTotal).toBe(createArgs.data.vatTotal);
    expect(gateArgs.grandTotal).toBe(createArgs.data.grandTotal);

    // كل سطر: نفس subtotal/vat/total حرفياً — لا مجرد متقاربة بعد تقريب منفصل لاحقاً.
    expect(gateArgs.lines).toHaveLength(persistedLines.length);
    gateArgs.lines.forEach((gateLine: any, i: number) => {
      expect(gateLine.subtotal).toBe(persistedLines[i].subtotal);
      expect(gateLine.vat).toBe(persistedLines[i].vat);
      expect(gateLine.total).toBe(persistedLines[i].total);
    });

    // وتأكيد مباشر أن الأرقام فعلاً مُقرَّبة (لا الدقة الكاملة غير المقرَّبة القديمة) — إثبات أن
    // التطابق ناتج عن تقريب صريح مُطبَّق مسبقاً، لا تساوٍ صدفة بين قيمتين غير مقرَّبتين.
    expect(persistedLines[0].vat).toBe(13.7);
    expect(persistedLines[0].subtotal).toBe(91.3);
    expect(createArgs.data.vatTotal).toBe(17.65); // 13.70 + 3.95
    expect(createArgs.data.grandTotal).toBeCloseTo(135.3, 10); // 105 + 30.3 (floating-point sum, not itself re-rounded)
  });
});
