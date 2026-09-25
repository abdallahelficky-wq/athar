import { describe, expect, it } from "vitest";
import { searchSalesReturnsQuerySchema } from "./salesReturns.schemas";
import { SEARCH_PAGE_SIZES } from "../../lib/searchPagination";

describe("searchSalesReturnsQuerySchema", () => {
  it("applies defaults when only companyId is given", () => {
    const parsed = searchSalesReturnsQuerySchema.parse({ companyId: "co_1" });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.sortBy).toBe("date");
    expect(parsed.sortDir).toBe("desc");
    expect(parsed.q).toBeUndefined();
  });

  it.each(SEARCH_PAGE_SIZES)("accepts allowed pageSize %i", (pageSize) => {
    const parsed = searchSalesReturnsQuerySchema.parse({ pageSize: String(pageSize) });
    expect(parsed.pageSize).toBe(pageSize);
  });

  it.each([10, 20, 30, 0, -1, 1000])("rejects disallowed pageSize %i", (pageSize) => {
    const result = searchSalesReturnsQuerySchema.safeParse({ pageSize: String(pageSize) });
    expect(result.success).toBe(false);
  });

  it("rejects dateFrom after dateTo", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ dateFrom: "2026-02-01", dateTo: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("accepts dateFrom equal to dateTo (single-day range)", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ dateFrom: "2026-01-15", dateTo: "2026-01-15" });
    expect(result.success).toBe(true);
  });

  it("rejects amountMin above amountMax", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ amountMin: "500", amountMax: "100" });
    expect(result.success).toBe(false);
  });

  it("accepts amountMin equal to amountMax", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ amountMin: "100", amountMax: "100" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date (not YYYY-MM-DD)", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ dateFrom: "01-15-2026" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid subtype", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ subtype: "credit" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid refundMethod", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ refundMethod: "wallet" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid zatcaStatus (raw enum values are not accepted)", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ zatcaStatus: "cleared" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only q", () => {
    const result = searchSalesReturnsQuerySchema.safeParse({ q: "   " });
    expect(result.success).toBe(false);
  });

  it("treats an omitted q as absent", () => {
    const parsed = searchSalesReturnsQuerySchema.parse({});
    expect(parsed.q).toBeUndefined();
  });

  it("trims q", () => {
    const parsed = searchSalesReturnsQuerySchema.parse({ q: "  RET-1  " });
    expect(parsed.q).toBe("RET-1");
  });
});
