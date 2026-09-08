import { describe, expect, it } from "vitest";
import { requiredAccountFieldsForType, validateAccountsForType, ITEM_TYPES, PERIODIC_INVENTORY_ENABLED } from "./items.schemas";

describe("requiredAccountFieldsForType", () => {
  it("keeps every pre-existing type's required fields unchanged (regression)", () => {
    expect(requiredAccountFieldsForType("inventory")).toEqual(["stockAccountId", "cogsAccountId", "revenueAccountId"]);
    expect(requiredAccountFieldsForType("expense")).toEqual(["expenseAccountId"]);
    expect(requiredAccountFieldsForType("service")).toEqual(["revenueAccountId"]);
    expect(requiredAccountFieldsForType("raw_material", false)).toEqual(["stockAccountId"]);
    expect(requiredAccountFieldsForType("raw_material", true)).toEqual(["stockAccountId", "revenueAccountId", "cogsAccountId"]);
    expect(requiredAccountFieldsForType("bundle")).toEqual(["stockAccountId", "revenueAccountId", "cogsAccountId"]);
    expect(requiredAccountFieldsForType("fixed_asset")).toEqual([]);
  });

  it("requires purchasesAccountId/stockAccountId/revenueAccountId for periodic_inventory, no cogsAccountId", () => {
    const fields = requiredAccountFieldsForType("periodic_inventory");
    expect(fields).toEqual(["purchasesAccountId", "stockAccountId", "revenueAccountId"]);
    expect(fields).not.toContain("cogsAccountId");
  });

  it("requires exactly expenseAccountId and revenueAccountId for non_stock, no stock/cogs account", () => {
    const fields = requiredAccountFieldsForType("non_stock");
    expect(fields).toEqual(["expenseAccountId", "revenueAccountId"]);
    expect(fields).not.toContain("stockAccountId");
    expect(fields).not.toContain("cogsAccountId");
  });

  it("includes both new types in ITEM_TYPES and has periodic_inventory enabled", () => {
    expect(ITEM_TYPES).toContain("periodic_inventory");
    expect(ITEM_TYPES).toContain("non_stock");
    expect(PERIODIC_INVENTORY_ENABLED).toBe(true);
  });
});

describe("validateAccountsForType", () => {
  it("passes for non_stock when both expense and revenue accounts are set", () => {
    const error = validateAccountsForType({ type: "non_stock", expenseAccountId: "a1", revenueAccountId: "a2" });
    expect(error).toBeNull();
  });

  it("rejects non_stock missing either account, naming both when both are missing", () => {
    const error = validateAccountsForType({ type: "non_stock" });
    expect(error).toContain("حساب المصروف");
    expect(error).toContain("حساب الإيراد");
  });

  it("rejects non_stock missing only the revenue account", () => {
    const error = validateAccountsForType({ type: "non_stock", expenseAccountId: "a1" });
    expect(error).toContain("حساب الإيراد");
    expect(error).not.toContain("حساب المصروف");
  });

  it("passes for periodic_inventory when all three required accounts are set", () => {
    const error = validateAccountsForType({ type: "periodic_inventory", purchasesAccountId: "a1", stockAccountId: "a2", revenueAccountId: "a3" });
    expect(error).toBeNull();
  });

  it("still rejects inventory type missing cogsAccountId (regression)", () => {
    const error = validateAccountsForType({ type: "inventory", stockAccountId: "a1", revenueAccountId: "a3" });
    expect(error).toContain("تكلفة البضاعة المباعة");
  });
});
