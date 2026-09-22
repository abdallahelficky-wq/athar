import { describe, expect, it } from "vitest";
import { assertReturnLimits } from "./returnLimits";
const invoice = { grandTotal: 115, lines: [{ id: "line", accountId: "a", quantity: 10 }] };
const line = { originalInvoiceLineId: "line", accountId: "a", quantity: 4 };
describe("linked return limits", () => {
 it("allows a partial return and ignores drafts", () => expect(() => assertReturnLimits(invoice, [{ status: "draft", grandTotal: 115, lines: [] }], [line], 46)).not.toThrow());
 it("reserves pending notes so concurrent new notes cannot over-credit", () => expect(() => assertReturnLimits(invoice, [{ status: "pending_submission", grandTotal: 100, lines: [] }], [line], 46)).toThrow());
 it("rejects repeated quantities even at a lower price", () => expect(() => assertReturnLimits(invoice, [{ status: "posted", grandTotal: 10, lines: [{ ...line, quantity: 8 }] }], [line], 1)).toThrow());
 it("sums repeated source lines in one request", () => expect(() => assertReturnLimits(invoice, [], [{ ...line, quantity: 6 }, { ...line, quantity: 5 }], 100)).toThrow());
 it("rejects unrelated source lines", () => expect(() => assertReturnLimits(invoice, [], [{ ...line, originalInvoiceLineId: "other" }], 10)).toThrow());
});
