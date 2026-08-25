import { describe, expect, it } from "vitest";
import { buildLiveryContractHtml } from "./liveryContractPdf";

describe("livery contract document", () => {
  it("renders dynamic owner and horse data with all bilingual clauses and signatures", () => {
    const html = buildLiveryContractHtml({ companyName: "شركة الاختبار", ownerName: "أحمد المالك", horseName: "برق", stableName: "الإسطبل الرئيسي", startDate: new Date("2026-08-25"), monthlyFee: "2500" });
    expect(html).toContain("أحمد المالك"); expect(html).toContain("برق");
    expect(html).toContain("14. اللغة والنسخ"); expect(html).toContain("14. Language and copies");
    expect(html).toContain("التوقيع / Signature");
  });

  it("escapes user-entered values", () => {
    const html = buildLiveryContractHtml({ companyName: "<script>alert(1)</script>", horseName: "H", stableName: "S", startDate: new Date("2026-08-25"), monthlyFee: "1" });
    expect(html).not.toContain("<script>alert(1)</script>"); expect(html).toContain("&lt;script&gt;");
  });
});
