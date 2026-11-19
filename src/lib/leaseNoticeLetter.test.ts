import { describe, expect, it } from "vitest";
import { buildLeaseNoticeEmailHtml, buildLeaseNoticeLetter } from "./leaseNoticeLetter";

const base = {
  letterDate: "2026-11-19",
  company: { name: "شركة المثال للوقود", crNumber: "4030000000" },
  contract: { title: "محطة المثال", counterparty: "مؤسسة المؤجر النموذجي", contractNumber: "20000000001 / 1-0", signedOn: "2025-11-20", startDate: "2025-12-01", endDate: "2028-12-31", noticeDays: 60, address: "حي النموذج", city: "جدة" },
};

describe("buildLeaseNoticeLetter", () => {
  it("writes a renewal letter that cites the contract, the parties, its term and the notice clause", () => {
    const { subject, body } = buildLeaseNoticeLetter({ ...base, kind: "renewal" });
    expect(subject).toBe("إشعار برغبة تجديد عقد الإيجار رقم 20000000001 / 1-0");
    expect(body).toContain("التاريخ: 19/11/2026");
    expect(body).toContain("السادة/ مؤسسة المؤجر النموذجي");
    expect(body).toContain("بين مؤسسة المؤجر النموذجي (المؤجر) وشركة المثال للوقود (المستأجر)، بشأن محطة المثال — حي النموذج — جدة، ومدته من 01/12/2025 إلى 31/12/2028");
    expect(body).toContain("(60 يوماً قبل نهاية المدة)");
    expect(body).toContain("برغبتنا في تجديد العقد");
    expect(body).toContain("سجل تجاري رقم: 4030000000");
  });

  it("writes a non-renewal letter ending the lease at its term and pointing to the Ejar hand-over form", () => {
    const { subject, body } = buildLeaseNoticeLetter({ ...base, kind: "termination" });
    expect(subject).toBe("إشعار بعدم تجديد عقد الإيجار رقم 20000000001 / 1-0 وانتهائه بانتهاء مدته");
    expect(body).toContain("بعدم رغبتنا في تجديد العقد، وأن العلاقة الإيجارية تنتهي بانتهاء مدته في 31/12/2028");
    expect(body).toContain("نموذج تسليم الوحدة");
  });

  it("still reads correctly without a contract number, signing date, notice clause or CR", () => {
    const { subject, body } = buildLeaseNoticeLetter({ kind: "renewal", letterDate: "2026-11-19", company: { name: "شركة س" }, contract: { title: "محطة س", startDate: "2026-01-01", endDate: "2027-12-31" } });
    expect(subject).toBe("إشعار برغبة تجديد عقد الإيجار الخاص بـمحطة س");
    expect(body).toContain("السادة/ المؤجر");
    expect(body).not.toContain("والمبرم بتاريخ");
    expect(body).not.toContain("شرط الإشعار");
    expect(body).not.toContain("سجل تجاري");
  });

  it("escapes the letter inside the email body", () => {
    const html = buildLeaseNoticeEmailHtml({ companyName: "س", contractTitle: "<b>x</b>", kind: "termination", noticeDeadline: "2028-11-01", body: "a < b" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a &lt; b");
    expect(html).toContain("قبل 01/11/2028");
  });
});
