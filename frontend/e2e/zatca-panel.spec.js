import { test, expect } from "@playwright/test";

// قسم زاتكا (DocumentZatcaSection: الحالة + سجل الإصدارات والمحاولات + زر إعادة الإصدار) يُركَّب في كل قالب عرض — modern
// (PrintShell) وclassicPro (ClassicProInvoiceView) — وفي عرض إشعار الدائن، خارج منطقة الطباعة، ولا يظهر عند الطباعة.
// INV-00202 (قالب classicPro) لم يكن يظهر له القسم إطلاقاً، وكان تحت الفاتورة صندوق مؤطَّر فارغ (InvoiceCreditNotes).
// المُموَّه هو ردّ الخادم وحده (CLAUDE.md القاعدة 2: طلب HTTP من الخارج)؛ المكوّنات حقيقية في متصفح حقيقي.
const HISTORY = {
  issues: [{ id: "is-1", documentUuid: "uuid-202", icv: 202, issuedAt: "2026-10-05T09:12:30.000Z", supplyDate: null, source: "backfill" }],
  attempts: [{ id: "at-1", documentUuid: "uuid-202", icv: 202, outcome: "rejected", httpStatus: 400, reason: "[BR-CO-15] BT-112 = BT-109 + BT-110", hasSignedXml: true, attemptedAt: "2026-10-11T07:48:00.000Z", source: "resubmission" }],
  reissue: { eligible: true },
};

async function mockApi(page, { historyStatus = 200 } = {}) {
  const calls = [];
  await page.route("http://localhost:4000/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    if (path.endsWith("/zatca-history")) {
      if (historyStatus !== 200) return route.fulfill({ status: historyStatus, json: { error: "لا تملك صلاحية عرض هذا المستند" } });
      return route.fulfill({ json: HISTORY });
    }
    if (path.endsWith("/reissue-zatca")) return route.fulfill({ json: { id: "inv-202", zatcaStatus: "cleared", status: "posted" } });
    return route.fulfill({ json: [] });
  });
  return calls;
}

for (const template of ["modern", "classicPro"]) {
  test(`invoice, ${template} template: ZATCA section with history and re-issue, outside the printable area, hidden when printing`, async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto(`/e2e/fixtures/zatca-panel.html?template=${template}`);
    const section = page.getByTestId("zatca-section");
    await expect(section).toBeVisible();
    await expect(section).toContainText("سجل زاتكا");
    await expect(section).toContainText("BR-CO-15");
    await expect(section.getByRole("button", { name: "إعادة إصدار المستند المصحَّح" })).toBeVisible();
    // القالب المعروض فعلاً
    await expect(page.locator(template === "classicPro" ? ".cpi-print" : ".voucher-print")).toBeVisible();
    // خارج منطقة الطباعة بنيوياً
    await expect(page.locator(".voucher-print [data-testid=zatca-section], .cpi-print [data-testid=zatca-section]")).toHaveCount(0);
    // لا صندوق مؤطَّر فارغ: كل قسم no-print ظاهر يحمل نصاً
    for (const box of await page.locator("section.no-print").all()) {
      if (await box.isVisible()) expect((await box.innerText()).trim().length).toBeGreaterThan(0);
    }
    // الطباعة: الفاتورة تُطبَع، وقسم زاتكا لا
    await page.emulateMedia({ media: "print" });
    await expect(section).toBeHidden();
    await expect(page.locator(template === "classicPro" ? ".cpi-print" : ".voucher-print")).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(section).toBeVisible();
    // إعادة الإصدار من القسم نفسه
    await section.getByRole("button", { name: "إعادة إصدار المستند المصحَّح" }).click();
    await section.getByRole("button", { name: "إعادة الإصدار والإرسال" }).click();
    await expect.poll(() => calls.filter((c) => c === "POST /api/sales-invoices/inv-202/reissue-zatca").length).toBe(1);
  });
}

test("credit note view: the same ZATCA section, outside the printable area, hidden when printing", async ({ page }) => {
  await mockApi(page);
  await page.goto("/e2e/fixtures/zatca-panel.html?doc=return");
  const section = page.getByTestId("zatca-section");
  await expect(section).toBeVisible();
  await expect(section).toContainText("سجل زاتكا");
  await expect(section.getByRole("button", { name: "إعادة إصدار المستند المصحَّح" })).toBeVisible();
  await expect(page.locator(".voucher-print [data-testid=zatca-section]")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(section).toBeHidden();
  await expect(page.locator(".voucher-print")).toBeVisible();
});

test("a history error is shown with its HTTP status in the classicPro template, never an empty box", async ({ page }) => {
  await mockApi(page, { historyStatus: 403 });
  await page.goto("/e2e/fixtures/zatca-panel.html?template=classicPro");
  const section = page.getByTestId("zatca-section");
  await expect(section).toContainText("تعذّر تحميل سجل زاتكا (HTTP 403)");
  await expect(section).toContainText("لا تملك صلاحية عرض هذا المستند");
});
