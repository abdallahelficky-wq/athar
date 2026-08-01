import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChartOfAccounts";

describe("standard default chart of accounts", () => {
  it("has unique bilingual accounts with valid parents", () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((account) => [account.code, account]));
    expect(byCode.size).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);

    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(account.name.trim().length).toBeGreaterThan(1);
      expect(account.nameEn.trim().length).toBeGreaterThan(1);
      expect(account.level).toBeGreaterThanOrEqual(1);
      expect(account.level).toBeLessThanOrEqual(6);
      if (account.level === 1) {
        expect(account.parentCode).toBeNull();
      } else {
        const parent = byCode.get(account.parentCode || "");
        expect(parent, `missing parent ${account.parentCode} for ${account.code}`).toBeDefined();
        expect(parent?.level).toBe(account.level - 1);
      }
    }
  });

  it("allows posting accounts at levels 2 through 6 only and keeps them as leaves", () => {
    const parentCodes = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.parentCode).filter(Boolean));
    const posting = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isPosting);

    expect(posting.some((account) => account.level === 3)).toBe(true);
    expect(posting.some((account) => account.level === 4)).toBe(true);
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((account) => account.level === 5)).toBe(true);
    expect(posting.some((account) => account.level === 6)).toBe(true);
    for (const account of posting) {
      expect(account.level).toBeGreaterThanOrEqual(2);
      expect(account.level).toBeLessThanOrEqual(6);
      expect(parentCodes.has(account.code)).toBe(false);
    }
  });

  it("contains the standard financial statement sections without sector accounts", () => {
    const names = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.name));
    [
      "الأصول المتداولة",
      "الأصول غير المتداولة",
      "الممتلكات والآلات والمعدات",
      "الالتزامات المتداولة",
      "الالتزامات غير المتداولة",
      "إيرادات المبيعات",
      "إيرادات غير تشغيلية",
      "مصروفات التشغيل",
      "المصروفات العمومية والإدارية",
      "مصروفات البيع والتسويق",
      "الإهلاك والإطفاء",
    ].forEach((name) => expect(names.has(name), `missing ${name}`).toBe(true));

    const sectorTerms = ["خيل", "فروسية", "مقاولات", "محطة وقود", "رحلات نقل"];
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      sectorTerms.forEach((term) => expect(account.name).not.toContain(term));
    }
  });
});
