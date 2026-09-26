import { describe, expect, it } from "vitest";
import { searchSalesInvoicesQuerySchema, INVOICE_SEARCH_PAGE_SIZES } from "./salesInvoices.schemas";

describe("searchSalesInvoicesQuerySchema", () => {
  it("applies defaults when only companyId is given", () => {
    const parsed = searchSalesInvoicesQuerySchema.parse({ companyId: "co_1" });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.sortBy).toBe("date");
    expect(parsed.sortDir).toBe("desc");
    expect(parsed.q).toBeUndefined();
  });

  it.each(INVOICE_SEARCH_PAGE_SIZES)("accepts allowed pageSize %i", (pageSize) => {
    const parsed = searchSalesInvoicesQuerySchema.parse({ pageSize: String(pageSize) });
    expect(parsed.pageSize).toBe(pageSize);
  });

  it.each([10, 20, 30, 0, -1, 1000])("rejects disallowed pageSize %i", (pageSize) => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ pageSize: String(pageSize) });
    expect(result.success).toBe(false);
  });

  it("rejects dateFrom after dateTo", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ dateFrom: "2026-02-01", dateTo: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("accepts dateFrom equal to dateTo (single-day range)", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ dateFrom: "2026-01-15", dateTo: "2026-01-15" });
    expect(result.success).toBe(true);
  });

  it("rejects amountMin above amountMax", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ amountMin: "500", amountMax: "100" });
    expect(result.success).toBe(false);
  });

  it("accepts amountMin equal to amountMax", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ amountMin: "100", amountMax: "100" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date (not YYYY-MM-DD)", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ dateFrom: "01-15-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid invoiceType", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ invoiceType: "credit" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid zatcaStatus (raw enum values are not accepted)", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ zatcaStatus: "cleared" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only q", () => {
    const result = searchSalesInvoicesQuerySchema.safeParse({ q: "   " });
    expect(result.success).toBe(false);
  });

  it("treats an omitted q as absent", () => {
    const parsed = searchSalesInvoicesQuerySchema.parse({});
    expect(parsed.q).toBeUndefined();
  });

  it("trims q", () => {
    const parsed = searchSalesInvoicesQuerySchema.parse({ q: "  INV-1  " });
    expect(parsed.q).toBe("INV-1");
  });
});
