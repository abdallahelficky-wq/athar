import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChartOfAccounts";
import { inferClassificationFromName, resolveEffectiveClassification, type ClassifiedAccount } from "./accountClassification";

const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
const infer = (code: string) => inferClassificationFromName(byCode.get(code)!);

describe("inferClassificationFromName on the shipped default chart", () => {
  it("classifies the level-2 groups by their explicit names", () => {
    expect(infer("11").liquidity).toBe("current");
    expect(infer("12").liquidity).toBe("non_current");
    expect(infer("21").liquidity).toBe("current");
    expect(infer("22").liquidity).toBe("non_current");
  });

  it("treats the current portion of a long-term loan as current", () => {
    expect(byCode.get("214002")!.name).toContain("الجزء المتداول");
    expect(infer("214002").liquidity).toBe("current");
  });

  it("assigns analysis roles to the standard groups only", () => {
    expect(infer("112").analysisRole).toBe("receivables");
    expect(infer("114").analysisRole).toBe("inventory");
    expect(infer("211").analysisRole).toBe("payables");
    expect(infer("5").analysisRole).toBe("cost_of_sales");
    expect(infer("651").analysisRole).toBe("depreciation");
    expect(infer("72").analysisRole).toBe("finance_cost");
    // "إيرادات وتكاليف تمويلية" يخلط الإيراد بالتكلفة — لا يُفترض أنه تكلفة تمويل
    expect(infer("71").analysisRole).toBeNull();
    // "ذمم مدينة أخرى" ليست ذمم عملاء ولا تدخل أيام التحصيل
    expect(infer("113").analysisRole).toBeNull();
  });

  it("never gives liquidity to equity, revenue or expense accounts", () => {
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      if (account.type === "asset" || account.type === "liability") continue;
      expect(inferClassificationFromName(account).liquidity, account.code).toBeNull();
    }
  });
});

describe("resolveEffectiveClassification", () => {
  const acc = (id: string, parentId: string | null, type: ClassifiedAccount["type"], liquidity: ClassifiedAccount["liquidity"] = null, analysisRole: ClassifiedAccount["analysisRole"] = null): ClassifiedAccount => ({ id, parentId, type, liquidity, analysisRole });

  it("inherits from the nearest classified ancestor of the same type and flags it as inherited", () => {
    const eff = resolveEffectiveClassification([
      acc("g", null, "asset", "current"),
      acc("inv", "g", "asset", null, "inventory"),
      acc("leaf", "inv", "asset"),
      acc("own", "inv", "asset", "non_current"),
    ]);
    expect(eff.get("leaf")).toEqual({ liquidity: "current", analysisRole: "inventory", liquidityInherited: true, analysisRoleInherited: true });
    expect(eff.get("own")).toMatchObject({ liquidity: "non_current", liquidityInherited: false, analysisRole: "inventory" });
  });

  it("does not inherit across account types nor apply a role that does not fit the type", () => {
    const eff = resolveEffectiveClassification([
      acc("a", null, "asset", "current", "inventory"),
      acc("l", "a", "liability"),
      acc("x", null, "expense", "current", "inventory"),
    ]);
    expect(eff.get("l")).toMatchObject({ liquidity: null, analysisRole: null });
    expect(eff.get("x")).toMatchObject({ liquidity: null, analysisRole: null });
  });

  it("terminates on a corrupted cyclic tree", () => {
    const eff = resolveEffectiveClassification([acc("p", "q", "asset"), acc("q", "p", "asset")]);
    expect(eff.get("p")?.liquidity).toBeNull();
  });
});
