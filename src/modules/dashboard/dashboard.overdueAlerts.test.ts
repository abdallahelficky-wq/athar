import { describe, expect, it, vi } from "vitest";

// تنبيه «الفواتير المتأخرة» في الداشبورد مجمَّع بالعميل: بطاقة واحدة لكل عميل بعدد فواتيره المتأخرة وأقدمها
// وإجمالي المتبقي. المُدخل هنا ما يأتي من قاعدة البيانات (فواتير مرحَّلة وتخصيصات سداد) — والمُخرَج من
// getFinancialAlerts الحقيقية نفسها، لا من نسخة مكتوبة يدوياً.
const TENANT_ID = "tenant-1";
const COMPANY = {
  id: "company-1", tenantId: TENANT_ID, name: "مؤسسة المزارع الحديثة", currency: "SAR",
  overdueInvoiceDays: 30, vatFilingFrequency: "quarterly", lowCashThreshold: null, staleDraftDays: 7, zakatDeclarationDueDate: null,
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const inv = (id: string, customerId: string, name: string, age: number, total: number, paid = 0) => ({
  id, invoiceNumber: id, tenantId: TENANT_ID, companyId: COMPANY.id, customerId, status: "posted",
  date: daysAgo(age), grandTotal: total, customer: { id: customerId, name },
  receiptAllocations: paid ? [{ amount: paid }] : [],
});
const INVOICES = [
  inv("INV-1", "cust-a", "عميل أ", 65, 161),
  inv("INV-2", "cust-a", "عميل أ", 61, 105),
  inv("INV-3", "cust-a", "عميل أ", 40, 200, 50), // متأخرة جزئياً مدفوعة: المتبقي 150
  inv("INV-4", "cust-a", "عميل أ", 10, 999),     // غير متأخرة (أقل من 30 يوماً) — لا تدخل
  inv("INV-5", "cust-b", "عميل ب", 90, 80.5),
  inv("INV-6", "cust-b", "عميل ب", 70, 300, 300), // مسدَّدة بالكامل — لا تدخل
  inv("INV-7", "cust-c", "عميل ج", 5, 500),       // عميل بلا فواتير متأخرة — لا تنبيه له
];

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findMany: vi.fn(() => Promise.resolve([COMPANY])) },
    salesInvoice: { findMany: vi.fn((args: any) => Promise.resolve(args.where.status === "posted" ? INVOICES : [])) },
    leaseContract: { findMany: vi.fn(() => Promise.resolve([])) },
    companyDocument: { findMany: vi.fn(() => Promise.resolve([])) },
  },
}));

import { getFinancialAlerts } from "./dashboard.service";

describe("getFinancialAlerts — overdue invoices grouped by customer", () => {
  it("returns one alert per customer with count, oldest age and total remaining", async () => {
    const alerts = (await getFinancialAlerts(TENANT_ID, COMPANY.id, 60, "ar")).filter((a) => a.type === "overdue_invoice");
    expect(alerts.map((a) => a.customerId)).toEqual(["cust-b", "cust-a"]); // الأقدم تأخراً أولاً (فرز التنبيهات العام)
    const a = alerts.find((x) => x.customerId === "cust-a")!;
    expect(a.count).toBe(3);
    expect(a.amount).toBe(416); // 161 + 105 + 150
    expect(a.days).toBe(-65);
    expect(a.title).toBe("عميل متأخر السداد — عميل أ");
    expect(a.detail).toContain("3 فاتورة متأخرة، أقدمها 65 يوماً");
    const b = alerts.find((x) => x.customerId === "cust-b")!;
    expect(b.count).toBe(1);
    expect(b.amount).toBe(80.5);
    expect(b.days).toBe(-90);
  });

  it("speaks English when asked", async () => {
    const a = (await getFinancialAlerts(TENANT_ID, COMPANY.id, 60, "en")).find((x) => x.customerId === "cust-a")!;
    expect(a.title).toBe("Overdue customer — عميل أ");
    expect(a.detail).toBe("3 overdue invoices, oldest 65 days, 416.00 SAR remaining");
  });
});
