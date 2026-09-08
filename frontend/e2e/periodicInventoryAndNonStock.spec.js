import { test, expect } from "@playwright/test";

// أول تشغيلة تصل لهذه المسارات (تسجيل، /inventory/items، /inventory/periodicSettlement) تجبر Vite
// على تحويل (compile) حِزَم كاملة جديدة لحظياً — أبطأ بكثير من المهلة الافتراضية 30 ثانية على خادم
// تطوير بارد. راجع "Slow first paint" في توثيق تشغيل هذا المشروع.
test.setTimeout(120_000);

/**
 * تحقّق بصري في متصفح حقيقي لميزة "بضاعة بجرد دوري" (periodic_inventory، أُعيد تفعيلها الآن بعد
 * اكتمال شاشة التسوية) والنوع الجديد "غير مخزن" (non_stock): يتحقق أن كلا النوعين يظهران في قائمة
 * اختيار نوع الصنف بحقول الربط المحاسبي الصحيحة تحديداً (لا أكثر ولا أقل)، وأن التبويب الجديد
 * "تسوية الجرد الدوري" يعمل فعلياً على صنف periodic_inventory حقيقي حتى ظهور نتيجة التسوية.
 *
 * يسجّل تينانت تجريبياً جديداً في كل تشغيلة (بنفس أسلوب mobileMenu.spec.js)، فيحصل على شجرة حسابات
 * افتراضية حقيقية (نشاط "مقاولات" — أول خيار حقيقي في قائمة الأنشطة) بلا أي إعداد يدوي. كل محدِّدات
 * حقول النموذج مُقيَّدة صراحة داخل ".items-form-panel" — الصفحة تحتوي شريط بحث عام أعلى الصفحة من
 * نوع input[type="text"] أيضاً يسبق نموذج الصنف في DOM، فأي محدِّد غير مُقيَّد (مثل `input[type="text"]`
 * على مستوى الصفحة كلها) يلتقطه هو بدل حقول النموذج فعلياً.
 */

async function registerAndReachDashboard(page, label) {
  const email = `periodic-nonstock-${label}-${Date.now()}@example.com`;
  await page.goto("/register");
  const inputs = page.locator("input");
  await inputs.nth(0).fill("شركة اختبار الجرد الدوري");
  await page.locator("select").selectOption({ index: 1 });
  await inputs.nth(1).fill("مستخدم اختبار");
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill("Password123");
  await inputs.nth(4).fill("Password123");
  await page.getByRole("button", { name: /إنشاء الحساب/ }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

async function pickAccount(form, fieldLabelText, searchText) {
  const label = form.locator("label", { hasText: fieldLabelText });
  const input = label.locator("input").first();
  await input.click();
  await input.fill(searchText);
  await form.page().locator(".item-combo-option", { hasText: searchText }).first().click();
}

async function openAddItemForm(page) {
  await page.getByRole("button", { name: /إضافة صنف جديد/ }).click();
  const form = page.locator(".items-form-panel");
  await expect(form).toBeVisible();
  return form;
}

test("periodic_inventory and non_stock item types show correct conditional account fields", async ({ page }) => {
  await registerAndReachDashboard(page, "types");

  await page.goto("/inventory/items", { timeout: 90_000 });
  let form = await openAddItemForm(page);

  const typeSelect = form.locator("select").first();
  await expect(typeSelect.locator('option[value="periodic_inventory"]')).toHaveText("بضاعة بجرد دوري");
  await expect(typeSelect.locator('option[value="non_stock"]')).toHaveText("غير مخزن");

  // --- periodic_inventory: يجب أن تظهر بالضبط 3 حقول (المشتريات/المخزون/الإيراد)، بلا تكلفة بضاعة مباعة ---
  await typeSelect.selectOption("periodic_inventory");
  await page.screenshot({ path: "e2e/screenshots/periodic-inventory-form.png", fullPage: true });
  await expect(form.getByText("حساب المشتريات")).toBeVisible();
  await expect(form.getByText("حساب المخزون")).toBeVisible();
  await expect(form.getByText("حساب الإيراد")).toBeVisible();
  await expect(form.getByText("حساب تكلفة البضاعة المباعة")).not.toBeVisible();
  await expect(form.getByText("حساب المصروف")).not.toBeVisible();

  await form.locator('input[type="text"]').nth(0).fill("PI-E2E-1");
  await form.locator('input[type="text"]').nth(1).fill("بضاعة جرد دوري تجريبية");
  await pickAccount(form, "حساب المشتريات", "المشتريات");
  await pickAccount(form, "حساب المخزون", "114001");
  await pickAccount(form, "حساب الإيراد", "411001");
  await form.getByRole("button", { name: /حفظ الصنف/ }).click();
  await expect(page.getByText("PI-E2E-1")).toBeVisible({ timeout: 10_000 });

  // --- non_stock: يجب أن تظهر بالضبط حقلا المصروف والإيراد، بلا مخزون ولا تكلفة بضاعة مباعة ---
  form = await openAddItemForm(page);
  const typeSelect2 = form.locator("select").first();
  await typeSelect2.selectOption("non_stock");
  await page.screenshot({ path: "e2e/screenshots/non-stock-form.png", fullPage: true });
  await expect(form.getByText("حساب المصروف")).toBeVisible();
  await expect(form.getByText("حساب الإيراد")).toBeVisible();
  await expect(form.getByText("حساب المخزون")).not.toBeVisible();
  await expect(form.getByText("حساب تكلفة البضاعة المباعة")).not.toBeVisible();
  await expect(form.getByText("حساب المشتريات")).not.toBeVisible();

  await form.locator('input[type="text"]').nth(0).fill("NS-E2E-1");
  await form.locator('input[type="text"]').nth(1).fill("صنف غير مخزن تجريبي");
  await pickAccount(form, "حساب المصروف", "622001");
  await pickAccount(form, "حساب الإيراد", "411001");
  await form.getByRole("button", { name: /حفظ الصنف/ }).click();
  await expect(page.getByText("NS-E2E-1")).toBeVisible({ timeout: 10_000 });

  // كلا الصنفين يظهران في الجدول بشارة النوع الصحيحة (مُقيَّد لعنصر الشارة نفسه — لا نص الصنف الحر
  // الذي قد يحتوي نفس الكلمات صدفة، كما حدث فعلاً مع وصف "صنف غير مخزن تجريبي")
  await expect(page.locator("tr", { hasText: "PI-E2E-1" }).locator(".item-type-badge")).toHaveText(/بضاعة بجرد دوري/);
  await expect(page.locator("tr", { hasText: "NS-E2E-1" }).locator(".item-type-badge")).toHaveText(/غير مخزن/);
  await page.screenshot({ path: "e2e/screenshots/items-list-both-types.png", fullPage: true });
});

test("periodic inventory settlement screen lists a periodic_inventory item and saves a settlement", async ({ page }) => {
  await registerAndReachDashboard(page, "settlement");

  await page.goto("/inventory/items", { timeout: 90_000 });
  const form = await openAddItemForm(page);
  await form.locator("select").first().selectOption("periodic_inventory");
  await form.locator('input[type="text"]').nth(0).fill("PI-SETTLE-1");
  await form.locator('input[type="text"]').nth(1).fill("صنف جرد دوري للتسوية");
  await pickAccount(form, "حساب المشتريات", "المشتريات");
  await pickAccount(form, "حساب المخزون", "114001");
  await pickAccount(form, "حساب الإيراد", "411001");
  await form.getByRole("button", { name: /حفظ الصنف/ }).click();
  await expect(page.getByText("PI-SETTLE-1")).toBeVisible({ timeout: 10_000 });

  await page.goto("/inventory/periodicSettlement", { timeout: 90_000 });
  await expect(page.getByText("PI-SETTLE-1")).toBeVisible({ timeout: 10_000 });

  const row = page.locator("tr", { hasText: "PI-SETTLE-1" });
  await row.locator('input[type="number"]').nth(0).fill("50");
  await row.locator('input[type="number"]').nth(1).fill("10");
  await page.screenshot({ path: "e2e/screenshots/periodic-settlement-before-save.png", fullPage: true });

  await page.getByRole("button", { name: /حفظ التسوية/ }).click();
  await expect(page.getByText("نتيجة التسوية")).toBeVisible({ timeout: 10_000 });
  // جدول النتيجة يعرض اسم الصنف لا كوده — والصفّ (صافي=500، فرق الكمية=50، القيمة الجديدة=500 بهذا
  // الإدخال تحديداً: 50 وحدة × 10 تكلفة، ورصيد سابق صفر) منفصل تماماً عن صفّ جدول الإدخال أعلاه.
  const resultsRow = page.locator(".panel", { has: page.getByText("نتيجة التسوية") }).locator("tr", { hasText: "صنف جرد دوري للتسوية" });
  await expect(resultsRow.getByText("500.00")).toHaveCount(2);
  await expect(resultsRow.getByText("50.00")).toHaveCount(1);
  await page.screenshot({ path: "e2e/screenshots/periodic-settlement-result.png", fullPage: true });
});
