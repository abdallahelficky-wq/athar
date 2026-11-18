import { describe, expect, it } from "vitest";
import { buildLeaseReminderEmail, hasLeaseAlerts, type LeaseAlertsForEmail } from "./leaseReminderEmail";

const base: LeaseAlertsForEmail = {
  today: "2026-11-18", dueWithinDays: 30, renewalWithinDays: 90,
  overdue: [{ title: "محطة <الفاضل>", counterparty: "مؤجر & شركاه", dueDate: "2026-11-01", amount: 33333, days: -17 }],
  dueSoon: [{ title: "محطة تنومة", counterparty: null, dueDate: "2026-11-18", amount: 172500, days: 0 }],
  renewals: [{ title: "محطة حائل الدارة", endDate: "2027-04-19", noticeDeadline: "2027-01-19", daysToDeadline: 62, daysToEnd: 152, kind: "notice_soon", autoRenew: true }],
  totals: { overdue: 33333, dueSoon: 172500 },
};
const none: LeaseAlertsForEmail = { ...base, overdue: [], dueSoon: [], renewals: [], totals: { overdue: 0, dueSoon: 0 } };

describe("lease reminder email", () => {
  it("has nothing to send when there are no alerts", () => {
    expect(hasLeaseAlerts(none)).toBe(false);
    expect(hasLeaseAlerts(base)).toBe(true);
  });

  it("lists every alert with its amounts and escapes user-entered text", () => {
    const email = buildLeaseReminderEmail("شركة تيسم برو", base, "ar", "https://example.com/leases/leaseContracts");
    expect(email.subject).toBe("تنبيهات الإيجارات — شركة تيسم برو — 1 متأخرة، 1 مستحقة قريباً، 1 تجديد");
    expect(email.bodyHtml).toContain("محطة &lt;الفاضل&gt;");
    expect(email.bodyHtml).toContain("مؤجر &amp; شركاه");
    expect(email.bodyHtml).not.toContain("<الفاضل>");
    expect(email.bodyHtml).toContain("33,333.00");
    expect(email.bodyHtml).toContain("17 يوماً");
    expect(email.bodyHtml).toContain("اليوم");
    expect(email.bodyHtml).toContain("آخر موعد للإشعار بعد 62 يوماً · يتجدد تلقائياً");
    expect(email.bodyHtml).toContain('href="https://example.com/leases/leaseContracts"');
  });

  it("writes the English version and leaves out empty sections", () => {
    const email = buildLeaseReminderEmail("Tism Pro", { ...base, dueSoon: [], renewals: [], totals: { overdue: 33333, dueSoon: 0 } }, "en", "https://example.com");
    expect(email.subject).toBe("Lease alerts — Tism Pro — 1 overdue");
    expect(email.bodyHtml).toContain("Overdue payments (1) — 33,333.00");
    expect(email.bodyHtml).not.toContain("Due within");
    expect(email.bodyHtml).not.toContain("renewal decision");
  });
});
