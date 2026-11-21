import { describe, expect, it } from "vitest";
import { SUPPORT_MENU, SUPPORT_SYSTEM_PROMPT } from "./supportKnowledge";
// @ts-expect-error — سكربت ESM بلا أنواع؛ يُستورَد كما هو ليعيد التوليد من كود الواجهة الفعلي.
import { buildSupportMenu } from "../../../scripts/build-support-menu.mjs";

describe("support knowledge (أثر الذكي — الدعم الفني)", () => {
  it("menu map matches the live frontend navigation — regenerate with scripts/build-support-menu.mjs if this fails", () => {
    expect(SUPPORT_MENU).toEqual(buildSupportMenu());
  });
  it("covers every main section and tab with its Arabic label", () => {
    const menu = buildSupportMenu();
    expect(menu.groups.length).toBeGreaterThan(8);
    for (const g of menu.groups) {
      expect(g.tabs.length).toBeGreaterThan(0);
      expect(SUPPORT_SYSTEM_PROMPT).toContain(g.label);
      for (const t of g.tabs) {
        expect(t.label).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/); // مفتاح ترجمة لم يُحَل
        expect(SUPPORT_SYSTEM_PROMPT).toContain(t.label);
      }
    }
  });
});
