import { test } from "node:test";
import assert from "node:assert/strict";
import { returnInvoiceLines } from "./returnInvoiceLines.js";
const invoice = { lines: [{ id: "l1", accountId: "a", description: "Item", quantity: "10", unitPrice: "3.5", discountPct: "0", priceIncludesVat: true, vatApplicable: true }], creditNotes: [] };
test("copies exact invoice terms for editable return quantities", () => {
 const line = returnInvoiceLines(invoice)[0]; assert.equal(line.quantity, 10); assert.equal(line.unitPrice, 3.5); assert.equal(line.originalInvoiceLineId, "l1"); assert.equal(line.priceIncludesVat, true);
});
test("subtracts prior posted and pending quantities but ignores draft notes", () => {
 const creditNotes = [{ status: "posted", lines: [{ originalInvoiceLineId: "l1", quantity: "3" }] }, { status: "pending_submission", lines: [{ originalInvoiceLineId: "l1", quantity: "2" }] }, { status: "draft", lines: [{ originalInvoiceLineId: "l1", quantity: "8" }] }];
 assert.equal(returnInvoiceLines({ ...invoice, creditNotes })[0].quantity, 5);
});
test("fully returned lines cannot be selected again", () => {
 assert.equal(returnInvoiceLines({ ...invoice, creditNotes: [{ status: "posted", lines: [{ originalInvoiceLineId: "l1", quantity: 10 }] }] }).length, 0);
});
