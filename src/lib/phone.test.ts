import { describe, expect, it } from "vitest";
import { maskPhone, normalizeMobile, normalizeSaudiMobile } from "./phone";

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

describe("normalizeMobile by country", () => {
  it.each([
    ["EG", "+201018889364", "201018889364"],
    ["EG", "01018889364", "201018889364"],
    ["EG", "1018889364", "201018889364"],
    ["EG", "00201018889364", "201018889364"],
    ["EG", "٠١٠١٨٨٨٩٣٦٤", "201018889364"],
    ["AE", "0501234567", "971501234567"],
    ["KW", "96512345", "96596512345"],
    ["KW", "+96596512345", "96596512345"],
    ["JO", "0791234567", "962791234567"],
    ["SA", "0573076236", "966573076236"],
  ])("%s accepts %s", (country, input, expected) => {
    expect(normalizeMobile(input, country)).toBe(expected);
  });

  it.each([
    ["EG", "0573076236"],
    ["EG", "+966573076236"],
    ["SA", "+201018889364"],
    ["EG", "01318889364"],
    ["XX", "01018889364"],
  ])("%s rejects %s", (country, input) => {
    expect(normalizeMobile(input, country)).toBeNull();
  });
});
