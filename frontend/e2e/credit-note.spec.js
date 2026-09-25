import { test, expect } from "@playwright/test";
const invoice = { id: "inv-test", companyId: "company-test", customerId: "customer-test", invoiceNumber: "INV-TEST", date: "2026-09-22", status: "posted", grandTotal: 105, creditNotes: [], lines: [{ id: "line-test", accountId: "account-test", description: "كرات منظف", quantity: 30, unitPrice: 3.5, discountPct: 0, priceIncludesVat: true, vatApplicable: true }] };
let submitted;
test.beforeEach(async ({ page }) => {
 submitted = null;
 await page.route("http://localhost:4000/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let data = [];
  if (path.endsWith("/customers")) data = [{id:"customer-test",name:"عميل الاختبار"}];
  else if (path.endsWith("/accounts")) data = [{id:"account-test",name:"إيراد المبيعات",code:"411001",type:"revenue"}];
  else if (path.endsWith("/items")) data = [{id:"item-test",name:"كرات منظف",type:"goods",salePrice:3.5,revenueAccountId:"account-test",vatApplicable:true}];
  else if (path.endsWith("/sales-invoices")) data = [invoice];
  else if (path.endsWith("/sales-invoices/inv-test")) data = invoice;
  else if (path.endsWith("/sales-returns") && route.request().method() === "POST") { submitted = route.request().postDataJSON(); data = {id:"return-test",returnNumber:"RET-TEST",status:"posted"}; }
  await route.fulfill({json:data});
 });
 await page.goto("/e2e/fixtures/credit-note.html");
});
test("invoice action preloads original lines and saves an editable partial return", async ({page}) => {
 await page.getByRole("button",{name:"إرجاع الفاتورة"}).click();
 const rows = page.locator(".lines-table tbody tr");
 await expect(rows).toHaveCount(1);
 await expect(rows.locator("input").first()).toHaveValue("كرات منظف");
 await expect(rows.locator('input[type="number"]').nth(1)).toHaveValue("3.5");
 await rows.locator('input[type="number"]').first().fill("5");
 await page.getByLabel("سبب المردود").fill("إرجاع جزء من الكمية");
 await page.getByRole("button",{name:/حفظ.*ترحيل/}).click();
 await expect(page.getByRole("status")).toContainText("RET-TEST");
 expect(submitted.relatedInvoiceId).toBe("inv-test"); expect(submitted.customerId).toBe("customer-test");
 expect(submitted.lines[0].originalInvoiceLineId).toBe("line-test"); expect(submitted.lines[0].quantity).toBe(5);
 expect(submitted.lines[0].unitPrice).toBe(3.5); expect(submitted.refundMethod).toBe("account");
});
test("manual invoice selection loads details and item search can restore a removed line", async ({page}) => {
 await page.getByRole("link",{name:"Open returns"}).click();
 await page.getByLabel("الفاتورة الأصلية (اختياري)").selectOption("inv-test");
 await expect(page.locator(".lines-table tbody tr input").first()).toHaveValue("كرات منظف");
 await page.locator(".btn-remove-line").click();
 await page.getByPlaceholder("البحث عن صنف لإضافته إلى المرتجع").fill("كرات");
 await page.getByRole("button",{name:/كرات منظف —/}).click();
 await expect(page.locator(".lines-table tbody tr")).toHaveCount(1);
});
