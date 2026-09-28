import { describe, expect, it } from "vitest";
import { setPortalAccessSchema } from "./employees.schemas";

describe("setPortalAccessSchema", () => {
  it("accepts exactly 6 digits for a newly set PIN", () => {
    expect(setPortalAccessSchema.safeParse({ phone: "0501112233", pin: "482193" }).success).toBe(true);
  });

  it("rejects 4- and 5-digit and non-numeric PINs", () => {
    for (const pin of ["1234", "12345", "1234567", "12a456", " 123456"]) {
      expect(setPortalAccessSchema.safeParse({ phone: "0501112233", pin }).success).toBe(false);
    }
  });

  it("allows omitting the PIN (keep the current one) and trims the phone", () => {
    const parsed = setPortalAccessSchema.parse({ phone: " 0501112233 ", portalActive: false });
    expect(parsed).toEqual({ phone: "0501112233", portalActive: false });
  });
});
