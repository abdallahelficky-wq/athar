import { test, expect } from "@playwright/test";

/**
 * Regression tests for the mobile hamburger menu (App.jsx AppShell) failing to open, or opening
 * once then going unresponsive. Root cause: index.html sets viewport-fit=cover and the manifest
 * uses display:"standalone", both needed for the installed PWA, but nothing compensated for
 * env(safe-area-inset-top) — so on a notched/Dynamic-Island iPhone the top of the page (and with
 * it .hamburger-btn) rendered partly or fully under the status bar/notch, leaving the button only
 * intermittently reachable depending on exactly where the exposed sliver landed.
 *
 * Fixed in styles/global.css via a single --safe-top custom property (:root), consumed by:
 *   - .topbar's own padding-top (its background/blur still extends under the notch — the reserved
 *     space is internal padding, not a gap of a different background above it), and
 *   - the mobile .sidebar's padding-top (a separate, position:fixed element outside .app-root's
 *     box — its own top content needs the same reservation independently, not a second helping of
 *     the same padding on one element).
 * .hamburger-btn/.sidebar-close-btn are also now 44x44 (was 38/32).
 *
 * Note: headless Chromium always reports env(safe-area-inset-top) as 0 (there is no real notch to
 * emulate), so the open/close cycle test below can't reproduce the original failure by itself —
 * it guards the "state never resets" / "stale backdrop" hypotheses and the 44x44 tap target. The
 * second test instead overrides --safe-top directly to stand in for a real notch/Dynamic Island,
 * which is what actually exercises the fixed CSS path. Confirming the real device behavior still
 * needs a physical notched iPhone.
 *
 * Both tests register a fresh throwaway tenant per run (unique email) against whichever backend
 * the configured baseURL points at — clean up the resulting test tenants from that database
 * afterward if needed, the same way any other manual QA account here would be.
 */

test.use({ viewport: { width: 390, height: 844 } });

async function registerAndReachDashboard(page, label) {
  const email = `mobilemenu-${label}-${Date.now()}@example.com`;
  await page.goto("/register");
  const inputs = page.locator("input");
  await inputs.nth(0).fill("شركة اختبار قائمة الجوال");
  await page.locator("select").selectOption({ index: 1 });
  await inputs.nth(1).fill("مستخدم اختبار القائمة");
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill("Password123");
  await inputs.nth(4).fill("Password123");
  await page.getByRole("button", { name: /إنشاء الحساب/ }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test("mobile hamburger menu opens and closes reliably across repeated cycles", async ({ page }) => {
  await registerAndReachDashboard(page, "cycles");

  const hamburger = page.locator(".hamburger-btn");
  const sidebar = page.locator(".sidebar");
  const backdrop = page.locator(".sidebar-backdrop");
  const closeBtn = page.locator(".sidebar-close-btn");

  await expect(hamburger).toBeVisible();
  const box = await hamburger.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  for (let cycle = 1; cycle <= 3; cycle++) {
    await hamburger.click();
    await expect(sidebar, `cycle ${cycle}: sidebar should open`).toHaveClass(/sidebar-open/);
    await expect(backdrop, `cycle ${cycle}: backdrop should be present while open`).toBeVisible();

    await closeBtn.click();
    await expect(sidebar, `cycle ${cycle}: sidebar should close`).not.toHaveClass(/sidebar-open/);
    // Conditionally rendered in App.jsx, not just CSS-hidden — must fully leave the DOM so a
    // stale backdrop can never intercept clicks meant for the page underneath it.
    await expect(backdrop, `cycle ${cycle}: backdrop should be removed, not just hidden`).toHaveCount(0);
  }

  // Backdrop click closes it too (default app direction is RTL, so the drawer sits on the
  // physical right — a point near the left edge is guaranteed to land on the backdrop, not it).
  await hamburger.click();
  await expect(sidebar).toHaveClass(/sidebar-open/);
  await backdrop.click({ position: { x: 10, y: 10 } });
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
  await expect(backdrop).toHaveCount(0);
});

test("hamburger button clears a simulated 47px notch and stays clickable", async ({ page }) => {
  await registerAndReachDashboard(page, "safearea");

  // Stand-in for a real notch/Dynamic Island: overrides the same --safe-top token .topbar's
  // padding-top is built on (env(safe-area-inset-top) itself can't be forced to a nonzero value
  // in headless Chromium), so this exercises the actual fixed CSS path end to end.
  await page.addStyleTag({ content: ":root { --safe-top: 47px !important; }" });

  const hamburger = page.locator(".hamburger-btn");
  await expect(hamburger).toBeVisible();
  const box = await hamburger.boundingBox();
  const centerY = box.y + box.height / 2;
  expect(centerY).toBeGreaterThan(47);

  // Geometry alone isn't proof it's reachable — click it at that position and confirm the menu
  // actually opens, the way a real tap under a 47px notch would need to.
  await hamburger.click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar-open/);
});
