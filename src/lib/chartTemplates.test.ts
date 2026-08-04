import { describe, expect, it } from "vitest";
import { BUSINESS_ACTIVITIES, CHART_TEMPLATE_BY_ACTIVITY } from "./chartTemplates";

const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };

describe("business activity chart of accounts templates", () => {
  for (const activity of BUSINESS_ACTIVITIES) {
    describe(activity, () => {
      const template = CHART_TEMPLATE_BY_ACTIVITY[activity];

      it("has unique codes with valid parent links and correct code lengths per level", () => {
        const byCode = new Map(template.map((account) => [account.code, account]));
        expect(byCode.size).toBe(template.length);

        for (const account of template) {
          expect(account.name.trim().length).toBeGreaterThan(1);
          expect(account.nameEn.trim().length).toBeGreaterThan(1);
          expect(account.code.length).toBe(LEVEL_CODE_LENGTH[account.level]);
          if (account.level === 1) {
            expect(account.parentCode).toBeNull();
          } else {
            const parent = byCode.get(account.parentCode || "");
            expect(parent, `missing parent ${account.parentCode} for ${account.code}`).toBeDefined();
            expect(parent?.level).toBe(account.level - 1);
            expect(account.code.startsWith(account.parentCode as string)).toBe(true);
          }
        }
      });

      it("has the 8 top-level categories with cost of revenue split out from operating expenses", () => {
        const topLevel = template.filter((a) => a.level === 1);
        expect(topLevel.map((a) => a.code).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
      });

      it("keeps every posting account at level 4 as a leaf, and every non-posting account above level 4", () => {
        const parentCodes = new Set(template.map((a) => a.parentCode).filter(Boolean));
        expect(template.filter((a) => a.level < 4).every((a) => !a.isPosting)).toBe(true);
        expect(template.filter((a) => a.level === 4).every((a) => a.isPosting)).toBe(true);
        for (const account of template.filter((a) => a.isPosting)) {
          expect(parentCodes.has(account.code)).toBe(false);
        }
      });

      it("has a unique name among posting (leaf) accounts, so automated posting-by-name never resolves ambiguously", () => {
        const names = new Map<string, string>();
        for (const account of template.filter((a) => a.isPosting)) {
          const existingCode = names.get(account.name);
          expect(existingCode, `posting account name "${account.name}" duplicated on codes ${existingCode} and ${account.code}`).toBeUndefined();
          names.set(account.name, account.code);
        }
      });

      it("gives every account type at least one posting leaf", () => {
        const posting = template.filter((a) => a.isPosting);
        for (const type of ["asset", "liability", "equity", "revenue", "expense"] as const) {
          expect(posting.some((a) => a.type === type), `no posting account of type ${type}`).toBe(true);
        }
      });

      it("has exactly 5 cash/bank accounts under 111 flagged as isBankOrCash", () => {
        const bankOrCash = template.filter((a) => a.isBankOrCash);
        expect(bankOrCash.length).toBe(5);
        expect(bankOrCash.every((a) => a.parentCode === "111")).toBe(true);
      });
    });
  }
});
