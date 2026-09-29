import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * كل تاريخ يُعرَض أو يُطبَع أو يُصدَّر ميلادي. التقويم الافتراضي لـ"ar-SA" يتبع نسخة ICU (هجري في Chromium، ميلادي في Node
 * الحالي)، واستدعاء بلا لغة يأخذ لغة المتصفح — فأي تنسيق تاريخ لا يُثبِّت التقويم قد يطبع هجرياً. أُصلِح هذا في إيصال
 * نقطة البيع ثم وُجدت له أخوات في تذييل الطباعة المشترك وفاتورة Classic Pro وغيرها؛ هذا الفحص يمنع أختاً جديدة.
 *
 * المسموح: الدوال المشتركة في frontend/src/i18n/dateFormat.js (تُثبِّت التقويم بنفسها)، أو استدعاء يمرّر calendar صراحة.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["src", "frontend/src"];
const ALLOWED = new Set(["frontend/src/i18n/dateFormat.js"]);
const DATE_CALL = /\.toLocale(?:Date|Time)String\(|new Date\([^()]*(?:\([^()]*\))?[^()]*\)\.toLocaleString\(|Intl\.DateTimeFormat\(/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === "dist" ? [] : files(full);
    return /\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** نص الاستدعاء من موضع المطابقة حتى إغلاق قوس دالة التنسيق نفسها (open = موضع قوسها المفتوح) */
function callText(src: string, start: number, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

describe("every date formatted for display, print or export is Gregorian", () => {
  it("no date formatting call leaves the calendar to the locale default", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of files(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(DATE_CALL)) {
          const call = callText(src, m.index!, m.index! + m[0].length - 1);
          if (/calendar\s*:\s*["']gregory["']/.test(call) || /Intl\.DateTimeFormat\(\s*["']en-(GB|US)["']/.test(call)) continue;
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${rel}:${line}  ${call.slice(0, 90)}`);
        }
      }
    }
    expect(offenders, `استخدم formatDate/formatDateTime/formatTime من frontend/src/i18n/dateFormat.js، أو مرّر calendar: "gregory":\n${offenders.join("\n")}`).toEqual([]);
  });
});
