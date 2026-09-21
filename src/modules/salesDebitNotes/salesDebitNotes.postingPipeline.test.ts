import { afterEach, describe, expect, it, vi } from "vitest";

// اختبارات STEP 3 لمسار الترحيل الآمن على ثلاث مراحل لإشعارات المدين — نفس البنية بالضبط في
// salesReturns.postingPipeline.test.ts. كل اتصال بزاتكا هنا مُموَّه بالكامل (submitZatcaChainDocument).
vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesInvoice: { findFirst: vi.fn() },
    company: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    customer: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    salesDebitNote: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/zatca/chain", () => ({ reserveZatcaChain: vi.fn(), rebuildZatcaDocumentXml: vi.fn() }));
vi.mock("../../lib/zatca/postingGate", () => ({ submitZatcaChainDocument: vi.fn() }));
vi.mock("../../lib/docNumbering", () => ({ reserveDocumentNumber: vi.fn() }));
vi.mock("../../lib/journalPosting", () => ({
  createJournalEntryTx: vi.fn(),
  deleteJournalEntryTx: vi.fn(),
  assertValidUnlockPin: vi.fn(),
  writeUnpostAuditLogTx: vi.fn(),
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn() }));
vi.mock("../../lib/partyAccounts", () => ({ resolvePartyAccountId: vi.fn() }));

import { prisma } from "../../lib/prisma";
import { reserveZatcaChain, rebuildZatcaDocumentXml } from "../../lib/zatca/chain";
import { submitZatcaChainDocument } from "../../lib/zatca/postingGate";
import { reserveDocumentNumber } from "../../lib/docNumbering";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createSalesDebitNote, retryPendingZatcaSubmission, completeZatcaAcceptedPosting } from "./salesDebitNotes.service";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";
const ACCOUNT_ID = "revenue-account-1";
const RELATED_INVOICE_ID = "invoice-1";

const COMPANY_ROW = { id: COMPANY_ID, tenantId: TENANT_ID, name: "شركة تجريبية", vatNumber: "300000000000003" };
const CUSTOMER_ROW = { id: CUSTOMER_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, customerType: "business", vatNumber: "300000000000010", name: "عميل تجريبي", accountId: null };

const CHAIN_RESULT = {
  icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9",
  issuedAt: new Date("2026-01-01T12:00:00Z"), zatcaStatus: "not_submitted" as const, xml: "<xml/>", subtype: "standard" as const,
};

function setupCommonMocks() {
  vi.mocked(prisma.company.findFirst).mockResolvedValue(COMPANY_ROW as never);
  vi.mocked(prisma.company.findFirstOrThrow).mockResolvedValue(COMPANY_ROW as never);
  vi.mocked(prisma.customer.findFirst).mockResolvedValue(CUSTOMER_ROW as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: ACCOUNT_ID }] as never);
  vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ invoiceNumber: "INV-00001" } as never);
  vi.mocked(getAccountIdByName).mockResolvedValue("vat-output-account");
  vi.mocked(resolvePartyAccountId).mockResolvedValue("receivable-account");
  vi.mocked(reserveDocumentNumber).mockResolvedValue("DBN-00001");
  vi.mocked(createJournalEntryTx).mockResolvedValue({ id: "journal-1" } as never);
  vi.mocked(reserveZatcaChain).mockResolvedValue(CHAIN_RESULT as never);
  vi.mocked(prisma.salesDebitNote.update).mockResolvedValue({
    id: "debit-1", companyId: COMPANY_ID, date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", customer: CUSTOMER_ROW,
  } as never);

  const tx = {
    salesDebitNote: {
      create: vi.fn().mockImplementation(((args: any) => Promise.resolve({ id: "debit-1", ...args.data, customer: CUSTOMER_ROW })) as never),
      update: vi.fn().mockResolvedValue({ id: "debit-1", companyId: COMPANY_ID, date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", customer: CUSTOMER_ROW }),
    },
    journalEntry: { update: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(((fn: any) => fn(tx)) as never);
  return { tx };
}

function debitNoteInput() {
  return {
    companyId: COMPANY_ID,
    customerId: CUSTOMER_ID,
    relatedInvoiceId: RELATED_INVOICE_ID,
    reason: "رسوم إضافية",
    date: new Date("2026-01-01"),
    chargeMethod: "account" as const,
    lines: [{ accountId: ACCOUNT_ID, quantity: 1, unitPrice: 100, priceIncludesVat: false }],
  };
}

afterEach(() => {
  vi.mocked(prisma.company.findFirst).mockReset();
  vi.mocked(prisma.company.findFirstOrThrow).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.account.findMany).mockReset();
  vi.mocked(prisma.salesInvoice.findFirst).mockReset();
  vi.mocked(prisma.salesDebitNote.findFirst).mockReset();
  vi.mocked(prisma.salesDebitNote.update).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(reserveZatcaChain).mockReset();
  vi.mocked(rebuildZatcaDocumentXml).mockReset();
  vi.mocked(submitZatcaChainDocument).mockReset();
  vi.mocked(reserveDocumentNumber).mockReset();
  vi.mocked(createJournalEntryTx).mockReset();
  vi.mocked(getAccountIdByName).mockReset();
  vi.mocked(resolvePartyAccountId).mockReset();
});

describe("debit note three-phase ZATCA posting — 10s ZATCA latency loses nothing", () => {
  it("commits phase 1 before ZATCA responds, and finishes posting once it does", async () => {
    const { tx } = setupCommonMocks();
    const order: string[] = [];
    vi.mocked(tx.salesDebitNote.create).mockImplementation(((args: any) => {
      order.push("phase1-create");
      return Promise.resolve({ id: "debit-1", ...args.data, customer: CUSTOMER_ROW });
    }) as never);
    vi.mocked(submitZatcaChainDocument).mockImplementation((async () => {
      order.push("phase2-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("phase2-end");
      return { proceedWithPosting: true, zatcaFields: { zatcaStatus: "cleared", icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt } };
    }) as never);
    vi.mocked(prisma.salesDebitNote.update).mockImplementation((async (args: any) => {
      order.push("phase3a-update");
      return { id: "debit-1", companyId: COMPANY_ID, date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", customer: CUSTOMER_ROW, ...args.data };
    }) as never);

    const result = await createSalesDebitNote(TENANT_ID, "user-1", debitNoteInput());

    expect(order).toEqual(["phase1-create", "phase2-start", "phase2-end", "phase3a-update"]);
    expect(result.postingIncomplete).toBeUndefined();
    expect(result.rejectionReason).toBeUndefined();
  });
});

describe("debit note three-phase ZATCA posting — phase 3b failure is recoverable", () => {
  it("leaves the row zatca_accepted_posting_incomplete with the ZATCA response saved when phase 3b (journal) throws", async () => {
    setupCommonMocks();
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "cleared", icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt, zatcaResponseRaw: { ok: true } },
    } as never);
    let phase3aData: any;
    vi.mocked(prisma.salesDebitNote.update).mockImplementation((async (args: any) => {
      phase3aData = args.data;
      return { id: "debit-1", companyId: COMPANY_ID, date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", customer: CUSTOMER_ROW, ...args.data };
    }) as never);
    vi.mocked(createJournalEntryTx).mockRejectedValueOnce(new Error("db timeout inside phase 3b"));

    const result = await createSalesDebitNote(TENANT_ID, "user-1", debitNoteInput());

    expect(phase3aData.zatcaStatus).toBe("cleared");
    expect(phase3aData.zatcaResponseRaw).toEqual({ ok: true });
    expect(phase3aData.status).toBe("zatca_accepted_posting_incomplete");
    expect(result.postingIncomplete).toBe(true);
  });
});

describe("completeZatcaAcceptedPosting (debit note) — completes without contacting ZATCA again", () => {
  it("does not call submitZatcaChainDocument, and posts the journal entry from the already-saved ZATCA response", async () => {
    setupCommonMocks();
    const stuckDebitNote = {
      id: "debit-1", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID,
      relatedInvoiceId: RELATED_INVOICE_ID, reason: "رسوم إضافية", chargeMethod: "account",
      date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", zatcaUuid: "uuid-1",
      status: "zatca_accepted_posting_incomplete", zatcaStatus: "cleared",
      icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt,
      subtotal: 100, vatTotal: 15, grandTotal: 115,
      customer: CUSTOMER_ROW,
      lines: [{ accountId: ACCOUNT_ID, description: null, subtotal: 100, vat: 15, total: 115, quantity: 1, unitPrice: 100, taxCategoryCode: "S", taxExemptionReason: null }],
    };
    vi.mocked(prisma.salesDebitNote.findFirst).mockResolvedValue(stuckDebitNote as never);

    const result = await completeZatcaAcceptedPosting(TENANT_ID, "user-1", "debit-1");

    expect(submitZatcaChainDocument).not.toHaveBeenCalled();
    expect(createJournalEntryTx).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("debit-1");
  });
});

describe("retryPendingZatcaSubmission (debit note) — reuses the same identifiers", () => {
  it("rebuilds XML with the exact same UUID/ICV/debit note number already on the row, reserving nothing new", async () => {
    setupCommonMocks();
    const pendingDebitNote = {
      id: "debit-1", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID,
      relatedInvoiceId: RELATED_INVOICE_ID, reason: "رسوم إضافية", chargeMethod: "account",
      date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", zatcaUuid: "uuid-original",
      status: "pending_submission", zatcaStatus: "not_submitted",
      icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt,
      subtotal: 100, vatTotal: 15, grandTotal: 115,
      customer: CUSTOMER_ROW,
      lines: [{ accountId: ACCOUNT_ID, description: null, subtotal: 100, vat: 15, total: 115, quantity: 1, unitPrice: 100, taxCategoryCode: "S", taxExemptionReason: null }],
    };
    vi.mocked(prisma.salesDebitNote.findFirst).mockResolvedValue(pendingDebitNote as never);
    vi.mocked(rebuildZatcaDocumentXml).mockReturnValue({ xml: "<xml/>", invoiceHash: "HASH-9", subtype: "standard" } as never);
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: true,
      zatcaFields: { zatcaStatus: "cleared", icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt },
    } as never);

    await retryPendingZatcaSubmission(TENANT_ID, "user-1", "debit-1");

    expect(reserveZatcaChain).not.toHaveBeenCalled();
    expect(reserveDocumentNumber).not.toHaveBeenCalled();
    expect(rebuildZatcaDocumentXml).toHaveBeenCalledTimes(1);
    const rebuildArgs = vi.mocked(rebuildZatcaDocumentXml).mock.calls[0][0] as any;
    expect(rebuildArgs.documentUuid).toBe("uuid-original");
    expect(rebuildArgs.documentNumber).toBe("DBN-00001");
    expect(rebuildArgs.icv).toBe(9);
    expect(rebuildArgs.billingReferenceId).toBe("INV-00001");

    const submitArgs = vi.mocked(submitZatcaChainDocument).mock.calls[0][0] as any;
    expect(submitArgs.documentUuid).toBe("uuid-original");
    expect(submitArgs.documentNumber).toBe("DBN-00001");
  });
});

describe("ZATCA rejection (debit note) — no journal entry for a rejected STANDARD debit note", () => {
  it("keeps the row pending_submission with the rejection saved, and never touches createJournalEntryTx", async () => {
    setupCommonMocks();
    vi.mocked(submitZatcaChainDocument).mockResolvedValue({
      proceedWithPosting: false,
      zatcaFields: { zatcaStatus: "rejected", icv: 9, previousInvoiceHash: "PIH-9", invoiceHash: "HASH-9", zatcaSubmittedAt: CHAIN_RESULT.issuedAt, zatcaResponseRaw: { rejected: true } },
      rejectionReason: "خطأ في تنسيق إشعار المدين",
    } as never);
    let phase3aData: any;
    vi.mocked(prisma.salesDebitNote.update).mockImplementation((async (args: any) => {
      phase3aData = args.data;
      return { id: "debit-1", companyId: COMPANY_ID, date: new Date("2026-01-01"), debitNoteNumber: "DBN-00001", customer: CUSTOMER_ROW, ...args.data };
    }) as never);

    const result = await createSalesDebitNote(TENANT_ID, "user-1", debitNoteInput());

    expect(createJournalEntryTx).not.toHaveBeenCalled();
    expect(phase3aData.status).toBe("pending_submission");
    expect(phase3aData.zatcaStatus).toBe("rejected");
    expect(result.rejectionReason).toBe("خطأ في تنسيق إشعار المدين");
  });
});
