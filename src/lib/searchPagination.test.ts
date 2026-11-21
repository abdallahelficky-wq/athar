import { describe, expect, it } from "vitest";
import { parseListPage } from "./searchPagination";

describe("parseListPage", () => {
  it("is off without page (legacy full-array responses stay as they were)", () => {
    expect(parseListPage({})).toBeNull();
    expect(parseListPage({ companyId: "c1" })).toBeNull();
  });
  it("parses page, allowed page sizes only, trimmed search, status and an inclusive date range", () => {
    const p = parseListPage({ page: "3", pageSize: "50", q: "  INV-7 ", status: "draft", dateFrom: "2026-01-01", dateTo: "2026-01-31" })!;
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(50);
    expect(p.q).toBe("INV-7");
    expect(p.status).toBe("draft");
    expect(p.dateFrom?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.dateTo?.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });
  it("falls back safely on bad input (huge page size, bad status/date, page < 1)", () => {
    const p = parseListPage({ page: "0", pageSize: "100000", status: "x", dateFrom: "01/01/2026" })!;
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(25);
    expect(p.status).toBeUndefined();
    expect(p.dateFrom).toBeUndefined();
  });
});
