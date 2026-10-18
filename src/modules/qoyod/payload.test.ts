import { describe, it, expect } from "vitest";
import { journalPayload } from "./payload";
const entry = { id: "j1", companyId: "c1", entryNumber: "J1", date: new Date("2026-10-15"), memo: "test", lines: [
  { accountId: "a", debit: "0.30", credit: "0", description: null },
  { accountId: "b", debit: "0", credit: "0.10", description: "one" },
  { accountId: "b", debit: "0", credit: "0.20", description: null },
] };
const mapping = { accounts: { a: 11, b: 12 }, contacts: {} };
describe("Qoyod journal payload", () => {
  it("preserves decimal balance and unique source marker", () => {
    const body = journalPayload(entry, mapping).journal_entry;
    expect(body.description).toContain("[ATHAR:c1:j1]");
    expect(body.debit_amounts).toEqual([{ account_id: 11, amount: "0.30", comment: "" }]);
    expect(body.credit_amounts).toHaveLength(2);
  });
  it("blocks unmapped accounts", () => expect(() => journalPayload(entry, { ...mapping, accounts: {} })).toThrow());
  it("blocks imbalance", () => expect(() => journalPayload({ ...entry, lines: entry.lines.slice(0, 2) }, mapping)).toThrow());
  it("never drops a party silently", () => expect(() => journalPayload({ ...entry, lines: entry.lines.map(l => ({ ...l, customerId: "customer1" })) }, mapping)).toThrow());
  it("preserves mapped contact", () => {
    const body = journalPayload({ ...entry, lines: entry.lines.map(l => ({ ...l, customerId: "customer1" })) }, { ...mapping, contacts: { "customer:customer1": 25 } });
    expect(body.journal_entry.debit_amounts[0]).toHaveProperty("contact_id", 25);
  });
});
