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
      expect(account.level).toBeLessThanOrEqual(4);
      if (account.level === 1) {
        expect(account.parentCode).toBeNull();
      } else {
        const parent = byCode.get(account.parentCode || "");
        expect(parent, `missing parent ${account.parentCode} for ${account.code}`).toBeDefined();
        expect(parent?.level).toBe(account.level - 1);
      }
    }
  });

  it("uses four strict levels and keeps every posting account at level 4 as a leaf", () => {
    const parentCodes = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.parentCode).filter(Boolean));
    const posting = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isPosting);

    expect(new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.level))).toEqual(new Set([1, 2, 3, 4]));
    expect(DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.level < 4).every((account) => !account.isPosting)).toBe(true);
    expect(DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.level === 4).every((account) => account.isPosting)).toBe(true);
    const coveredLevelThree = new Set(DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.level === 4).map((account) => account.parentCode));
    expect(DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.level === 3).every((account) => coveredLevelThree.has(account.code))).toBe(true);
    expect(posting.some((account) => account.level === 4)).toBe(true);
    expect(DEFAULT_CHART_OF_ACCOUNTS.every((account) => account.level <= 4)).toBe(true);
    for (const account of posting) {
      expect(account.level).toBe(4);
      expect(parentCodes.has(account.code)).toBe(false);
    }
    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter((item) => item.level < 4)) {
      expect(account.isPosting).toBe(false);
    }
  });

  it("gives every account type at least one posting leaf, so every company can post sales, expenses and equity entries", () => {
    const posting = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isPosting);
    for (const type of ["asset", "liability", "equity", "revenue", "expense"] as const) {
      expect(posting.some((account) => account.type === type), `no posting account of type ${type}`).toBe(true);
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

  it("contains comprehensive Saudi commercial and service posting accounts", () => {
    const names = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.name));
    [
      "مصرف الراجحي", "البنك السعودي الأول (ساب)", "مصرف الإنماء", "مخزون الوقود والمحروقات",
      "مخزون قطع الغيار", "ذمم بين الشركات الشقيقة - مدينة", "ذمم بين الشركات الشقيقة - دائنة",
      "اشتراكات التأمينات الاجتماعية (GOSI)", "تأمين طبي للموظفين", "إيجار محطات ومواقع",
      "صيانة سيارات - تشغيل", "صيانة معدات - تشغيل", "أتعاب مراجعة حسابات", "مخصص الزكاة",
    ].forEach((name) => expect(names.has(name), `missing posting account ${name}`).toBe(true));

    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter((item) => item.level === 4)) {
      expect(account.code).toHaveLength(9);
      expect(account.code.slice(0, 3)).toBe(account.parentCode?.slice(0, 3));
    }
  });
});
