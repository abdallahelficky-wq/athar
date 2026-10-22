import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * getItemDisplayName وقاموس الوحدات (frontend/src/wired/shared/itemDisplayName.js) — نفس قاعدة getAccountDisplayName: واجهة إنجليزية
 * وnameEn غير فارغ → nameEn، وإلا الاسم العربي؛ لا ترجمة آلية لما أدخله المستخدم. الوحدات: قاموس صغير للعرض في الإنجليزية فقط، وما
 * ليس فيه كما كُتب.
 */
const mod = () => import(path.resolve("frontend/src/wired/shared/itemDisplayName.js") as string);
const accountMod = () => import(path.resolve("frontend/src/wired/shared/accountDisplayName.js") as string);

describe("getItemDisplayName", () => {
  it("English UI + non-empty nameEn → nameEn; otherwise the Arabic name, in every fallback case", async () => {
    const { getItemDisplayName } = await mod();
    expect(getItemDisplayName({ name: "منظف", nameEn: "Cleaner" }, "en")).toBe("Cleaner");
    expect(getItemDisplayName({ name: "منظف", nameEn: "  Cleaner  " }, "en")).toBe("Cleaner");
    expect(getItemDisplayName({ name: "منظف", nameEn: "Cleaner" }, "ar")).toBe("منظف");
    for (const nameEn of [null, undefined, "", "   "]) expect(getItemDisplayName({ name: "منظف", nameEn }, "en"), String(nameEn)).toBe("منظف");
    expect(getItemDisplayName({ name: "منظف", nameEn: "Cleaner" }, undefined)).toBe("منظف"); // لغة غير معروفة = العربية
    expect(getItemDisplayName(null, "en")).toBe("");
    // صف تقرير { itemName, itemNameEn }
    expect(getItemDisplayName({ itemName: "منظف", itemNameEn: "Cleaner" }, "en")).toBe("Cleaner");
    expect(getItemDisplayName({ itemName: "منظف", itemNameEn: null }, "en")).toBe("منظف");
  });

  it("is the same rule as getAccountDisplayName for any non-blank nameEn", async () => {
    const { getItemDisplayName } = await mod();
    const { getAccountDisplayName } = await accountMod();
    for (const lang of ["en", "ar"]) {
      for (const record of [{ name: "النقدية", nameEn: "Cash" }, { name: "النقدية", nameEn: null }, { name: "النقدية", nameEn: "" }]) {
        expect(getItemDisplayName(record, lang)).toBe(getAccountDisplayName(record, lang));
      }
    }
  });

  it("secondary line: Arabic name in the English UI, nameEn in the Arabic UI, none when nameEn is blank", async () => {
    const { getItemSecondaryName, itemSecondaryDir, itemOptionLabel } = await mod();
    expect(getItemSecondaryName({ name: "منظف", nameEn: "Cleaner" }, "en")).toBe("منظف");
    expect(getItemSecondaryName({ name: "منظف", nameEn: "Cleaner" }, "ar")).toBe("Cleaner");
    expect(getItemSecondaryName({ name: "منظف", nameEn: " " }, "en")).toBeNull();
    expect(getItemSecondaryName({ name: "منظف", nameEn: null }, "ar")).toBeNull();
    expect([itemSecondaryDir("en"), itemSecondaryDir("ar")]).toEqual(["rtl", "ltr"]);
    expect(itemOptionLabel({ name: "منظف", nameEn: "Cleaner", code: "A1" }, "en")).toBe("Cleaner (A1)");
    expect(itemOptionLabel({ name: "منظف", nameEn: "Cleaner" }, "ar")).toBe("منظف");
  });
});

describe("unit display dictionary", () => {
  it("translates the common Arabic units in the English UI only", async () => {
    const { getUnitDisplayLabel } = await mod();
    const expected: Record<string, string> = {
      "كجم": "kg", "جرام": "g", "طن": "ton", "لتر": "L", "قطعة": "pcs", "حبة": "pcs", "كرتون": "carton",
      "متر": "m", "ماسورة": "pipe", "أمر": "order", "ساعة": "hour", "يوم": "day",
    };
    for (const [ar, en] of Object.entries(expected)) {
      expect(getUnitDisplayLabel(ar, "en"), ar).toBe(en);
      expect(getUnitDisplayLabel(ar, "ar"), ar).toBe(ar);
    }
    expect(getUnitDisplayLabel(" كجم ", "en")).toBe("kg");
  });

  it("shows unknown or empty units as typed, never altered", async () => {
    const { getUnitDisplayLabel } = await mod();
    expect(getUnitDisplayLabel("علبة مخصصة", "en")).toBe("علبة مخصصة");
    expect(getUnitDisplayLabel("Box", "en")).toBe("Box");
    expect(getUnitDisplayLabel("", "en")).toBe("");
    expect(getUnitDisplayLabel(null, "en")).toBe("");
    expect(getUnitDisplayLabel(undefined, "ar")).toBe("");
  });
});

describe("screens render item names only through the helper", () => {
  // كل شاشة تعرض اسم صنف تمرّ بـ getItemDisplayName / ItemName — عودة أي منها إلى عرض الحقل الخام مباشرةً تُفشل هذا الاختبار.
  // (الوصف المخزَّن على أسطر المستندات، itemDescription، ليس عرضاً ولا يُفحص هنا.)
  const SCREENS: Record<string, RegExp[]> = {
    // (?<!\$): ${item.name} في قالب نصّي ينسخ حقل الاسم العربي عند تكرار الصنف — بيانات لا عرض
    "wired/inventory/ItemsTab.jsx": [/(?<!\$)\{item\.name\}/, /\{viewItem\.name\}/, /\{it\.name\} \(/],
    "wired/inventory/ItemCardModal.jsx": [/\{card\.item\.name\}/],
    "wired/inventory/IssueTab.jsx": [/\{i\.name\}/],
    "wired/inventory/StockInOutTab.jsx": [/\{i\.name\}/],
    "wired/inventory/TransferTab.jsx": [/\{i\.name\}/],
    "wired/inventory/StockReportTab.jsx": [/\{r\.itemName\}/],
    "wired/inventory/PeriodicSettlementTab.jsx": [/\{c\.name\}/, /\{r\.itemName\}/],
    "wired/inventory/StockMovementsTable.jsx": [/\{m\.item\?\.name\}/],
    "wired/sales/SalesInvoiceLinesEditor.jsx": [/\{itemDescription\(it\)\}/],
    "wired/purchases/PurchaseInvoiceLinesEditor.jsx": [/\{itemDescription\(it\)\}/],
    "wired/sales/ReturnLinesEditor.jsx": [/\{item\.description\} —/],
    "pos/screens/SaleScreen.jsx": [/pos-item-tile-name">\{item\.name\}/],
    "pos/screens/QuickSaleScreen.jsx": [/pos-item-tile-name">\{item\.name\}/, /pos-cart-line-name">\{item\.name\}/],
  };
  it.each(Object.entries(SCREENS))("%s", async (file, forbidden) => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(path.resolve("frontend/src", file), "utf8");
    expect(source).toMatch(/getItemDisplayName|ItemName|itemOptionLabel/);
    for (const pattern of forbidden) expect(source, `${file}: ${pattern}`).not.toMatch(pattern);
  });
});
