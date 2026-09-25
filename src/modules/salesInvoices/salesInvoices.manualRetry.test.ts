import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => ({ prisma: { salesInvoice: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() } } }));
vi.mock("../../lib/zatca/resubmit", () => ({ resubmitZatcaDocument: vi.fn() }));
vi.mock("./salesInvoiceEmail.service", () => ({ sendInvoiceByEmail: vi.fn() }));
import { prisma } from "../../lib/prisma";
import { resubmitZatcaDocument } from "../../lib/zatca/resubmit";
import { resendInvoiceToZatca } from "./salesInvoices.service";
const invoice = { id: "inv", status: "posted", zatcaStatus: "not_submitted", zatcaRetryCount: 0, zatcaLastAttemptAt: null,
 icv: 7, previousInvoiceHash: "previous", invoiceHash: "hash", zatcaUuid: "uuid", zatcaSubmittedAt: new Date(),
 invoiceNumber: "INV-7", company: {}, customer: {}, lines: [], grandTotal: 115, vatTotal: 15, receiptAllocations: [] };
beforeEach(() => vi.resetAllMocks());
describe("manual invoice submission", () => {
 it("allows a posted not_submitted invoice, preserving its original chain", async () => {
  vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue(invoice as never);
  vi.mocked(prisma.salesInvoice.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(resubmitZatcaDocument).mockResolvedValue({ zatcaStatus: "reported" } as never);
  vi.mocked(prisma.salesInvoice.update).mockResolvedValue({ ...invoice, zatcaStatus: "reported" } as never);
  expect((await resendInvoiceToZatca("tenant", "inv")).zatcaStatus).toBe("reported");
  expect(resubmitZatcaDocument).toHaveBeenCalledWith(expect.objectContaining({ icv: 7, invoiceHash: "hash", documentUuid: "uuid" }));
 });
 it.each(["cleared", "reported", "not_applicable"])("does not resend %s invoices", async (zatcaStatus) => {
  vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ ...invoice, zatcaStatus } as never);
  await expect(resendInvoiceToZatca("tenant", "inv")).rejects.toThrow();
  expect(resubmitZatcaDocument).not.toHaveBeenCalled();
 });
 it("does not send a draft", async () => {
  vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue({ ...invoice, status: "draft" } as never);
  await expect(resendInvoiceToZatca("tenant", "inv")).rejects.toThrow();
  expect(resubmitZatcaDocument).not.toHaveBeenCalled();
 });
 it("honors the concurrent retry claim", async () => {
  vi.mocked(prisma.salesInvoice.findFirst).mockResolvedValue(invoice as never);
  vi.mocked(prisma.salesInvoice.updateMany).mockResolvedValue({ count: 0 });
  await expect(resendInvoiceToZatca("tenant", "inv")).rejects.toThrow();
  expect(resubmitZatcaDocument).not.toHaveBeenCalled();
 });
});
