import { describe, expect, it, vi } from "vitest";
vi.mock("./prisma", () => ({ prisma: {} }));
import { summarizeInvoiceCredits } from "./invoiceCredits";
describe("invoice credit balances", () => {
 const invoice = { grandTotal: 115, receiptAllocations: [] };
 it("reduces due only after posting the credit note", () => {
  expect(summarizeInvoiceCredits(invoice, [{ status: "pending_submission", grandTotal: 50, refundMethod: "account" }]).outstandingAmount).toBe(115);
  expect(summarizeInvoiceCredits(invoice, [{ status: "posted", grandTotal: 50, refundMethod: "account" }]).outstandingAmount).toBe(65);
 });
 it("fully returned unpaid invoice has zero due", () => {
  const result = summarizeInvoiceCredits(invoice, [{ status: "posted", grandTotal: 115, refundMethod: "account" }]);
  expect(result.outstandingAmount).toBe(0); expect(result.returnStatus).toBe("full");
 });
 it("paid invoice return leaves credit for the customer", () => {
  const result = summarizeInvoiceCredits({ ...invoice, receiptAllocations: [{ amount: 115 }] }, [{ status: "posted", grandTotal: 50, refundMethod: "account" }]);
  expect(result.customerCreditAmount).toBe(50); expect(result.outstandingAmount).toBe(0);
 });
 it("cash refunds do not also credit the receivable", () => {
  const result = summarizeInvoiceCredits(invoice, [{ status: "posted", grandTotal: 50, refundMethod: "cash" }]);
  expect(result.netGrandTotal).toBe(65); expect(result.outstandingAmount).toBe(115);
 });
 it("unposting a note removes its balance effect", () => expect(summarizeInvoiceCredits(invoice, [{ status: "draft", grandTotal: 50 }]).returnedAmount).toBe(0));
});
