import { describe, expect, it } from "vitest";
import { registerSchema } from "./auth.schemas";
const input = { tenantName: "Test company", businessActivity: "retail", name: "Owner", email: "owner@example.com", password: "Password123!" };
describe("registration plan boundary", () => {
it.each(["basic", "professional", "enterprise"])("accepts %s", subscriptionPlan => { expect(registerSchema.parse({ ...input, subscriptionPlan }).subscriptionPlan).toBe(subscriptionPlan); });
it("defaults to basic", () => { expect(registerSchema.parse(input).subscriptionPlan).toBe("basic"); });
it("rejects unknown plans", () => { expect(registerSchema.safeParse({ ...input, subscriptionPlan: "free-unlimited" }).success).toBe(false); });
it("does not accept paid status or custom expiry", () => { const parsed = registerSchema.parse({ ...input, subscriptionStatus: "active", trialEndsAt: "2099-01-01" }); expect(parsed).not.toHaveProperty("subscriptionStatus"); expect(parsed).not.toHaveProperty("trialEndsAt"); });
});
