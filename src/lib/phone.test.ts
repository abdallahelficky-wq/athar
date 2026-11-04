import { describe, expect, it } from "vitest";
import { maskPhone, normalizeSaudiMobile } from "./phone";

describe("normalizeSaudiMobile", () => {
  it.each([
    ["0573076236", "966573076236"],
    ["573076236", "966573076236"],
    ["+966573076236", "966573076236"],
    ["00966573076236", "966573076236"],
    ["966573076236", "966573076236"],
    ["057 307 6236", "966573076236"],
    ["+966 (57) 307-6236", "966573076236"],
    ["٠٥٧٣٠٧٦٢٣٦", "966573076236"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeSaudiMobile(input)).toBe(expected);
  });

  it.each(["", "0123456789", "05730762", "0573076236123", "0473076236", "+201001234567", "05abc76236", null, undefined])("rejects %s", (input) => {
    expect(normalizeSaudiMobile(input)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps only prefix and last digits", () => {
    expect(maskPhone("966573076236")).toBe("9665*****236");
  });
});
