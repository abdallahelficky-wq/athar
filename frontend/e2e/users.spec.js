import { test, expect } from "@playwright/test";

const owner = { id: "owner", name: "المالك", email: "owner@example.com", role: "admin", companyScope: "all", inviteStatus: "accepted", active: true, positionId: null, positionName: null };
const clerk = { id: "clerk", name: "عبدالله جبريل", email: "clerk@example.com", role: "accountant", companyScope: "all", inviteStatus: "accepted", active: true, positionId: null, positionName: null };
const tenant = { id: "tenant", name: "مؤسسة", ownerId: "owner" };
let calls;

async function open(page, me) {
  calls = [];
  await page.addInitScript(({ me, tenant }) => {
    localStorage.setItem("athar.accessToken", "test-access");
    localStorage.setItem("athar.refreshToken", "test-refresh");
    localStorage.setItem("athar.session", JSON.stringify({ user: me, tenant }));
  }, { me, tenant });
  await page.route("http://localhost:4000/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") calls.push({ method, path, body: route.request().postDataJSON() });
    let data = {};
    if (path.endsWith("/auth/me")) data = { user: me, tenant };
    else if (path.endsWith("/auth/users")) data = [owner, clerk];
    else if (path.endsWith("/positions")) data = [{ id: "pos-1", name: "محاسب أول" }];
    else if (path.endsWith("/auth/invite")) data = { ...clerk, id: "new", emailSent: true };
    else if (method === "DELETE") data = { archived: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/e2e/fixtures/users.html");
  await expect(page.getByRole("cell", { name: "عبدالله جبريل", exact: true })).toBeVisible();
}

test("the owner adds a user from a popup and picks the position there", async ({ page }) => {
  await open(page, owner);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "إضافة مستخدم" }).click();
  const dialog = page.getByRole("dialog", { name: "إضافة مستخدم جديد" });
  await dialog.getByLabel("الاسم").fill("موظف جديد");
  await dialog.getByLabel("البريد الإلكتروني").fill("new@example.com");
  await dialog.getByLabel("المنصب").selectOption({ label: "محاسب أول" });
  await dialog.getByRole("button", { name: "إرسال دعوة لمستخدم جديد" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([{ method: "POST", path: "/api/auth/invite",
    body: { name: "موظف جديد", email: "new@example.com", role: "accountant", companyScope: "all", positionId: "pos-1" } }]);
});

test("edit opens the same popup with the email locked, and sends only what may change", async ({ page }) => {
  await open(page, owner);
  await page.getByRole("button", { name: "تعديل عبدالله جبريل" }).click();
  const dialog = page.getByRole("dialog", { name: "تعديل المستخدم" });
  await expect(dialog.getByLabel("البريد الإلكتروني")).toBeDisabled();
  await expect(dialog.getByLabel("البريد الإلكتروني")).toHaveValue("clerk@example.com");
  await dialog.getByLabel("الصلاحية").selectOption("viewer");
  await dialog.getByLabel("المنصب").selectOption({ label: "محاسب أول" });
  await dialog.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([{ method: "PATCH", path: "/api/auth/users/clerk",
    body: { name: "عبدالله جبريل", role: "viewer", companyScope: "all", positionId: "pos-1" } }]);
});

test("delete asks first, explains the record is kept, and is not offered on your own row", async ({ page }) => {
  await open(page, owner);
  await expect(page.getByRole("button", { name: "حذف المالك" })).toBeDisabled();
  let message = "";
  page.once("dialog", (d) => { message = d.message(); d.accept(); });
  await page.getByRole("button", { name: "حذف عبدالله جبريل" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(message).toContain("يبقى اسمه على كل ما أدخله");
  expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/auth/users/clerk" });
});

test("a non-owner cannot pick a position and never sends one", async ({ page }) => {
  await open(page, { ...clerk, id: "fm", role: "finance_manager" });
  await page.getByRole("button", { name: "إضافة مستخدم" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("المنصب")).toBeDisabled();
  await expect(dialog.getByText("إسناد المنصب لمالك الشركة فقط.")).toBeVisible();
  await dialog.getByLabel("الاسم").fill("موظف");
  await dialog.getByLabel("البريد الإلكتروني").fill("x@example.com");
  await dialog.getByRole("button", { name: "إرسال دعوة لمستخدم جديد" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).not.toHaveProperty("positionId");
});
