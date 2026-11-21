import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * وضع "عرض فقط" (اشتراك أو تجربة منتهية — blockMutationsWhenReadOnly في middleware/auth.ts) يُركَّب على مستوى كل راوتر، فراوتر
 * ينساه يترك كل مسارات التعديل فيه مفتوحة لعضوية "عرض فقط": هكذا بقي POST /api/ai/ask متاحاً (استدعاء نموذج مدفوع).
 * كل راوتر يستخدم مصادقة المستخدم (authenticate) يجب أن يركّب الحارس، أو يُذكر هنا صراحة بسبب.
 */
const ALLOWED_WITHOUT_GUARD: Record<string, string> = {
  // مسارا المستخدم هنا قراءة فقط (GET)، ومسارات التعديل (تسجيل الحضور/الانصراف) لبوابة الموظف برمز منفصل لا يحمل readOnly
  "src/modules/attendance/attendance.routes.ts": "user routes are GET-only; mutations are employee-portal check-in/out",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name.endsWith(".routes.ts") ? [full] : [];
  });
}

describe("read-only guard coverage", () => {
  const files = routeFiles("src/modules");

  it("finds the routers", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("every router using user authentication mounts blockMutationsWhenReadOnly, or is listed with a reason", () => {
    const missing = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      const usesUserAuth = /import\s*\{[^}]*\bauthenticate\b[^}]*\}\s*from\s*"[^"]*middleware\/auth"/.test(src);
      return usesUserAuth && !src.includes("blockMutationsWhenReadOnly") && !(f in ALLOWED_WITHOUT_GUARD);
    });
    expect(missing).toEqual([]);
  });

  it("the allowlist only names routers that still exist and still lack the guard", () => {
    for (const f of Object.keys(ALLOWED_WITHOUT_GUARD)) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("blockMutationsWhenReadOnly"), f).toBe(false);
      // مسارات المستخدم في الملف المستثنى قراءة فقط
      for (const line of src.split("\n").filter((l) => /\.(post|put|patch|delete)\(/.test(l))) {
        expect(line, `${f}: a user-auth mutation would need the guard`).not.toMatch(/\bauthenticate\b(?!EmployeePortal)/);
      }
    }
  });
});
