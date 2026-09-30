import { test, expect } from "@playwright/test";

const owner = { id: "owner", name: "المالك", email: "owner@example.com", role: "admin", companyScope: "all" };
const tenant = { id: "tenant", name: "مؤسسة", ownerId: "owner" };
let calls;

test.beforeEach(async ({ page }) => {
  calls = [];
  await page.addInitScript(({ me, tenant }) => {
    localStorage.setItem("athar.accessToken", "test-access");
    localStorage.setItem("athar.refreshToken", "test-refresh");
    localStorage.setItem("athar.session", JSON.stringify({ user: me, tenant }));
  }, { me: owner, tenant });
  await page.route("http://localhost:4000/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") calls.push({ method, path, body: route.request().postDataJSON() });
    let data = {};
    if (path.endsWith("/auth/me")) data = { user: owner, tenant };
    else if (path.endsWith("/job-titles") && method === "GET") data = [{ id: "jt-acc", name: "محاسب", positionId: "pos-1" }, { id: "jt-tech", name: "فني", positionId: null }];
    await route.fulfill({ json: data });
  });
  await page.goto("/e2e/fixtures/job-titles.html");
  await expect(page.getByRole("cell", { name: "فني", exact: true })).toBeVisible();
});

test("job titles are saved to the server and show whether each has a position", async ({ page }) => {
  await page.getByLabel("مسمّى وظيفي جديد").fill("مشرف مبيعات");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ method: "POST", path: "/api/job-titles", body: { name: "مشرف مبيعات" } });
  await expect(page.getByRole("row", { name: /محاسب/ })).toContainText("لها منصب");
  await expect(page.getByRole("row", { name: /فني/ })).toContainText("بلا منصب بعد");
  await expect(page.getByRole("link", { name: "إدارة الصلاحيات" }).first()).toHaveAttribute("href", "/settings/positions");
});

test("rename in place; a job title with a position cannot be deleted", async ({ page }) => {
  await expect(page.getByRole("button", { name: "حذف محاسب" })).toBeDisabled();
  await page.getByRole("button", { name: "تعديل فني" }).click();
  await page.getByRole("textbox", { name: "الوظيفة" }).fill("فني صيانة");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ method: "PATCH", path: "/api/job-titles/jt-tech", body: { name: "فني صيانة" } });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف فني" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toMatchObject({ method: "DELETE", path: "/api/job-titles/jt-tech" });
});
