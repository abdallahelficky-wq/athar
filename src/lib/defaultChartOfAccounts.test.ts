import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChartOfAccounts";

const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };

describe("standard default chart of accounts", () => {
  it("has unique codes with valid parents", () => {
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

  // أسماء المجموعات غير القابلة للترحيل (isPosting=false) قد تتكرر مع حساب تفصيلي وحيد تحتها
  // (مثال: "652 استهلاك الأصول غير الملموسة" ومجموعتها "6521") — هذا موجود فعلياً في مصدر
  // البيانات (ملفات CSV القطاعية) وليس خطأً، ولا يسبب أي التباس لأن getAccountIdByName يبحث حصراً
  // بين الحسابات القابلة للترحيل (isPosting=true). الشرط الفعلي المطلوب هو عدم تكرار الاسم بين
  // حسابين قابلين للترحيل معاً، لأن هذا فقط ما قد يسبب غموضاً عند الترحيل الآلي بالاسم.
  it("has a unique name among posting (leaf) accounts", () => {
    const posting = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isPosting);
    const names = new Map<string, string>();
    for (const account of posting) {
      const existingCode = names.get(account.name);
      expect(existingCode, `posting account name "${account.name}" is duplicated on codes ${existingCode} and ${account.code}`).toBeUndefined();
      names.set(account.name, account.code);
    }
  });

  it("uses four strict levels (1-2-3-4 digit codes) with consistent, parent-extending codes and keeps every posting account at level 4 as a leaf", () => {
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

  it("gives every account type at least one posting leaf, so every company can post asset, liability, equity, revenue and expense entries", () => {
    const posting = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isPosting);
    for (const type of ["asset", "liability", "equity", "revenue", "expense"] as const) {
      expect(posting.some((account) => account.type === type), `no posting account of type ${type}`).toBe(true);
    }
  });

  it("contains the 8 top-level categories, with cost of revenue split out from operating expenses", () => {
    const topLevel = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.level === 1);
    expect(topLevel.map((a) => a.code).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const byCode = new Map(topLevel.map((a) => [a.code, a.name]));
    expect(byCode.get("1")).toBe("الأصول");
    expect(byCode.get("2")).toBe("الالتزامات");
    expect(byCode.get("3")).toBe("حقوق الملكية");
    expect(byCode.get("4")).toBe("الإيرادات");
    expect(byCode.get("5")).toBe("تكلفة الإيرادات");
    expect(byCode.get("6")).toBe("المصروفات التشغيلية");
    expect(byCode.get("7")).toBe("إيرادات ومصروفات أخرى");
    expect(byCode.get("8")).toBe("حسابات ختامية ورقابية");

    const sectorTerms = ["خيل", "فروسية", "مقاولات", "محطة وقود", "رحلات نقل"];
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      sectorTerms.forEach((term) => expect(account.name).not.toContain(term));
    }
  });

  it("contains comprehensive posting accounts for cash/bank, receivables, payables and payroll", () => {
    const names = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.name));
    [
      "الصندوق النقدي - الإدارة العامة", "بنك - حساب جاري (1)", "بنك - حساب جاري (2)",
      "ودائع بنكية قصيرة الأجل", "عملاء - مبيعات جملة/عقود", "عملاء - مبيعات نقدية/تجزئة",
      "مخصص ديون مشكوك في تحصيلها (عكسي)", "موردون - محليون", "أوراق دفع",
      "تأمينات اجتماعية مستحقة", "رواتب مستحقة", "الزكاة المستحقة", "مجمع الإهلاك (عكسي)",
      "أصول ثابتة أخرى", "سفر وانتقالات", "فروقات وهبوط مخزون",
    ].forEach((name) => expect(names.has(name), `missing posting account ${name}`).toBe(true));

    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter((item) => item.level === 4)) {
      expect(account.code).toHaveLength(6);
      expect(account.code.startsWith(account.parentCode as string)).toBe(true);
    }
  });

  it("has the 5 cash/bank accounts under 111 flagged as isBankOrCash", () => {
    const bankOrCash = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => account.isBankOrCash);
    expect(bankOrCash.length).toBe(5);
    expect(bankOrCash.every((account) => account.parentCode === "111")).toBe(true);
  });
});
