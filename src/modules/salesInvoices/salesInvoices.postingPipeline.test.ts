import { afterEach, describe, expect, it, vi } from "vitest";

// اختبارات STEP 3 (طلب المستخدم) لمسار الترحيل الآمن على ثلاث مراحل للفواتير — كل استدعاء زاتكا
// هنا مُموَّه بالكامل (submitZatcaChainDocument)؛ لا اتصال شبكي حقيقي بزاتكا إطلاقاً في أي اختبار
// من هذا الملف. راجع نفس التصميم بالضبط في salesReturns.postingPipeline.test.ts وsalesDebitNotes.postingPipeline.test.ts.
vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    customer: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    item: { findMany: vi.fn() },
    salesInvoice: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
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
import { reserveZatcaChain, rebuildZatcaDocumentXml } from "../../lib/zatca/chain";
import { submitZatcaChainDocument } from "../../lib/zatca/postingGate";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { sendInvoiceByEmail } from "./salesInvoiceEmail.service";
import { accrueTrainerCommissionsTx } from "../stables/stablesBilling.service";
import { createSalesInvoice, retryPendingZatcaSubmission, completeZatcaAcceptedPosting } from "./salesInvoices.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";
const ACCOUNT_ID = "revenue-account-1";

const COMPANY_ROW = { id: COMPANY_ID, tenantId: TENANT_ID, name: "شركة تجريبية", vatNumber: "300000000000003" };
const CUSTOMER_ROW = { id: CUSTOMER_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, customerType: "individual", vatNumber: null, name: "عميل تجريبي", accountId: null };

const CHAIN_RESULT = {
  icv: 42,
  previousInvoiceHash: "PIH-42",
  invoiceHash: "HASH-42",
  issuedAt: new Date("2026-01-01T12:00:00Z"),
  zatcaStatus: "not_submitted" as const,
  xml: "<xml/>",
  subtype: "simplified" as const,
};

function setupCommonMocks() {
  vi.mocked(prisma.company.findFirst).mockResolvedValue(COMPANY_ROW as never);
  vi.mocked(prisma.company.findFirstOrThrow).mockResolvedValue(COMPANY_ROW as never);
  vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
  vi.mocked(getAccountIdByName).mockResolvedValue("vat-output-account");
  vi.mocked(resolvePartyAccountId).mockResolvedValue("receivable-account");
  vi.mocked(reserveDocumentNumber).mockResolvedValue("INV-00001");
  vi.mocked(createJournalEntryTx).mockResolvedValue({ id: "journal-1" } as never);
  vi.mocked(sendInvoiceByEmail).mockResolvedValue({ sent: false } as never);
  vi.mocked(accrueTrainerCommissionsTx).mockResolvedValue(undefined as never);
  vi.mocked(reserveZatcaChain).mockResolvedValue(CHAIN_RESULT as never);
  vi.mocked(prisma.salesInvoice.update).mockResolvedValue({
    id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 115, companyId: COMPANY_ID, branchId: null,
    date: new Date("2026-01-01"), invoiceNumber: "INV-00001", customer: CUSTOMER_ROW,
  } as never);

  const tx = {
    journalEntry: { update: vi.fn().mockResolvedValue({}) },
    salesInvoice: {
      create: vi.fn().mockImplementation(((args: any) => Promise.resolve({ id: "invoice-1", ...args.data, lines: [], receiptAllocations: [], customer: CUSTOMER_ROW })) as never),
      update: vi.fn().mockResolvedValue({ id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 115 }),
    },
  };
  vi.mocked(prisma.$transaction).mockImplementation(((fn: any) => fn(tx)) as never);
  return { tx };
}

function invoiceInput() {
  return {
    companyId: COMPANY_ID,
    customerId: CUSTOMER_ID,
    date: new Date("2026-01-01"),
    lines: [{ accountId: ACCOUNT_ID, quantity: 1, unitPrice: 100, priceIncludesVat: false }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.company.findFirstOrThrow).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.account.findMany).mockReset();
  vi.mocked(prisma.item.findMany).mockReset();
  vi.mocked(prisma.salesInvoice.findFirst).mockReset();
  vi.mocked(prisma.salesInvoice.update).mockReset();
  vi.mocked(prisma.salesInvoice.updateMany).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(reserveZatcaChain).mockReset();
  vi.mocked(rebuildZatcaDocumentXml).mockReset();
  vi.mocked(submitZatcaChainDocument).mockReset();
  vi.mocked(reserveDocumentNumber).mockReset();
  vi.mocked(createJournalEntryTx).mockReset();
  vi.mocked(getAccountIdByName).mockReset();
  vi.mocked(resolvePartyAccountId).mockReset();
  vi.mocked(sendInvoiceByEmail).mockReset();
  vi.mocked(accrueTrainerCommissionsTx).mockReset();
});

describe("three-phase ZATCA posting — 10s ZATCA latency loses nothing", () => {
  it("commits phase 1 (row reserved as pending_submission) before ZATCA even responds, and still finishes posting once it does", async () => {
    const { tx } = setupCommonMocks();
    const order: string[] = [];
    vi.mocked(tx.salesInvoice.create).mockImplementation(((args: any) => {
      order.push("phase1-create");
      return Promise.resolve({ id: "invoice-1", ...args.data, lines: [], receiptAllocations: [], customer: CUSTOMER_ROW });
    }) as never);
    vi.mocked(submitZatcaChainDocument).mockImplementation((async () => {
      // يُحاكي زمن استجابة زاتكا 10 ثوانٍ — لا معاملة قاعدة بيانات مفتوحة أثناء هذا التأخير إطلاقاً
      // (هذه الدالة لا تقبل tx من الأساس)، فلا مهلة معاملة يمكن أن تنقضي بسببه.
      order.push("phase2-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("phase2-end");
      return { proceedWithPosting: true, zatcaFields: { zatcaStatus: "reported", icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt } };
    }) as never);
    vi.mocked(prisma.salesInvoice.update).mockImplementation((async (args: any) => {
      order.push("phase3a-update");
      return { id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 115, companyId: COMPANY_ID, branchId: null, date: new Date("2026-01-01"), invoiceNumber: "INV-00001", customer: CUSTOMER_ROW, ...args.data };
    }) as never);

    const result = await createSalesInvoice(TENANT_ID, "user-1", invoiceInput());

    // ترتيب الأحداث يثبت الفصل الفعلي: المرحلة 1 (كتابة الصف) اكتملت قبل بدء الاتصال بزاتكا، لا
    // أثناءه — العكس بالضبط هو العطل الذي دفع لهذا الإصلاح (اتصال بزاتكا داخل معاملة سقفها 8000ms).
    expect(order).toEqual(["phase1-create", "phase2-start", "phase2-end", "phase3a-update"]);
    expect(result.postingIncomplete).toBeUndefined();
    expect(result.rejectionReason).toBeUndefined();
  });
});

describe("three-phase ZATCA posting — phase 3b failure is recoverable, not a lost ZATCA response", () => {
  it("leaves the row zatca_accepted_posting_incomplete with the ZATCA response saved when phase 3b (journal/stock) throws", async () => {
    const { tx } = setupCommonMocks();
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "reported", icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt, zatcaResponseRaw: { ok: true } },
    } as never);
    let phase3aData: any;
    vi.mocked(prisma.salesInvoice.update).mockImplementation((async (args: any) => {
      phase3aData = args.data;
      return { id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 115, companyId: COMPANY_ID, branchId: null, date: new Date("2026-01-01"), invoiceNumber: "INV-00001", customer: CUSTOMER_ROW, ...args.data };
    }) as never);
    // المرحلة 3ب (معاملة ثانية منفصلة) تفشل — القيد المحاسبي نفسه يرمي خطأً غير متوقَّع.
    vi.mocked(createJournalEntryTx).mockRejectedValueOnce(new Error("db timeout inside phase 3b"));

    const result = await createSalesInvoice(TENANT_ID, "user-1", invoiceInput());

    // ردّ زاتكا (zatcaStatus/zatcaResponseRaw) مكتوب فعلاً على الصف — هذا بالضبط ما كان يُفقَد في
    // الحادثة الأصلية (ردّ ناجح من زاتكا يُهدَر عند فشل معاملة محلية بحتة لاحقة له).
    expect(phase3aData.zatcaStatus).toBe("reported");
    expect(phase3aData.zatcaResponseRaw).toEqual({ ok: true });
    expect(phase3aData.status).toBe("zatca_accepted_posting_incomplete");
    expect(result.postingIncomplete).toBe(true);
    void tx;
  });
});

describe("completeZatcaAcceptedPosting — completes a stuck row without contacting ZATCA again", () => {
  it("does not call submitZatcaChainDocument, and posts the journal entry using the already-saved ZATCA response", async () => {
    setupCommonMocks();
    const stuckInvoice = {
      id: "invoice-1", tenantId: TENANT_ID, companyId: COMPANY_ID, branchId: null, customerId: CUSTOMER_ID,
      date: new Date("2026-01-01"), invoiceNumber: "INV-00001", zatcaUuid: "uuid-1",
      status: "zatca_accepted_posting_incomplete", zatcaStatus: "reported",
      icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt,
      subtotal: 100, vatTotal: 15, grandTotal: 115, receiptAllocations: [],
      customer: CUSTOMER_ROW,
      lines: [{ accountId: ACCOUNT_ID, itemId: null, description: null, subtotal: 100, vat: 15, total: 115, quantity: 1, unitPrice: 100, taxCategoryCode: "S", taxExemptionReason: null }],
    };
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue(stuckInvoice as never);

    const result = await completeZatcaAcceptedPosting(TENANT_ID, "user-1", "invoice-1");

    expect(submitZatcaChainDocument).not.toHaveBeenCalled();
    expect(createJournalEntryTx).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("invoice-1");
  });
});

describe("retryPendingZatcaSubmission — reuses the same identifiers, never mints new ones", () => {
  it("rebuilds XML with the exact same UUID/ICV/document number already on the row, without reserving anything new", async () => {
    setupCommonMocks();
    const pendingInvoice = {
      id: "invoice-1", tenantId: TENANT_ID, companyId: COMPANY_ID, branchId: null, customerId: CUSTOMER_ID,
      date: new Date("2026-01-01"), invoiceNumber: "INV-00001", zatcaUuid: "uuid-original",
      status: "pending_submission", zatcaStatus: "not_submitted", zatcaRetryCount: 0, zatcaLastAttemptAt: null,
      icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt,
      subtotal: 100, vatTotal: 15, grandTotal: 115, receiptAllocations: [],
      customer: CUSTOMER_ROW,
      lines: [{ accountId: ACCOUNT_ID, itemId: null, description: null, subtotal: 100, vat: 15, total: 115, quantity: 1, unitPrice: 100, taxCategoryCode: "S", taxExemptionReason: null }],
    };
    vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue(pendingInvoice as never);
    vi.mocked(prisma.salesInvoice.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(rebuildZatcaDocumentXml).mockReturnValue({ xml: "<xml/>", invoiceHash: "HASH-42", subtype: "simplified" } as never);
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "reported", icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt },
    } as never);

    await retryPendingZatcaSubmission(TENANT_ID, "user-1", "invoice-1");

    expect(reserveZatcaChain).not.toHaveBeenCalled();
    expect(reserveDocumentNumber).not.toHaveBeenCalled();
    expect(rebuildZatcaDocumentXml).toHaveBeenCalledTimes(1);
    const rebuildArgs = vi.mocked(rebuildZatcaDocumentXml).mock.calls[0][0] as any;
    expect(rebuildArgs.documentUuid).toBe("uuid-original");
    expect(rebuildArgs.documentNumber).toBe("INV-00001");
    expect(rebuildArgs.icv).toBe(42);
    expect(rebuildArgs.previousInvoiceHash).toBe("PIH-42");

    const submitArgs = vi.mocked(submitZatcaChainDocument).mock.calls[0][0] as any;
    expect(submitArgs.documentUuid).toBe("uuid-original");
    expect(submitArgs.documentNumber).toBe("INV-00001");
  });
});

describe("ZATCA rejection — no journal entry is ever created for a rejected STANDARD invoice", () => {
  it("keeps the row pending_submission with the rejection saved, and never touches createJournalEntryTx", async () => {
    setupCommonMocks();
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: false,
      zatcaFields: { zatcaStatus: "rejected", icv: 42, previousInvoiceHash: "PIH-42", invoiceHash: "HASH-42", zatcaSubmittedAt: CHAIN_RESULT.issuedAt, zatcaResponseRaw: { rejected: true } },
      rejectionReason: "الرقم الضريبي للمشتري غير صحيح",
    } as never);
    let phase3aData: any;
    vi.mocked(prisma.salesInvoice.update).mockImplementation((async (args: any) => {
      phase3aData = args.data;
      return { id: "invoice-1", lines: [], receiptAllocations: [], grandTotal: 115, ...args.data };
    }) as never);

    const result = await createSalesInvoice(TENANT_ID, "user-1", invoiceInput());

    expect(createJournalEntryTx).not.toHaveBeenCalled();
    expect(phase3aData.status).toBe("pending_submission");
    expect(phase3aData.zatcaStatus).toBe("rejected");
    expect(result.rejectionReason).toBe("الرقم الضريبي للمشتري غير صحيح");
  });
});

it("persists zero-rated invoice lines without adding 15% and snapshots the exemption", async () => {
 const {tx}=setupCommonMocks();
 await createSalesInvoice(TENANT_ID,"user-1",{...invoiceInput(),post:false,lines:[{accountId:ACCOUNT_ID,quantity:1,unitPrice:100,priceIncludesVat:false,vatApplicable:true,taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine"}]});
 expect(tx.salesInvoice.create.mock.calls[0][0].data).toMatchObject({grandTotal:100,vatTotal:0,lines:{create:[expect.objectContaining({taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35",vat:0,vatApplicable:false})]}});
});
