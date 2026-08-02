import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChartOfAccounts";

const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 6 };

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

  it("has a unique name across the entire tree, not just among siblings", () => {
    const names = new Map<string, string>();
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      const existingCode = names.get(account.name);
      expect(existingCode, `name "${account.name}" is duplicated on codes ${existingCode} and ${account.code}`).toBeUndefined();
      names.set(account.name, account.code);
    }
  });

  it("uses four strict levels with consistent, parent-extending codes and keeps every posting account at level 4 as a leaf", () => {
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
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(account.code.length).toBe(LEVEL_CODE_LENGTH[account.level]);
      if (account.parentCode) {
        expect(account.code.startsWith(account.parentCode), `code ${account.code} must extend parent code ${account.parentCode}`).toBe(true);
      }
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
      "الأصول الثابتة",
      "الالتزامات المتداولة",
      "الالتزامات غير المتداولة",
      "رأس المال والاحتياطيات",
      "إيرادات المبيعات",
      "إيرادات غير تشغيلية",
      "مصروفات التشغيل",
      "المصروفات الإدارية والعمومية",
      "المصروفات المالية",
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
      "النقدية بالصندوق", "العملاء", "الموردون", "سلف الموظفين", "أصول ثابتة أخرى",
      "مجمع إهلاك أصول ثابتة أخرى", "إهلاك أصول ثابتة أخرى",
    ].forEach((name) => expect(names.has(name), `missing posting account ${name}`).toBe(true));

    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter((item) => item.level === 4)) {
      expect(account.code).toHaveLength(6);
      expect(account.code.startsWith(account.parentCode as string)).toBe(true);
    }
  });

  it("gives every fixed asset type a separate cost account and a matching accumulated-depreciation account", () => {
    const byName = (name: string) => DEFAULT_CHART_OF_ACCOUNTS.find((account) => account.name === name);
    const pairs: [string, string][] = [
      ["تكلفة الأراضي", "مجمّع إهلاك المباني"],
      ["تكلفة المباني", "مجمّع إهلاك المباني"],
      ["تكلفة السيارات ومعدات النقل", "مجمّع إهلاك السيارات ومعدات النقل"],
      ["تكلفة الآلات والمعدات", "مجمّع إهلاك الآلات والمعدات"],
      ["تكلفة الأثاث والتجهيزات المكتبية", "مجمّع إهلاك الأثاث والتجهيزات المكتبية"],
      ["تكلفة أجهزة الحاسب الآلي وتقنية المعلومات", "مجمّع إهلاك أجهزة الحاسب الآلي"],
    ];
    for (const [cost, accDep] of pairs) {
      expect(byName(cost), `missing cost account ${cost}`).toBeDefined();
      expect(byName(accDep), `missing accumulated depreciation account ${accDep}`).toBeDefined();
    }
  });
});
