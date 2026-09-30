import { test, expect } from "@playwright/test";
// قوائم الوحدات والموارد تُؤخذ من كود الخادم نفسه لا من نسخة يدوية (قاعدة 2 في CLAUDE.md).
import { PLATFORM_ACTIONS } from "../../src/lib/platformActions.ts";
import { POSITION_RESOURCES } from "../../src/lib/positionMatrix.ts";

const position = { id: "pos-test", name: "محاسب", allowUnpost: false, allowPosDeferredSale: true, allowPosPriceOverride: true,
  matrixEnabled: false, matrix: {}, actionLevels: { leaveRequests: { approve: "approve" } },
  members: [{ id: "user-a", name: "سعيد", email: "saeed@example.com" }] };
let calls;
test.beforeEach(async ({ page }) => {
  calls = [];
  await page.route("http://localhost:4000/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") calls.push({ method, path, body: route.request().postDataJSON() });
    let data = [];
    if (path.endsWith("/positions")) data = [position];
    else if (path.endsWith("/positions/assignable-users")) data = [{ id: "user-a", name: "سعيد", email: "saeed@example.com", positionId: "pos-test" }];
    else if (path.endsWith("/positions/actions")) data = PLATFORM_ACTIONS;
    else if (path.endsWith("/positions/matrix-resources")) data = POSITION_RESOURCES;
    else if (path.endsWith("/positions/user-overrides")) data = [];
    else if (path.endsWith("/job-titles")) data = [{ id: "jt-acc", name: "محاسب", positionId: "pos-test" }, { id: "jt-sup", name: "مشرف محطة", positionId: null }];
    else data = {};
    await route.fulfill({ json: data });
  });
  await page.goto("/e2e/fixtures/positions.html");
});

test("positions start collapsed with a summary, and module ids never reach the screen", async ({ page }) => {
  const head = page.getByRole("button", { name: /محاسب/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(head).toContainText("الأعضاء: 1");
  await expect(head).toContainText("صلاحيات سابقة");
  await expect(page.getByText("مصفوفة صلاحيات المنصب")).toHaveCount(0);
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  for (const section of ["الأعضاء", "مصفوفة صلاحيات المنصب", "القيود ونقطة البيع", "طلبات الإجازة وورديات المحطات"])
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "طلبات الإجازة" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "ورديات المحطات" })).toBeVisible();
  for (const moduleId of Object.keys(PLATFORM_ACTIONS)) await expect(page.getByText(moduleId, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("طلبات الإجازة — الموافقة/الرفض")).toHaveValue("approve");
});

test("every module's levels are editable without picking a module first", async ({ page }) => {
  await page.getByRole("button", { name: /محاسب/ }).click();
  await page.getByLabel("ورديات المحطات — ترحيل ورديات المحطات المُعتمَدة").selectOption("approve");
  await page.getByRole("checkbox", { name: "السماح بفك ترحيل القيود" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[0]).toEqual({ method: "PATCH", path: "/api/positions/pos-test/action-permissions",
    body: { moduleId: "stationShifts", actionId: "post", level: "approve" } });
  expect(calls[1]).toEqual({ method: "PATCH", path: "/api/positions/pos-test", body: { allowUnpost: true } });
});

test("a new position is built from a job title: an existing one without a position, or a new one", async ({ page }) => {
  const choice = page.getByLabel("منصب جديد — اختر الوظيفة");
  // الوظيفة التي لها منصب لا تُعرَض، والتي بلا منصب تُعرَض
  await expect(choice.locator("option", { hasText: "مشرف محطة" })).toHaveCount(1);
  await expect(choice.locator("option", { hasText: /^محاسب$/ })).toHaveCount(0);
  await choice.selectOption({ label: "مشرف محطة" });
  await page.getByRole("button", { name: "إضافة", exact: true }).first().click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ method: "POST", path: "/api/positions", body: { jobTitleId: "jt-sup" } });

  await choice.selectOption({ label: "+ وظيفة جديدة…" });
  await page.getByLabel("اسم الوظيفة الجديدة").fill("فني صيانة");
  await page.getByRole("button", { name: "إضافة", exact: true }).first().click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual({ method: "POST", path: "/api/positions", body: { jobTitleName: "فني صيانة" } });
});
