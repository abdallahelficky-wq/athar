import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../config/env", () => ({ env: { jwtAccessSecret: "x", jwtAccessExpiresIn: "15m" } }));
import { blockMutationsWhenReadOnly } from "./auth";

// الإعفاء من "عرض فقط" يطابق المسار الكامل (baseUrl + path) لا المسار داخل الراوتر وحده.
const req = (method: string, baseUrl: string, path: string) => ({ method, baseUrl, path, auth: { readOnly: true } }) as never;
const run = (r: never) => { const next = vi.fn(); blockMutationsWhenReadOnly(r, {} as never, next); return next; };

describe("read-only exemptions match the full path", () => {
  it.each([
    ["/api/ai/support", "/"],
    ["/api/journal-entries", "/bulk-import/preview"],
  ])("lets %s%s through for a read-only membership", (base, path) => {
    expect(run(req("POST", base, path))).toHaveBeenCalledOnce();
  });
  it.each([
    ["/api/sales-invoices", "/"],
    ["/api/purchase-invoices", "/bulk-import/preview"],
    ["/api/ai", "/support/x"],
  ])("still blocks a same-looking path under another router (%s%s)", (base, path) => {
    expect(() => run(req("POST", base, path))).toThrow(/عرض فقط/);
  });
  it("still blocks other methods on an exempt path", () => {
    expect(() => run(req("DELETE", "/api/ai/support", "/"))).toThrow();
  });
});
