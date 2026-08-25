import { describe, expect, it } from "vitest";
import { createContractSchema, createHorseSchema, createStableSchema } from "./stables.schemas";

describe("horse stables validation", () => {
  it("accepts a valid stable", () => {
    expect(createStableSchema.parse({ companyId: "c1", name: "الإسطبل الرئيسي", capacity: 24 }).capacity).toBe(24);
  });

  it("accepts a complete horse profile and coerces its birth date", () => {
    const horse = createHorseSchema.parse({ companyId: "c1", name: "برق", sex: "stallion", birthDate: "2022-03-15" });
    expect(horse.birthDate).toBeInstanceOf(Date);
  });

  it("rejects a boarding contract whose end precedes its start", () => {
    const result = createContractSchema.safeParse({ companyId: "c1", stableId: "s1", horseId: "h1", startDate: "2026-08-25", endDate: "2026-08-20", monthlyFee: 1000 });
    expect(result.success).toBe(false);
  });
});

