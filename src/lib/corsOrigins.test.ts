import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "./corsOrigins";

const allowed = ["https://atharerp.com", "https://www.atharerp.com"];

describe("isAllowedCorsOrigin", () => {
  it("يسمح بالطلبات بلا Origin (تطبيقات أصلية، أجهزة، خادم-لخادم)", () => {
    expect(isAllowedCorsOrigin(undefined, "production", allowed)).toBe(true);
  });
  it("يسمح بنطاقات أثر في الإنتاج، ويتجاهل الشرطة الأخيرة", () => {
    expect(isAllowedCorsOrigin("https://atharerp.com", "production", allowed)).toBe(true);
    expect(isAllowedCorsOrigin("https://www.atharerp.com/", "production", allowed)).toBe(true);
  });
  it("يرفض أي موقع آخر في الإنتاج، ومنه localhost والنطاقات المشابهة", () => {
    expect(isAllowedCorsOrigin("https://evil.example", "production", allowed)).toBe(false);
    expect(isAllowedCorsOrigin("https://atharerp.com.evil.example", "production", allowed)).toBe(false);
    expect(isAllowedCorsOrigin("http://atharerp.com", "production", allowed)).toBe(false);
    expect(isAllowedCorsOrigin("http://localhost:5173", "production", allowed)).toBe(false);
  });
  it("يسمح بـlocalhost وCodespaces خارج الإنتاج فقط", () => {
    expect(isAllowedCorsOrigin("http://localhost:5173", "development", allowed)).toBe(true);
    expect(isAllowedCorsOrigin("https://abc-5173.app.github.dev", "development", allowed)).toBe(true);
  });
});
